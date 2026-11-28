import { safeStorage } from "electron";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  ModelApiSchema,
  SUBSCRIPTION_MAX_ACCOUNTS_PER_PROVIDER,
  SUBSCRIPTION_MAX_MODELS_PER_PROVIDER,
  SubscriptionAccountStatusSchema,
  SubscriptionAuthMethodSchema,
  SubscriptionProviderIdSchema,
  SubscriptionQuotaBucketSchema,
  ThinkingLevelSchema,
  ThinkingLevelOptionsSchema,
  type SubscriptionProviderId
} from "@writer/contracts";
import { randomHex8 } from "@writer/shared";
import { withConfigurationLock } from "../configuration-lock";
import {
  SubscriptionError,
  type PersistedSubscriptionState,
  type SecureStorageLike,
  type StoredAccountRecord,
  type StoredAccountSecret,
  type SubscriptionModelDefinition
} from "./types";

const EMPTY_STATE: PersistedSubscriptionState = {
  version: 1,
  accounts: [],
  modelOverrides: {},
  cachedModels: {},
  encryptedSecrets: {}
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    isRecord(value) &&
    Object.values(value).every((entry) => typeof entry === "string")
  );
}

function normalizeStoredAccount(raw: unknown): StoredAccountRecord {
  if (!isRecord(raw)) {
    throw new SubscriptionError(
      "subscriptions.corrupted_store",
      "订阅账号配置文件损坏，无法读取。"
    );
  }
  const provider = SubscriptionProviderIdSchema.safeParse(raw.provider);
  const source = SubscriptionAuthMethodSchema.safeParse(raw.source);
  const status = SubscriptionAccountStatusSchema.safeParse(raw.status);
  if (
    !provider.success ||
    !source.success ||
    !status.success ||
    typeof raw.id !== "string" ||
    !raw.id.trim() ||
    typeof raw.displayName !== "string" ||
    !raw.displayName.trim() ||
    typeof raw.isPrimary !== "boolean" ||
    typeof raw.enabled !== "boolean" ||
    typeof raw.createdAt !== "string"
  ) {
    throw new SubscriptionError(
      "subscriptions.corrupted_store",
      "订阅账号配置文件中的账号记录损坏，无法读取。"
    );
  }
  const quotaBuckets = Array.isArray(raw.quotaBuckets)
    ? raw.quotaBuckets.flatMap((bucket) => {
        const parsed = SubscriptionQuotaBucketSchema.safeParse(bucket);
        return parsed.success ? [parsed.data] : [];
      })
    : [];
  const consecutiveRateLimits =
    typeof raw.consecutiveRateLimits === "number" &&
    Number.isInteger(raw.consecutiveRateLimits) &&
    raw.consecutiveRateLimits >= 0
      ? raw.consecutiveRateLimits
      : 0;
  return {
    id: raw.id,
    provider: provider.data,
    displayName: raw.displayName,
    ...(typeof raw.email === "string" && raw.email ? { email: raw.email } : {}),
    ...(typeof raw.planTier === "string" && raw.planTier
      ? { planTier: raw.planTier }
      : {}),
    source: source.data,
    isPrimary: raw.isPrimary,
    enabled: raw.enabled,
    status: status.data,
    ...(typeof raw.statusMessage === "string" && raw.statusMessage
      ? { statusMessage: raw.statusMessage }
      : {}),
    ...(typeof raw.cooldownUntil === "string" && raw.cooldownUntil
      ? { cooldownUntil: raw.cooldownUntil }
      : {}),
    consecutiveRateLimits,
    ...(typeof raw.quotaUpdatedAt === "string" && raw.quotaUpdatedAt
      ? { quotaUpdatedAt: raw.quotaUpdatedAt }
      : {}),
    quotaBuckets,
    createdAt: raw.createdAt,
    ...(typeof raw.lastUsedAt === "string" && raw.lastUsedAt
      ? { lastUsedAt: raw.lastUsedAt }
      : {})
  };
}

function normalizeCachedModel(
  raw: unknown
): SubscriptionModelDefinition | null {
  if (!isRecord(raw)) return null;
  const provider = SubscriptionProviderIdSchema.safeParse(raw.provider);
  const api = ModelApiSchema.safeParse(raw.api);
  const levels =
    raw.thinkingLevelOptions === undefined
      ? undefined
      : ThinkingLevelOptionsSchema.safeParse(raw.thinkingLevelOptions);
  const defaultThinkingLevel = ThinkingLevelSchema.safeParse(
    raw.defaultThinkingLevel
  );
  if (
    !provider.success ||
    !api.success ||
    !defaultThinkingLevel.success ||
    typeof raw.id !== "string" ||
    !raw.id.trim() ||
    typeof raw.modelId !== "string" ||
    !raw.modelId.trim() ||
    typeof raw.label !== "string" ||
    !raw.label.trim() ||
    typeof raw.reasoning !== "boolean"
  ) {
    return null;
  }
  return {
    id: raw.id,
    provider: provider.data,
    modelId: raw.modelId,
    label: raw.label,
    ...(typeof raw.description === "string"
      ? { description: raw.description }
      : {}),
    api: api.data,
    ...(typeof raw.baseUrl === "string" ? { baseUrl: raw.baseUrl } : {}),
    ...(typeof raw.requestModelId === "string"
      ? { requestModelId: raw.requestModelId }
      : {}),
    ...(typeof raw.supportsDeveloperRole === "boolean"
      ? { supportsDeveloperRole: raw.supportsDeveloperRole }
      : {}),
    reasoning: raw.reasoning,
    defaultThinkingLevel: defaultThinkingLevel.data,
    ...(levels?.success ? { thinkingLevelOptions: levels.data } : {}),
    ...(typeof raw.contextWindow === "number" &&
    typeof raw.maxTokens === "number"
      ? { contextWindow: raw.contextWindow, maxTokens: raw.maxTokens }
      : {}),
    ...(typeof raw.recommended === "boolean"
      ? { recommended: raw.recommended }
      : {})
  };
}

function normalizePersistedState(raw: unknown): PersistedSubscriptionState {
  if (raw === undefined) {
    return structuredClone(EMPTY_STATE);
  }
  if (!isRecord(raw) || raw.version !== 1) {
    throw new SubscriptionError(
      "subscriptions.corrupted_store",
      "订阅账号配置文件版本不受支持，无法读取。"
    );
  }
  if (
    !Array.isArray(raw.accounts) ||
    !isRecord(raw.encryptedSecrets) ||
    Object.values(raw.encryptedSecrets).some(
      (value) => typeof value !== "string" || value.length === 0
    )
  ) {
    throw new SubscriptionError(
      "subscriptions.corrupted_store",
      "订阅账号配置文件中的加密凭证数据损坏，无法读取。"
    );
  }
  const accounts = raw.accounts.map(normalizeStoredAccount);
  const perProviderCounts = new Map<SubscriptionProviderId, number>();
  const seenAccountIds = new Set<string>();
  const dedupedAccounts: StoredAccountRecord[] = [];
  for (const account of accounts) {
    if (seenAccountIds.has(account.id)) continue;
    const count = perProviderCounts.get(account.provider) ?? 0;
    if (count >= SUBSCRIPTION_MAX_ACCOUNTS_PER_PROVIDER) continue;
    seenAccountIds.add(account.id);
    perProviderCounts.set(account.provider, count + 1);
    dedupedAccounts.push(account);
  }
  const modelOverrides: Record<string, boolean> = {};
  if (isRecord(raw.modelOverrides)) {
    for (const [key, value] of Object.entries(raw.modelOverrides)) {
      if (typeof value === "boolean" && key.length > 0 && key.length <= 120) {
        modelOverrides[key] = value;
      }
    }
  }
  const cachedModels: Partial<
    Record<SubscriptionProviderId, SubscriptionModelDefinition[]>
  > = {};
  if (isRecord(raw.cachedModels)) {
    for (const [key, list] of Object.entries(raw.cachedModels)) {
      const provider = SubscriptionProviderIdSchema.safeParse(key);
      if (!provider.success || !Array.isArray(list)) continue;
      cachedModels[provider.data] = list
        .slice(0, SUBSCRIPTION_MAX_MODELS_PER_PROVIDER)
        .map(normalizeCachedModel)
        .filter((item): item is SubscriptionModelDefinition => item !== null);
    }
  }
  return {
    version: 1,
    accounts: dedupedAccounts,
    modelOverrides,
    cachedModels,
    encryptedSecrets: { ...(raw.encryptedSecrets as Record<string, string>) }
  };
}

function validateSecret(raw: unknown): StoredAccountSecret {
  if (
    !isRecord(raw) ||
    typeof raw.accessToken !== "string" ||
    !raw.accessToken
  ) {
    throw new SubscriptionError(
      "subscriptions.secret_decrypt_failed",
      "订阅账号凭证数据不完整，请重新登录或导入。"
    );
  }
  return {
    accessToken: raw.accessToken,
    ...(typeof raw.refreshToken === "string" && raw.refreshToken
      ? { refreshToken: raw.refreshToken }
      : {}),
    ...(typeof raw.idToken === "string" && raw.idToken
      ? { idToken: raw.idToken }
      : {}),
    ...(typeof raw.expiresAt === "string" && raw.expiresAt
      ? { expiresAt: raw.expiresAt }
      : {}),
    ...(typeof raw.providerToken === "string" && raw.providerToken
      ? { providerToken: raw.providerToken }
      : {}),
    ...(typeof raw.providerTokenExpiresAt === "string" &&
    raw.providerTokenExpiresAt
      ? { providerTokenExpiresAt: raw.providerTokenExpiresAt }
      : {}),
    ...(isStringRecord(raw.extra) ? { extra: raw.extra } : {})
  };
}

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    // Never expose raw file contents or tokens in parse error messages.
    if (error instanceof SyntaxError) {
      throw new SubscriptionError(
        "subscriptions.corrupted_store",
        "订阅账号配置文件损坏，无法读取。"
      );
    }
    throw error;
  }
}

async function syncDirectory(path: string): Promise<void> {
  const unsupported = new Set(["EPERM", "EISDIR", "ENOTSUP", "EINVAL"]);
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(path, "r");
    await handle.sync();
  } catch (error: unknown) {
    if (!unsupported.has((error as NodeJS.ErrnoException).code ?? "")) {
      throw error;
    }
  } finally {
    await handle?.close();
  }
}

export interface SubscriptionPersistenceOptions {
  secureStorage?: SecureStorageLike;
}

/** Main-only local encrypted storage for subscription accounts; never participates in cloud sync. */
export class SubscriptionPersistence {
  readonly filePath: string;
  private readonly secureStorage: SecureStorageLike;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(
    userDataPath: string,
    options: SubscriptionPersistenceOptions = {}
  ) {
    this.filePath = join(userDataPath, "config", "subscription-accounts.json");
    this.secureStorage = options.secureStorage ?? safeStorage;
  }

  encryptSecret(secret: StoredAccountSecret): string {
    const validated = validateSecret(secret);
    if (!this.secureStorage.isEncryptionAvailable()) {
      throw new SubscriptionError(
        "subscriptions.safe_storage_unavailable",
        "当前系统安全存储不可用，Writer 不会将订阅账号凭证以明文写入磁盘。"
      );
    }
    try {
      return this.secureStorage
        .encryptString(JSON.stringify(validated))
        .toString("base64");
    } catch {
      throw new SubscriptionError(
        "subscriptions.safe_storage_unavailable",
        "当前系统安全存储加密失败，无法保存订阅账号凭证。"
      );
    }
  }

  decryptSecret(encrypted: string | undefined): StoredAccountSecret {
    if (!encrypted) {
      throw new SubscriptionError(
        "subscriptions.secret_missing",
        "该订阅账号缺少本地加密凭证，请重新登录或导入。"
      );
    }
    if (!this.secureStorage.isEncryptionAvailable()) {
      throw new SubscriptionError(
        "subscriptions.safe_storage_unavailable",
        "当前系统安全存储不可用，无法读取订阅账号凭证。"
      );
    }
    let decoded: string;
    try {
      decoded = this.secureStorage.decryptString(
        Buffer.from(encrypted, "base64")
      );
    } catch {
      throw new SubscriptionError(
        "subscriptions.secret_decrypt_failed",
        "订阅账号凭证解密失败，请重新登录或导入该账号。"
      );
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(decoded) as unknown;
    } catch {
      throw new SubscriptionError(
        "subscriptions.secret_decrypt_failed",
        "订阅账号凭证数据损坏，请重新登录或导入该账号。"
      );
    }
    return validateSecret(parsed);
  }

  async read(): Promise<PersistedSubscriptionState> {
    await this.writeChain;
    return this.readUnlocked();
  }

  async update<T>(
    mutate: (state: PersistedSubscriptionState) =>
      | Promise<{
          state: PersistedSubscriptionState;
          result: T;
          write?: boolean;
        }>
      | {
          state: PersistedSubscriptionState;
          result: T;
          write?: boolean;
        }
  ): Promise<T> {
    const operation = this.writeChain.then(() =>
      withConfigurationLock(this.filePath, async () => {
        const current = await this.readUnlocked();
        const next = await mutate(current);
        if (next.write !== false) {
          await this.writeUnlocked(next.state);
        }
        return next.result;
      })
    );
    this.writeChain = operation.then(
      () => undefined,
      () => undefined
    );
    return await operation;
  }

  private async readUnlocked(): Promise<PersistedSubscriptionState> {
    return normalizePersistedState(await readJson(this.filePath));
  }

  private async writeUnlocked(
    state: PersistedSubscriptionState
  ): Promise<void> {
    const activeIds = new Set(state.accounts.map((account) => account.id));
    const prunedSecrets = Object.fromEntries(
      Object.entries(state.encryptedSecrets).filter(
        ([accountId, value]) => activeIds.has(accountId) && value.length > 0
      )
    );
    const payload: PersistedSubscriptionState = {
      version: 1,
      accounts: state.accounts,
      modelOverrides: state.modelOverrides,
      cachedModels: state.cachedModels,
      encryptedSecrets: prunedSecrets
    };
    const directory = dirname(this.filePath);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const temporary = join(
      directory,
      `.subscription-accounts-${randomHex8()}.tmp`
    );
    let createdTemporary = false;
    try {
      const handle = await open(temporary, "wx", 0o600);
      createdTemporary = true;
      try {
        await handle.writeFile(`${JSON.stringify(payload, null, 2)}\n`, "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(temporary, this.filePath);
      await syncDirectory(directory);
    } finally {
      if (createdTemporary) {
        await rm(temporary, { force: true }).catch(() => undefined);
      }
    }
  }
}
