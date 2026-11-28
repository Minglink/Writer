import {
  SUBSCRIPTION_MAX_ACCOUNTS_PER_PROVIDER,
  SUBSCRIPTION_MAX_LOCAL_CANDIDATES,
  SUBSCRIPTION_MAX_MODELS_PER_PROVIDER,
  SubscriptionAcquiredCredentialSchema,
  SubscriptionAuthProgressPayloadSchema,
  SubscriptionCancelAuthResultSchema,
  SubscriptionModelItemSchema,
  SubscriptionProviderOverviewSchema,
  SubscriptionScanLocalResultSchema,
  SubscriptionSettingsSnapshotSchema,
  SubscriptionStartAuthResultSchema,
  SubscriptionStateChangedPayloadSchema,
  isSubscriptionModel,
  type ModelSettings,
  type SubscriptionAcquiredCredential,
  type SubscriptionAcquireCredentialInput,
  type SubscriptionAuthProgressPayload,
  type SubscriptionCancelAuthInput,
  type SubscriptionCancelAuthResult,
  type SubscriptionImportLocalInput,
  type SubscriptionImportManualInput,
  type SubscriptionInteractiveAuthMethod,
  type SubscriptionProviderId,
  type SubscriptionRefreshModelsInput,
  type SubscriptionRefreshQuotaInput,
  type SubscriptionRemoveAccountInput,
  type SubscriptionReportAndFailoverInput,
  type SubscriptionRuntimeAuth,
  type SubscriptionScanLocalInput,
  type SubscriptionScanLocalResult,
  type SubscriptionSetAccountEnabledInput,
  type SubscriptionSetDefaultModelInput,
  type SubscriptionSetModelEnabledInput,
  type SubscriptionSetPrimaryAccountInput,
  type SubscriptionSettingsSnapshot,
  type SubscriptionStartAuthInput,
  type SubscriptionStartAuthResult,
  type SubscriptionStateChangedPayload
} from "@writer/contracts";
import { createId } from "@writer/shared";
import { SubscriptionPersistence } from "./persistence";
import { ProviderAdapterRegistry } from "./registry";
import {
  applyAccountFailure,
  markAccountUsed,
  normalizeProviderPrimary,
  recoverExpiredAccounts,
  selectAccountForProvider
} from "./scheduler";
import { TokenRefreshLock } from "./token-refresh-lock";
import {
  SubscriptionError,
  safeSubscriptionError,
  toAccountSummary,
  toModelConfigInput,
  type AuthFlowHandle,
  type ImportedAccountResult,
  type PersistedSubscriptionState,
  type SecureStorageLike,
  type StoredAccountRecord,
  type StoredAccountSecret,
  type SubscriptionCatalogReader,
  type SubscriptionModelCatalog,
  type SubscriptionModelDefinition,
  type SubscriptionProviderAdapter
} from "./types";

const TOKEN_EXPIRY_REFRESH_BUFFER_MS = 60_000;

export interface SubscriptionModelStoreSync {
  syncSubscriptions(options?: {
    autoSelectDefault?: boolean;
  }): Promise<ModelSettings>;
  setDefaultModel(modelId: string): Promise<ModelSettings>;
  getDefaultModelId(): Promise<string>;
}

export interface SubscriptionEventSink {
  emitAuthProgress(payload: SubscriptionAuthProgressPayload): void;
  emitStateChanged(payload: SubscriptionStateChangedPayload): void;
}

export interface SubscriptionAccountManagerOptions {
  registry?: ProviderAdapterRegistry;
  persistence?: SubscriptionPersistence;
  secureStorage?: SecureStorageLike;
  refreshLock?: TokenRefreshLock;
  now?: () => number;
  openExternalUrl?: (url: string) => Promise<void>;
  modelStoreSync?: SubscriptionModelStoreSync;
  events?: SubscriptionEventSink;
}

interface ActiveAuthSession {
  authSessionId: string;
  provider: SubscriptionProviderId;
  controller: AbortController;
  handle: AuthFlowHandle;
}

function isModelEnabled(
  definition: SubscriptionModelDefinition,
  overrides: Readonly<Record<string, boolean>>
): boolean {
  const override = overrides[definition.id];
  return override !== undefined ? override : Boolean(definition.recommended);
}

function isSecretExpiringSoon(
  secret: StoredAccountSecret,
  nowMs: number
): boolean {
  if (
    !secret.accessToken?.trim() ||
    secret.accessToken.trim() === "pending-refresh"
  ) {
    return true;
  }
  const expiryIso = secret.providerTokenExpiresAt ?? secret.expiresAt;
  if (!expiryIso) return false;
  const expiryMs = Date.parse(expiryIso);
  if (!Number.isFinite(expiryMs)) return false;
  return expiryMs - nowMs <= TOKEN_EXPIRY_REFRESH_BUFFER_MS;
}

function normalizeEmailKey(email: string | undefined): string | undefined {
  const trimmed = email?.trim().toLowerCase();
  return trimmed ? trimmed : undefined;
}

export class SubscriptionAccountManager implements SubscriptionCatalogReader {
  readonly registry: ProviderAdapterRegistry;
  readonly persistence: SubscriptionPersistence;
  private readonly refreshLock: TokenRefreshLock;
  private readonly now: () => number;
  private readonly openExternalUrl: (url: string) => Promise<void>;
  private readonly events: SubscriptionEventSink | undefined;
  private modelStoreSync: SubscriptionModelStoreSync | undefined;
  private readonly authSessions = new Map<string, ActiveAuthSession>();

  constructor(
    userDataPath: string,
    options: SubscriptionAccountManagerOptions = {}
  ) {
    this.registry = options.registry ?? new ProviderAdapterRegistry();
    this.persistence =
      options.persistence ??
      new SubscriptionPersistence(userDataPath, {
        ...(options.secureStorage
          ? { secureStorage: options.secureStorage }
          : {})
      });
    this.refreshLock = options.refreshLock ?? new TokenRefreshLock();
    this.now = options.now ?? Date.now;
    this.openExternalUrl =
      options.openExternalUrl ??
      (async () => {
        throw new SubscriptionError(
          "subscriptions.browser_open_unavailable",
          "当前环境不支持自动打开外部浏览器。"
        );
      });
    this.modelStoreSync = options.modelStoreSync;
    this.events = options.events;
  }

  attachModelStoreSync(sync: SubscriptionModelStoreSync): void {
    this.modelStoreSync = sync;
  }

  async initialize(): Promise<void> {
    await this.persistence.update((state) => {
      const recovered = recoverExpiredAccounts(state.accounts, this.now());
      return {
        state: { ...state, accounts: recovered.accounts },
        result: undefined,
        write: recovered.recoveredIds.length > 0
      };
    });
  }

  async getState(): Promise<SubscriptionSettingsSnapshot> {
    const recoveredIds: string[] = [];
    const state = await this.persistence.update((current) => {
      const recovered = recoverExpiredAccounts(current.accounts, this.now());
      recoveredIds.push(...recovered.recoveredIds);
      return {
        state: { ...current, accounts: recovered.accounts },
        result: { ...current, accounts: recovered.accounts },
        write: recovered.recoveredIds.length > 0
      };
    });
    if (recoveredIds.length > 0) {
      this.emitStateChanged({ reason: "cooldown_recovered" });
    }
    const defaultModelId =
      (await this.modelStoreSync?.getDefaultModelId()) ?? "";
    return this.buildSnapshot(state, defaultModelId);
  }

  async startAuth(
    input: SubscriptionStartAuthInput
  ): Promise<SubscriptionStartAuthResult> {
    const adapter = this.registry.require(input.provider);
    if (!adapter.startAuth) {
      throw new SubscriptionError(
        "subscriptions.auth_method_unsupported",
        `${adapter.meta.name} 不支持交互式登录，请使用本机凭证导入。`
      );
    }
    const interactiveMethods = adapter.meta.supportedAuthMethods.filter(
      (method): method is SubscriptionInteractiveAuthMethod =>
        method === "oauth" || method === "device_flow"
    );
    const method = input.method ?? interactiveMethods[0];
    if (!method || !interactiveMethods.includes(method)) {
      throw new SubscriptionError(
        "subscriptions.auth_method_unsupported",
        `${adapter.meta.name} 不支持所选登录方式。`
      );
    }

    const authSessionId = createId("sub_auth");
    const controller = new AbortController();
    const handle = await adapter.startAuth({
      authSessionId,
      method,
      signal: controller.signal,
      openExternalUrl: async (url) => {
        if (input.openBrowser === false) return;
        try {
          await this.openExternalUrl(url);
        } catch {
          // Best-effort browser launch; UI always exposes the login link for manual copy/open.
        }
      },
      onProgress: (update) => {
        this.emitAuthProgress({
          authSessionId,
          provider: input.provider,
          status: update.status,
          ...(update.message ? { message: update.message } : {}),
          ...(update.code ? { code: update.code } : {})
        });
      }
    });

    const session: ActiveAuthSession = {
      authSessionId,
      provider: input.provider,
      controller,
      handle
    };
    this.authSessions.set(authSessionId, session);

    void handle.completion
      .then(async (imported) => {
        if (controller.signal.aborted) return;
        // Once the credential exchange completes, cancellation cannot undo the disk write.
        this.authSessions.delete(authSessionId);
        const saved = await this.persistAccount(input.provider, imported).catch(
          (error: unknown) => {
            if (error instanceof SubscriptionError) throw error;
            throw new SubscriptionError(
              "subscriptions.account_save_failed",
              "Writer 无法将账号保存到本机。请检查配置目录的写入权限及磁盘空间，再重新登录。"
            );
          }
        );
        this.emitAuthProgress({
          authSessionId,
          provider: input.provider,
          status: "completed",
          accountId: saved.accountId,
          code: saved.updated
            ? "subscriptions.account_updated"
            : "subscriptions.account_added"
        });
        this.emitStateChanged({
          reason: saved.updated ? "account_updated" : "account_added",
          provider: input.provider,
          accountId: saved.accountId
        });
        const autoDefaultModelId = await this.syncImportedModels(
          adapter,
          saved,
          imported.secret
        ).catch(() => undefined);
        this.emitStateChanged({
          reason: "models_refreshed",
          provider: input.provider,
          ...(autoDefaultModelId ? { autoDefaultModelId } : {})
        });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        const safe = safeSubscriptionError(error);
        this.emitAuthProgress({
          authSessionId,
          provider: input.provider,
          status: "failed",
          code: safe.code,
          message: safe.message
        });
      })
      .finally(() => {
        if (this.authSessions.get(authSessionId) === session) {
          this.authSessions.delete(authSessionId);
        }
      });

    return SubscriptionStartAuthResultSchema.parse({
      authSessionId,
      provider: input.provider,
      method: handle.method,
      ...(handle.verificationUri
        ? { verificationUri: handle.verificationUri }
        : {}),
      ...(handle.userCode ? { userCode: handle.userCode } : {}),
      ...(handle.expiresAt ? { expiresAt: handle.expiresAt } : {})
    });
  }

  async cancelAuth(
    input: SubscriptionCancelAuthInput
  ): Promise<SubscriptionCancelAuthResult> {
    const session = this.authSessions.get(input.authSessionId);
    if (!session) {
      return SubscriptionCancelAuthResultSchema.parse({ cancelled: false });
    }
    this.authSessions.delete(input.authSessionId);
    session.controller.abort();
    await Promise.resolve(session.handle.cancel()).catch(() => undefined);
    this.emitAuthProgress({
      authSessionId: session.authSessionId,
      provider: session.provider,
      status: "cancelled"
    });
    return SubscriptionCancelAuthResultSchema.parse({ cancelled: true });
  }

  async scanLocal(
    input: SubscriptionScanLocalInput = {}
  ): Promise<SubscriptionScanLocalResult> {
    const adapters = input.provider
      ? [this.registry.require(input.provider)]
      : this.registry.listAdapters();
    const state = await this.persistence.read();
    const candidates: SubscriptionScanLocalResult["candidates"] = [];

    for (const adapter of adapters) {
      if (!adapter.scanLocalCandidates) continue;
      const found = await adapter.scanLocalCandidates();
      const existingEmails = new Set(
        state.accounts
          .filter((account) => account.provider === adapter.id)
          .map((account) => normalizeEmailKey(account.email))
          .filter((email): email is string => Boolean(email))
      );
      for (const candidate of found) {
        if (candidates.length >= SUBSCRIPTION_MAX_LOCAL_CANDIDATES) break;
        const emailKey = normalizeEmailKey(candidate.email);
        const alreadyImported = Boolean(
          emailKey && existingEmails.has(emailKey)
        );
        candidates.push({
          candidateId: candidate.candidateId,
          provider: adapter.id,
          displayName: candidate.displayName,
          ...(candidate.email ? { email: candidate.email } : {}),
          sourceLabel: candidate.sourceLabel,
          ...(candidate.sourcePathHint
            ? { sourcePathHint: candidate.sourcePathHint }
            : {}),
          alreadyImported
        });
      }
    }

    return SubscriptionScanLocalResultSchema.parse({ candidates });
  }

  async importLocal(
    input: SubscriptionImportLocalInput
  ): Promise<SubscriptionSettingsSnapshot> {
    const adapter = this.registry.require(input.provider);
    if (!adapter.importLocalCandidate) {
      throw new SubscriptionError(
        "subscriptions.local_import_unsupported",
        `${adapter.meta.name} 不支持本机凭证导入。`
      );
    }
    const imported = await adapter.importLocalCandidate(input.candidateId);
    return this.importAccount(adapter, imported);
  }

  async importManual(
    input: SubscriptionImportManualInput
  ): Promise<SubscriptionSettingsSnapshot> {
    const adapter = this.registry.require(input.provider);
    if (!adapter.importManualToken) {
      throw new SubscriptionError(
        "subscriptions.manual_import_unsupported",
        `${adapter.meta.name} 不支持手动粘贴凭证导入。`
      );
    }
    const imported = await adapter.importManualToken({
      token: input.token,
      ...(input.browserToken ? { browserToken: true } : {}),
      ...(input.refreshToken ? { refreshToken: input.refreshToken } : {}),
      ...(input.displayName ? { displayName: input.displayName } : {}),
      ...(input.email ? { email: input.email } : {})
    });
    return this.importAccount(adapter, imported);
  }

  async setPrimaryAccount(
    input: SubscriptionSetPrimaryAccountInput
  ): Promise<SubscriptionSettingsSnapshot> {
    await this.persistence.update((state) => {
      const target = state.accounts.find(
        (account) =>
          account.provider === input.provider && account.id === input.accountId
      );
      if (!target) {
        throw new SubscriptionError(
          "subscriptions.account_not_found",
          "未找到指定的订阅账号。"
        );
      }
      const nextAccounts = normalizeProviderPrimary(
        state.accounts,
        input.provider,
        input.accountId
      );
      return {
        state: { ...state, accounts: nextAccounts },
        result: undefined
      };
    });
    this.emitStateChanged({
      reason: "account_updated",
      provider: input.provider,
      accountId: input.accountId
    });
    return this.getState();
  }

  async setAccountEnabled(
    input: SubscriptionSetAccountEnabledInput
  ): Promise<SubscriptionSettingsSnapshot> {
    const becameActiveProvider = await this.persistence.update((state) => {
      const index = state.accounts.findIndex(
        (account) =>
          account.provider === input.provider && account.id === input.accountId
      );
      if (index < 0) {
        throw new SubscriptionError(
          "subscriptions.account_not_found",
          "未找到指定的订阅账号。"
        );
      }
      const hadEnabledBefore = state.accounts.some(
        (account) => account.provider === input.provider && account.enabled
      );
      const current = state.accounts[index]!;
      const nextAccounts = [...state.accounts];
      nextAccounts[index] = {
        ...current,
        enabled: input.enabled,
        status:
          input.enabled && current.status === "disabled"
            ? "active"
            : current.status
      };
      const normalized = normalizeProviderPrimary(nextAccounts, input.provider);
      const hasEnabledAfter = normalized.some(
        (account) => account.provider === input.provider && account.enabled
      );
      return {
        state: { ...state, accounts: normalized },
        result: !hadEnabledBefore && hasEnabledAfter
      };
    });

    const autoDefaultModelId =
      await this.syncModelConfigStore(becameActiveProvider);
    this.emitStateChanged({
      reason: "account_status_changed",
      provider: input.provider,
      accountId: input.accountId,
      ...(autoDefaultModelId ? { autoDefaultModelId } : {})
    });
    return this.getState();
  }

  async removeAccount(
    input: SubscriptionRemoveAccountInput
  ): Promise<SubscriptionSettingsSnapshot> {
    await this.persistence.update((state) => {
      const exists = state.accounts.some(
        (account) =>
          account.provider === input.provider && account.id === input.accountId
      );
      if (!exists) {
        throw new SubscriptionError(
          "subscriptions.account_not_found",
          "未找到要移除的订阅账号。"
        );
      }
      const remaining = state.accounts.filter(
        (account) => account.id !== input.accountId
      );
      const nextSecrets = { ...state.encryptedSecrets };
      delete nextSecrets[input.accountId];
      return {
        state: {
          ...state,
          accounts: normalizeProviderPrimary(remaining, input.provider),
          encryptedSecrets: nextSecrets
        },
        result: undefined
      };
    });

    await this.syncModelConfigStore(false);
    this.emitStateChanged({
      reason: "account_removed",
      provider: input.provider,
      accountId: input.accountId
    });
    return this.getState();
  }

  async refreshQuota(
    input: SubscriptionRefreshQuotaInput = {}
  ): Promise<SubscriptionSettingsSnapshot> {
    const state = await this.persistence.read();
    const targets = state.accounts.filter((account) => {
      if (input.provider && account.provider !== input.provider) return false;
      if (input.accountId && account.id !== input.accountId) return false;
      return account.enabled && this.registry.has(account.provider);
    });

    let catalogRefreshed = false;
    for (const target of targets) {
      const adapter = this.registry.get(target.provider);
      if (!adapter) continue;
      try {
        if (await this.refreshAccountQuota(adapter, target))
          catalogRefreshed = true;
      } catch (error) {
        if (
          error instanceof SubscriptionError &&
          error.code === "subscriptions.secret_refresh_failed"
        ) {
          await this.persistence.update((current) => {
            const index = current.accounts.findIndex(
              (account) => account.id === target.id
            );
            if (index < 0)
              return { state: current, result: undefined, write: false };
            const nextAccounts = [...current.accounts];
            nextAccounts[index] = {
              ...current.accounts[index]!,
              status: "expired",
              statusMessage: safeSubscriptionError(error).message
            };
            return {
              state: { ...current, accounts: nextAccounts },
              result: undefined
            };
          });
          continue;
        }
        if (targets.length === 1 && input.accountId) {
          throw error;
        }
        const safe = safeSubscriptionError(error);
        await this.persistence.update((current) => {
          const index = current.accounts.findIndex(
            (account) => account.id === target.id
          );
          if (index < 0)
            return { state: current, result: undefined, write: false };
          const nextAccounts = [...current.accounts];
          nextAccounts[index] = {
            ...current.accounts[index]!,
            statusMessage: safe.message
          };
          return {
            state: { ...current, accounts: nextAccounts },
            result: undefined
          };
        });
      }
    }

    if (catalogRefreshed) {
      await this.syncModelConfigStore(false);
    }

    this.emitStateChanged({
      reason: "quota_updated",
      ...(input.provider ? { provider: input.provider } : {}),
      ...(input.accountId ? { accountId: input.accountId } : {})
    });
    return this.getState();
  }

  private async refreshAccountQuota(
    adapter: SubscriptionProviderAdapter,
    target: StoredAccountRecord
  ): Promise<boolean> {
    let secret = await this.ensureFreshSecret(adapter, target);
    let quota;
    try {
      quota = await adapter.fetchQuota(target, secret);
    } catch (fetchError) {
      if (
        fetchError instanceof SubscriptionError &&
        fetchError.code === "subscriptions.secret_refresh_failed"
      ) {
        secret = await this.ensureFreshSecret(adapter, target, true);
        quota = await adapter.fetchQuota(target, secret);
      } else {
        throw fetchError;
      }
    }
    if (adapter.quotaIncludesModels && !quota.models?.length) {
      throw new SubscriptionError(
        "subscriptions.models_unavailable",
        "上游没有返回可用的对话模型。"
      );
    }
    const updatedAt = new Date(this.now()).toISOString();
    const catalogAccount = await this.persistence.update((current) => {
      const index = current.accounts.findIndex(
        (account) => account.id === target.id
      );
      if (index < 0) return { state: current, result: undefined, write: false };
      const account = current.accounts[index]!;
      if (!account.enabled)
        return { state: current, result: false, write: false };
      const nextAccounts = [...current.accounts];
      const enabled = current.accounts.filter(
        (a) => a.enabled && a.provider === target.provider
      );
      const catalogAccount =
        (enabled.find((a) => a.isPrimary) ?? enabled[0])?.id === target.id;
      const nextStatus = quota.status ?? account.status;
      const refreshedAccount = { ...account };
      if (nextStatus === "active") {
        delete refreshedAccount.cooldownUntil;
        delete refreshedAccount.statusMessage;
      }
      nextAccounts[index] = {
        ...refreshedAccount,
        ...(quota.planTier !== undefined ? { planTier: quota.planTier } : {}),
        quotaBuckets: quota.quotaBuckets,
        quotaUpdatedAt: updatedAt,
        ...(quota.status ? { status: quota.status } : {}),
        ...(nextStatus === "active" ? { consecutiveRateLimits: 0 } : {}),
        ...(quota.statusMessage !== undefined
          ? { statusMessage: quota.statusMessage }
          : {}),
        ...(quota.cooldownUntil !== undefined
          ? { cooldownUntil: quota.cooldownUntil }
          : {})
      };
      return {
        state: {
          ...current,
          accounts: nextAccounts,
          ...(catalogAccount && quota.models?.length
            ? {
                cachedModels: {
                  ...current.cachedModels,
                  [target.provider]: quota.models.slice(
                    0,
                    SUBSCRIPTION_MAX_MODELS_PER_PROVIDER
                  )
                }
              }
            : {})
        },
        result: catalogAccount
      };
    });
    if (catalogAccount && quota.models === undefined)
      await this.refreshCachedModels(adapter, target, secret);
    return Boolean(catalogAccount);
  }

  async refreshModels(
    input: SubscriptionRefreshModelsInput = {}
  ): Promise<SubscriptionSettingsSnapshot> {
    const state = await this.persistence.read();
    const targetProviders: SubscriptionProviderId[] = input.provider
      ? [input.provider]
      : this.registry
          .listAdapters()
          .map((adapter) => adapter.id)
          .filter((provider) =>
            state.accounts.some(
              (account) => account.provider === provider && account.enabled
            )
          );

    for (const provider of targetProviders) {
      const adapter = this.registry.get(provider);
      if (!adapter) continue;
      const enabledAccounts = state.accounts
        .filter((account) => account.provider === provider && account.enabled)
        .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary));
      const target = enabledAccounts[0];
      if (!target) {
        try {
          const fallback = await adapter.listModels();
          if (fallback.length > 0) {
            await this.persistence.update((current) => ({
              state: {
                ...current,
                cachedModels: {
                  ...current.cachedModels,
                  [provider]: fallback.slice(
                    0,
                    SUBSCRIPTION_MAX_MODELS_PER_PROVIDER
                  )
                }
              },
              result: undefined
            }));
          }
        } catch {
          // Keep existing cached catalog when offline.
        }
        continue;
      }
      try {
        if (adapter.quotaIncludesModels) {
          await this.refreshAccountQuota(adapter, target);
          continue;
        }
        let secret = await this.ensureFreshSecret(adapter, target);
        let models: SubscriptionModelDefinition[];
        try {
          models = await adapter.listModels(target, secret);
        } catch (listError) {
          if (
            listError instanceof SubscriptionError &&
            listError.code === "subscriptions.secret_refresh_failed"
          ) {
            secret = await this.ensureFreshSecret(adapter, target, true);
            models = await adapter.listModels(target, secret);
          } else {
            throw listError;
          }
        }
        if (models.length > 0) {
          await this.persistence.update((current) => ({
            state: {
              ...current,
              cachedModels: {
                ...current.cachedModels,
                [provider]: models.slice(
                  0,
                  SUBSCRIPTION_MAX_MODELS_PER_PROVIDER
                )
              }
            },
            result: undefined
          }));
        }
      } catch (error) {
        if (input.provider) {
          throw error;
        }
      }
    }

    await this.syncModelConfigStore(false);
    this.emitStateChanged({
      reason: "models_refreshed",
      ...(input.provider ? { provider: input.provider } : {})
    });
    return this.getState();
  }

  async setModelEnabled(
    input: SubscriptionSetModelEnabledInput
  ): Promise<SubscriptionSettingsSnapshot> {
    if (!isSubscriptionModel(input.modelId)) {
      throw new SubscriptionError(
        "subscriptions.model_not_found",
        "指定的模型不是订阅托管模型。"
      );
    }
    const definition = await this.findModelDefinition(input.modelId);
    if (!definition) {
      throw new SubscriptionError(
        "subscriptions.model_not_found",
        "未找到指定的订阅模型。"
      );
    }
    await this.persistence.update((state) => ({
      state: {
        ...state,
        modelOverrides: {
          ...state.modelOverrides,
          [definition.id]: input.enabled
        }
      },
      result: undefined
    }));
    await this.syncModelConfigStore(false);
    this.emitStateChanged({
      reason: "model_toggled",
      provider: definition.provider
    });
    return this.getState();
  }

  async setDefaultModel(
    input: SubscriptionSetDefaultModelInput
  ): Promise<SubscriptionSettingsSnapshot> {
    if (!isSubscriptionModel(input.modelId)) {
      throw new SubscriptionError(
        "subscriptions.model_not_found",
        "指定的模型不是订阅托管模型。"
      );
    }
    const definition = await this.findModelDefinition(input.modelId);
    if (!definition) {
      throw new SubscriptionError(
        "subscriptions.model_not_found",
        "未找到指定的订阅模型。"
      );
    }
    const state = await this.persistence.read();
    const hasEnabledAccount = state.accounts.some(
      (account) => account.provider === definition.provider && account.enabled
    );
    if (!hasEnabledAccount) {
      throw new SubscriptionError(
        "subscriptions.pool_exhausted",
        "该模型所属平台暂无已启用的订阅账号，无法设为默认模型。"
      );
    }
    await this.persistence.update((current) => ({
      state: {
        ...current,
        modelOverrides: {
          ...current.modelOverrides,
          [definition.id]: true
        }
      },
      result: undefined
    }));
    if (this.modelStoreSync) {
      await this.modelStoreSync.syncSubscriptions({ autoSelectDefault: false });
      await this.modelStoreSync.setDefaultModel(definition.id);
    }
    this.emitStateChanged({
      reason: "default_model_changed",
      provider: definition.provider,
      defaultModelId: definition.id
    });
    return this.getState();
  }

  /** Internal Main/Agent bridge: never exposed to Renderer. */
  async acquireCredential(
    input: Pick<
      SubscriptionAcquireCredentialInput,
      "provider" | "modelId" | "accountId"
    >
  ): Promise<SubscriptionAcquiredCredential> {
    const adapter = this.registry.require(input.provider);
    const model = await this.requireModelDefinition(
      input.provider,
      input.modelId
    );
    const exclude = new Set<string>();

    while (true) {
      const selection = await this.selectFromPersistedPool(input.provider, {
        excludeAccountIds: exclude,
        ...(input.accountId && !exclude.has(input.accountId)
          ? { preferredAccountId: input.accountId }
          : {})
      });
      if (!selection.ok) {
        throw new SubscriptionError(selection.code, selection.message);
      }
      try {
        const secret = await this.ensureFreshSecret(adapter, selection.account);
        await this.recordAccountUsed(selection.account.id);
        return this.buildRuntimeCredential(
          adapter,
          selection.account,
          secret,
          model
        );
      } catch (error) {
        if (
          error instanceof SubscriptionError &&
          error.code === "subscriptions.secret_refresh_failed"
        ) {
          exclude.add(selection.account.id);
          continue;
        }
        throw error;
      }
    }
  }

  /** Internal Main/Agent bridge: handles 429/quota/401 failover inside an active run. */
  async reportAndFailover(
    input: Pick<
      SubscriptionReportAndFailoverInput,
      | "provider"
      | "modelId"
      | "failedAccountId"
      | "reason"
      | "retryAfterSec"
      | "resetAt"
      | "message"
    >
  ): Promise<SubscriptionAcquiredCredential> {
    const adapter = this.registry.require(input.provider);
    const model = await this.requireModelDefinition(
      input.provider,
      input.modelId
    );

    if (input.reason === "unauthorized" || input.reason === "forbidden") {
      const refreshed = await this.tryRefreshBeforeExpiring(
        adapter,
        input.provider,
        input.failedAccountId,
        model
      );
      if (refreshed) {
        return refreshed;
      }
    }

    await this.persistence.update((state) => {
      const index = state.accounts.findIndex(
        (account) =>
          account.provider === input.provider &&
          account.id === input.failedAccountId
      );
      if (index < 0) {
        return { state, result: undefined, write: false };
      }
      const nextAccounts = [...state.accounts];
      nextAccounts[index] = applyAccountFailure(
        nextAccounts[index]!,
        {
          reason: input.reason,
          ...(input.retryAfterSec !== undefined
            ? { retryAfterSec: input.retryAfterSec }
            : {}),
          ...(input.resetAt !== undefined ? { resetAt: input.resetAt } : {}),
          ...(input.message !== undefined ? { message: input.message } : {})
        },
        this.now()
      );
      return {
        state: { ...state, accounts: nextAccounts },
        result: undefined
      };
    });

    this.emitStateChanged({
      reason: "account_status_changed",
      provider: input.provider,
      accountId: input.failedAccountId
    });

    const exclude = new Set<string>([input.failedAccountId]);
    while (true) {
      const selection = await this.selectFromPersistedPool(input.provider, {
        excludeAccountIds: exclude
      });
      if (!selection.ok) {
        throw new SubscriptionError(selection.code, selection.message);
      }
      try {
        const secret = await this.ensureFreshSecret(adapter, selection.account);
        await this.recordAccountUsed(selection.account.id);
        this.emitStateChanged({
          reason: "failover",
          provider: input.provider,
          accountId: selection.account.id
        });
        return this.buildRuntimeCredential(
          adapter,
          selection.account,
          secret,
          model
        );
      } catch (error) {
        if (
          error instanceof SubscriptionError &&
          error.code === "subscriptions.secret_refresh_failed"
        ) {
          exclude.add(selection.account.id);
          continue;
        }
        throw error;
      }
    }
  }

  /** SubscriptionCatalogReader implementation for ModelConfigStore. */
  async getCatalog(): Promise<SubscriptionModelCatalog> {
    const state = await this.persistence.read();
    const projectedModels: ReturnType<typeof toModelConfigInput>[] = [];
    let preferredDefaultModelId: string | undefined;
    let firstEnabledModelId: string | undefined;

    for (const entry of this.registry.listEntries()) {
      const hasEnabledAccount = state.accounts.some(
        (account) => account.provider === entry.provider && account.enabled
      );
      if (!hasEnabledAccount) continue;
      const definitions = await this.resolveModelsForProvider(
        state,
        entry.provider,
        entry.adapter
      );
      for (const definition of definitions) {
        if (!isModelEnabled(definition, state.modelOverrides)) continue;
        const modelInput = toModelConfigInput(definition);
        projectedModels.push(modelInput);
        if (!firstEnabledModelId) {
          firstEnabledModelId = modelInput.id;
        }
        if (definition.recommended && !preferredDefaultModelId) {
          preferredDefaultModelId = modelInput.id;
        }
      }
    }

    const defaultCandidate = preferredDefaultModelId ?? firstEnabledModelId;
    return {
      models: projectedModels,
      ...(defaultCandidate ? { preferredDefaultModelId: defaultCandidate } : {})
    };
  }

  async resolveRuntimeCredential(model: {
    id: string;
    provider: string;
    modelId: string;
  }): Promise<{
    apiKey: string;
    baseUrl?: string;
    subscriptionAuth: SubscriptionRuntimeAuth;
  }> {
    const provider = model.provider as SubscriptionProviderId;
    const credential = await this.acquireCredential({
      provider,
      modelId: model.id
    });
    return {
      apiKey: credential.apiKey,
      ...(credential.baseUrl ? { baseUrl: credential.baseUrl } : {}),
      subscriptionAuth: {
        provider: credential.provider,
        accountId: credential.accountId,
        ...(credential.expiresAt ? { expiresAt: credential.expiresAt } : {}),
        ...(credential.extraHeaders
          ? { extraHeaders: credential.extraHeaders }
          : {}),
        ...(credential.metadata ? { metadata: credential.metadata } : {})
      }
    };
  }

  private async importAccount(
    adapter: SubscriptionProviderAdapter,
    imported: ImportedAccountResult
  ): Promise<SubscriptionSettingsSnapshot> {
    const saved = await this.persistAccount(adapter.id, imported);
    const autoDefaultModelId = await this.syncImportedModels(
      adapter,
      saved,
      imported.secret
    );
    this.emitStateChanged({
      reason: saved.updated ? "account_updated" : "account_added",
      provider: adapter.id,
      accountId: saved.accountId,
      ...(autoDefaultModelId ? { autoDefaultModelId } : {})
    });
    return this.getState();
  }

  private async persistAccount(
    provider: SubscriptionProviderId,
    imported: ImportedAccountResult
  ) {
    const encryptedSecret = this.persistence.encryptSecret(imported.secret);
    const nowIso = new Date(this.now()).toISOString();

    return this.persistence.update((state) => {
      const hadEnabledForProvider = state.accounts.some(
        (account) => account.provider === provider && account.enabled
      );
      const emailKey = normalizeEmailKey(imported.email);
      const existingIndex = state.accounts.findIndex((account) => {
        if (account.provider !== provider) return false;
        const previousEmail = normalizeEmailKey(account.email);
        if (emailKey && previousEmail) return emailKey === previousEmail;
        const encrypted = state.encryptedSecrets[account.id];
        if (!encrypted) return false;
        let previous: StoredAccountSecret;
        try {
          previous = this.persistence.decryptSecret(encrypted);
        } catch (error) {
          if (
            error instanceof SubscriptionError &&
            error.code === "subscriptions.secret_decrypt_failed"
          )
            return false;
          throw error;
        }
        const { accessToken, refreshToken } = imported.secret;
        return (
          (accessToken !== "pending-refresh" &&
            previous.accessToken === accessToken) ||
          Boolean(refreshToken && previous.refreshToken === refreshToken)
        );
      });

      const nextAccounts = [...state.accounts];
      let accountId: string;
      let updated = false;

      if (existingIndex >= 0) {
        const existing = nextAccounts[existingIndex]!;
        accountId = existing.id;
        updated = true;
        const {
          cooldownUntil: _cooldownUntil,
          statusMessage: _statusMessage,
          ...rest
        } = existing;
        nextAccounts[existingIndex] = {
          ...rest,
          displayName: imported.displayName,
          ...(imported.email !== undefined ? { email: imported.email } : {}),
          ...(imported.planTier !== undefined
            ? { planTier: imported.planTier }
            : {}),
          source: imported.source,
          enabled: true,
          status: "active",
          consecutiveRateLimits: 0,
          quotaBuckets: imported.quotaBuckets ?? existing.quotaBuckets,
          ...(imported.quotaBuckets ? { quotaUpdatedAt: nowIso } : {})
        };
      } else {
        const providerCount = state.accounts.filter(
          (account) => account.provider === provider
        ).length;
        if (providerCount >= SUBSCRIPTION_MAX_ACCOUNTS_PER_PROVIDER) {
          throw new SubscriptionError(
            "subscriptions.account_limit_reached",
            `单个平台最多保存 ${SUBSCRIPTION_MAX_ACCOUNTS_PER_PROVIDER} 个订阅账号。`
          );
        }
        accountId = createId("sub_acct");
        nextAccounts.push({
          id: accountId,
          provider,
          displayName: imported.displayName,
          ...(imported.email !== undefined ? { email: imported.email } : {}),
          ...(imported.planTier !== undefined
            ? { planTier: imported.planTier }
            : {}),
          source: imported.source,
          isPrimary: providerCount === 0,
          enabled: true,
          status: "active",
          consecutiveRateLimits: 0,
          quotaBuckets: imported.quotaBuckets ?? [],
          ...(imported.quotaBuckets ? { quotaUpdatedAt: nowIso } : {}),
          createdAt: nowIso
        });
      }

      const normalized = normalizeProviderPrimary(nextAccounts, provider);
      return {
        state: {
          ...state,
          accounts: normalized,
          encryptedSecrets: {
            ...state.encryptedSecrets,
            [accountId]: encryptedSecret
          }
        },
        result: {
          accountId,
          updated,
          encryptedSecret,
          account: normalized.find((account) => account.id === accountId)!,
          firstEnabledForProvider: !hadEnabledForProvider
        }
      };
    });
  }

  private async syncImportedModels(
    adapter: SubscriptionProviderAdapter,
    saved: {
      account: StoredAccountRecord;
      firstEnabledForProvider: boolean;
      encryptedSecret: string;
    },
    secret: StoredAccountSecret
  ): Promise<string | undefined> {
    await this.refreshCachedModels(
      adapter,
      saved.account,
      secret,
      saved.encryptedSecret
    );
    return this.syncModelConfigStore(saved.firstEnabledForProvider);
  }

  private async refreshCachedModels(
    adapter: SubscriptionProviderAdapter,
    account: StoredAccountRecord,
    secret: StoredAccountSecret,
    expectedSecret?: string
  ): Promise<void> {
    let models: SubscriptionModelDefinition[];
    try {
      models = await adapter.listModels(
        account,
        secret,
        AbortSignal.timeout(15_000)
      );
    } catch {
      // Reading the catalog already falls back to the baseline when no cache exists.
      return;
    }
    const bounded = models.slice(0, SUBSCRIPTION_MAX_MODELS_PER_PROVIDER);
    await this.persistence.update((state) => {
      if (
        !state.encryptedSecrets[account.id] ||
        (expectedSecret &&
          state.encryptedSecrets[account.id] !== expectedSecret)
      ) {
        return { state, result: undefined, write: false };
      }
      return {
        state: {
          ...state,
          cachedModels: { ...state.cachedModels, [adapter.id]: bounded }
        },
        result: undefined
      };
    });
  }

  private async resolveModelsForProvider(
    state: PersistedSubscriptionState,
    provider: SubscriptionProviderId,
    adapter?: SubscriptionProviderAdapter
  ): Promise<SubscriptionModelDefinition[]> {
    const hasAccounts = state.accounts.some(
      (account) => account.provider === provider
    );
    const cached = state.cachedModels[provider];
    if (hasAccounts && cached && cached.length > 0) {
      return cached;
    }
    if (!adapter) return [];
    try {
      return (await adapter.listModels()).slice(
        0,
        SUBSCRIPTION_MAX_MODELS_PER_PROVIDER
      );
    } catch {
      return [];
    }
  }

  private async findModelDefinition(
    modelId: string
  ): Promise<SubscriptionModelDefinition | undefined> {
    const state = await this.persistence.read();
    for (const entry of this.registry.listEntries()) {
      const models = await this.resolveModelsForProvider(
        state,
        entry.provider,
        entry.adapter
      );
      const found = models.find((model) => model.id === modelId);
      if (found) return found;
    }
    return undefined;
  }

  private async requireModelDefinition(
    provider: SubscriptionProviderId,
    modelId: string
  ): Promise<SubscriptionModelDefinition> {
    const state = await this.persistence.read();
    const models = await this.resolveModelsForProvider(
      state,
      provider,
      this.registry.get(provider)
    );
    const found = models.find(
      (model) => model.id === modelId || model.modelId === modelId
    );
    if (!found) {
      throw new SubscriptionError(
        "subscriptions.model_not_found",
        "未找到指定的订阅模型。"
      );
    }
    return found;
  }

  private async selectFromPersistedPool(
    provider: SubscriptionProviderId,
    options: {
      excludeAccountIds?: ReadonlySet<string>;
      preferredAccountId?: string;
    }
  ) {
    let recoveredCount = 0;
    const selection = await this.persistence.update((state) => {
      const result = selectAccountForProvider(state.accounts, provider, {
        nowMs: this.now(),
        ...(options.excludeAccountIds
          ? { excludeAccountIds: options.excludeAccountIds }
          : {}),
        ...(options.preferredAccountId
          ? { preferredAccountId: options.preferredAccountId }
          : {})
      });
      recoveredCount = result.recoveredIds.length;
      return {
        state: { ...state, accounts: result.accounts },
        result,
        write: recoveredCount > 0
      };
    });
    if (recoveredCount > 0) {
      this.emitStateChanged({ reason: "cooldown_recovered", provider });
    }
    return selection;
  }

  private async ensureFreshSecret(
    adapter: SubscriptionProviderAdapter,
    account: StoredAccountRecord,
    forceRefresh = false
  ): Promise<StoredAccountSecret> {
    const state = await this.persistence.read();
    const secret = this.persistence.decryptSecret(
      state.encryptedSecrets[account.id]
    );
    if (!forceRefresh && !isSecretExpiringSoon(secret, this.now())) {
      return secret;
    }
    return this.refreshLock.run(account.id, async () => {
      const latestState = await this.persistence.read();
      const latestAccount = latestState.accounts.find(
        (candidate) => candidate.id === account.id
      );
      if (!latestAccount || !latestAccount.enabled) {
        throw new SubscriptionError(
          "subscriptions.account_not_found",
          "订阅账号已停用或不存在。"
        );
      }
      const latestSecret = this.persistence.decryptSecret(
        latestState.encryptedSecrets[account.id]
      );
      if (!forceRefresh && !isSecretExpiringSoon(latestSecret, this.now())) {
        return latestSecret;
      }
      try {
        const refreshed = await adapter.refreshSecret(
          latestAccount,
          latestSecret
        );
        const encrypted = this.persistence.encryptSecret(refreshed);
        await this.persistence.update((current) => {
          const index = current.accounts.findIndex(
            (candidate) => candidate.id === account.id
          );
          if (index < 0) {
            return { state: current, result: undefined, write: false };
          }
          const nextAccounts = [...current.accounts];
          const existing = nextAccounts[index]!;
          const { statusMessage: _statusMessage, ...rest } = existing;
          nextAccounts[index] = {
            ...rest,
            status: existing.enabled ? "active" : "disabled"
          };
          return {
            state: {
              ...current,
              accounts: nextAccounts,
              encryptedSecrets: {
                ...current.encryptedSecrets,
                [account.id]: encrypted
              }
            },
            result: undefined
          };
        });
        return refreshed;
      } catch (error) {
        if (
          error instanceof SubscriptionError &&
          error.code === "subscriptions.safe_storage_unavailable"
        ) {
          throw error;
        }
        await this.persistence.update((current) => {
          const index = current.accounts.findIndex(
            (candidate) => candidate.id === account.id
          );
          if (index < 0) {
            return { state: current, result: undefined, write: false };
          }
          const nextAccounts = [...current.accounts];
          nextAccounts[index] = applyAccountFailure(
            nextAccounts[index]!,
            {
              reason: "unauthorized",
              message: "登录凭证刷新失败，请重新登录或导入该账号。"
            },
            this.now()
          );
          return {
            state: { ...current, accounts: nextAccounts },
            result: undefined
          };
        });
        this.emitStateChanged({
          reason: "account_status_changed",
          provider: account.provider,
          accountId: account.id
        });
        throw new SubscriptionError(
          "subscriptions.secret_refresh_failed",
          "订阅账号凭证刷新失败，已标记为失效。"
        );
      }
    });
  }

  private async tryRefreshBeforeExpiring(
    adapter: SubscriptionProviderAdapter,
    provider: SubscriptionProviderId,
    accountId: string,
    model: SubscriptionModelDefinition
  ): Promise<SubscriptionAcquiredCredential | undefined> {
    const state = await this.persistence.read();
    const account = state.accounts.find(
      (candidate) =>
        candidate.provider === provider &&
        candidate.id === accountId &&
        candidate.enabled
    );
    if (!account) return undefined;
    try {
      const refreshedSecret = await this.ensureFreshSecret(
        adapter,
        account,
        true
      );
      await this.recordAccountUsed(account.id);
      return this.buildRuntimeCredential(
        adapter,
        account,
        refreshedSecret,
        model
      );
    } catch {
      return undefined;
    }
  }

  private buildRuntimeCredential(
    adapter: SubscriptionProviderAdapter,
    account: StoredAccountRecord,
    secret: StoredAccountSecret,
    model: SubscriptionModelDefinition
  ): SubscriptionAcquiredCredential {
    const raw = adapter.toRuntimeCredential(account, secret, model);
    return SubscriptionAcquiredCredentialSchema.parse(raw);
  }

  private async recordAccountUsed(accountId: string): Promise<void> {
    await this.persistence.update((state) => {
      const index = state.accounts.findIndex(
        (account) => account.id === accountId
      );
      if (index < 0) return { state, result: undefined, write: false };
      const nextAccounts = [...state.accounts];
      nextAccounts[index] = markAccountUsed(nextAccounts[index]!, this.now());
      return {
        state: { ...state, accounts: nextAccounts },
        result: undefined
      };
    });
  }

  private async syncModelConfigStore(
    autoSelectDefault: boolean
  ): Promise<string | undefined> {
    if (!this.modelStoreSync) return undefined;
    const previousDefault = await this.modelStoreSync.getDefaultModelId();
    const updated = await this.modelStoreSync.syncSubscriptions({
      autoSelectDefault
    });
    if (
      autoSelectDefault &&
      updated.defaultModelId &&
      updated.defaultModelId !== previousDefault &&
      isSubscriptionModel(updated.defaultModelId)
    ) {
      return updated.defaultModelId;
    }
    return undefined;
  }

  private async buildSnapshot(
    state: PersistedSubscriptionState,
    defaultModelId: string
  ): Promise<SubscriptionSettingsSnapshot> {
    const providers = await Promise.all(
      this.registry.listEntries().map(async (entry) => {
        const accounts = state.accounts
          .filter((account) => account.provider === entry.provider)
          .slice(0, SUBSCRIPTION_MAX_ACCOUNTS_PER_PROVIDER)
          .map(toAccountSummary);
        const definitions = await this.resolveModelsForProvider(
          state,
          entry.provider,
          entry.adapter
        );
        const models = definitions
          .slice(0, SUBSCRIPTION_MAX_MODELS_PER_PROVIDER)
          .map((definition) =>
            SubscriptionModelItemSchema.parse({
              id: definition.id,
              provider: definition.provider,
              modelId: definition.modelId,
              label: definition.label,
              ...(definition.description !== undefined
                ? { description: definition.description }
                : {}),
              api: definition.api,
              reasoning: definition.reasoning,
              defaultThinkingLevel: definition.defaultThinkingLevel,
              ...(definition.thinkingLevelOptions
                ? { thinkingLevelOptions: definition.thinkingLevelOptions }
                : {}),
              ...(definition.contextWindow !== undefined
                ? { contextWindow: definition.contextWindow }
                : {}),
              ...(definition.maxTokens !== undefined
                ? { maxTokens: definition.maxTokens }
                : {}),
              enabled: isModelEnabled(definition, state.modelOverrides),
              ...(definition.recommended !== undefined
                ? { recommended: definition.recommended }
                : {})
            })
          );

        return SubscriptionProviderOverviewSchema.parse({
          provider: entry.provider,
          name: entry.meta.name,
          description: entry.meta.description,
          phase: entry.meta.phase,
          implemented: entry.implemented,
          ...(entry.meta.unofficialWarning !== undefined
            ? { unofficialWarning: entry.meta.unofficialWarning }
            : {}),
          supportedAuthMethods: [...entry.meta.supportedAuthMethods],
          accounts,
          models
        });
      })
    );

    return SubscriptionSettingsSnapshotSchema.parse({
      providers,
      defaultModelId
    });
  }

  private emitAuthProgress(payload: SubscriptionAuthProgressPayload): void {
    this.events?.emitAuthProgress(
      SubscriptionAuthProgressPayloadSchema.parse(payload)
    );
  }

  private emitStateChanged(payload: SubscriptionStateChangedPayload): void {
    this.events?.emitStateChanged(
      SubscriptionStateChangedPayloadSchema.parse(payload)
    );
  }
}
