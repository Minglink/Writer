import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type {
  ModelConfigInput,
  SubscriptionAccountSummary,
  SubscriptionInteractiveAuthMethod,
  SubscriptionLocalCandidate,
  SubscriptionModelItem,
  SubscriptionProviderId,
  SubscriptionProviderOverview,
  SubscriptionSettingsSnapshot,
  SubscriptionStartAuthResult,
  SystemEventEnvelope,
  WriterApi
} from "@writer/contracts/renderer";
import { getErrorDetail } from "../../i18n/errors";
import { uiMessage } from "../../ui-feedback";
import { formatSubscriptionError, subT } from "./subscriptionLabels";

export interface AuthDialogState extends SubscriptionStartAuthResult {
  providerName: string;
  status: "pending" | "completed" | "failed" | "cancelled";
  errorMessage?: string;
  callbackReceived?: boolean;
}

export interface LocalScanDialogState {
  open: boolean;
  scanning: boolean;
  importing: boolean;
  providerFilter?: SubscriptionProviderId;
  candidates: SubscriptionLocalCandidate[];
}

export interface UseSubscriptionModelSettingsOptions {
  api?: () => WriterApi | undefined;
  onModelsChanged?: () => void;
}

export function useSubscriptionModelSettings(
  options: UseSubscriptionModelSettingsOptions = {}
) {
  const resolveApi = options.api ?? (() => window.writer);

  const snapshot = ref<SubscriptionSettingsSnapshot | null>(null);
  const loaded = ref(false);
  const initialLoading = ref(false);
  const loadError = ref<string | null>(null);
  const selectedProviderId = ref<SubscriptionProviderId>("google-gemini-cli");
  const showUpcomingProviders = ref(false);
  const nowMs = ref(Date.now());

  const pendingKeys = ref<ReadonlySet<string>>(new Set());
  const testingModelId = ref<string | null>(null);
  const pendingDefaultModelId = ref<string | null>(null);

  const startingAuth = ref(false);
  let disposed = false;
  type AuthEvent = Extract<
    SystemEventEnvelope,
    { type: "subscriptions.authProgress" }
  >;
  const earlyAuthEvents = new Map<string, AuthEvent>();
  const manualLoginUri = ref("");
  const authSession = ref<AuthDialogState | null>(null);
  const scanDialog = ref<LocalScanDialogState>({
    open: false,
    scanning: false,
    importing: false,
    candidates: []
  });
  const removeConfirmAccount = ref<SubscriptionAccountSummary | null>(null);
  const manualImportProvider = ref<SubscriptionProviderOverview | null>(null);
  const manualImportSubmitting = ref(false);

  const modelToggleSequences = new Map<string, number>();
  let defaultModelSequence = 0;
  let unsubscribeEvents: (() => void) | undefined;
  let clockTimer: ReturnType<typeof setInterval> | undefined;

  const providers = computed(() => snapshot.value?.providers ?? []);
  const implementedProviders = computed(() =>
    providers.value.filter((provider) => provider.implemented)
  );
  const upcomingProviders = computed(() =>
    providers.value.filter((provider) => !provider.implemented)
  );
  const activeProvider = computed<SubscriptionProviderOverview | undefined>(
    () =>
      implementedProviders.value.find(
        (provider) => provider.provider === selectedProviderId.value
      ) ?? implementedProviders.value[0]
  );

  function isPending(key: string): boolean {
    return pendingKeys.value.has(key);
  }

  function setPending(key: string, active: boolean): void {
    const next = new Set(pendingKeys.value);
    if (active) next.add(key);
    else next.delete(key);
    pendingKeys.value = next;
  }

  function applySnapshot(next: SubscriptionSettingsSnapshot): void {
    snapshot.value = next;
    loaded.value = true;
    loadError.value = null;
    const validImplemented = next.providers.filter((item) => item.implemented);
    if (
      validImplemented.length > 0 &&
      !validImplemented.some(
        (item) => item.provider === selectedProviderId.value
      )
    ) {
      selectedProviderId.value = validImplemented[0]!.provider;
    }
  }

  function requireSubscriptionsApi() {
    const subApi = resolveApi()?.subscriptions;
    if (!subApi) {
      throw new Error(subT("runtimeUnavailable"));
    }
    return subApi;
  }

  async function load(silent = false): Promise<void> {
    if (!silent && !loaded.value) {
      initialLoading.value = true;
    }
    try {
      const next = await requireSubscriptionsApi().getState();
      applySnapshot(next);
    } catch (error: unknown) {
      const message = formatSubscriptionError(error, subT("errLoadFailed"));
      if (!loaded.value) {
        loadError.value = message;
      } else if (!silent) {
        uiMessage.error(message);
      }
    } finally {
      initialLoading.value = false;
    }
  }

  const quotaErrors = ref<Record<string, string>>({});
  function isQuotaPending(
    provider?: SubscriptionProviderId,
    accountId?: string
  ): boolean {
    const keys = pendingKeys.value;
    if (keys.has("refresh:all") || keys.has("refreshModels:all")) return true;
    if (!provider)
      return [...keys].some(
        (key) => key.startsWith("refresh:") || key.startsWith("refreshModels:")
      );
    if (
      keys.has(`refresh:provider:${provider}`) ||
      keys.has(`refreshModels:${provider}`)
    )
      return true;
    const accounts =
      providers.value.find((item) => item.provider === provider)?.accounts ??
      [];
    return accounts.some(
      (account) =>
        (!accountId || account.id === accountId) &&
        keys.has(`refresh:account:${account.id}`)
    );
  }

  async function refreshQuota(
    provider?: SubscriptionProviderId,
    accountId?: string,
    quiet = false
  ): Promise<void> {
    const key = accountId
      ? `refresh:account:${accountId}`
      : provider
        ? `refresh:provider:${provider}`
        : "refresh:all";
    if (isQuotaPending(provider, accountId)) return;
    setPending(key, true);
    try {
      const next = await requireSubscriptionsApi().refreshQuota({
        ...(provider ? { provider } : {}),
        ...(accountId ? { accountId } : {})
      });
      applySnapshot(next);
      options.onModelsChanged?.();
      const targeted = next.providers
        .filter((item) => !provider || item.provider === provider)
        .flatMap((item) => item.accounts)
        .filter(
          (account) =>
            account.enabled && (!accountId || account.id === accountId)
        );
      for (const account of targeted) delete quotaErrors.value[account.id];
      const failed = targeted.filter(
        (account) =>
          account.statusMessage &&
          account.status !== "quota_exhausted" &&
          account.status !== "cooldown"
      );
      if (quiet) return;
      if (failed.length)
        uiMessage.warning(subT("toastQuotaPartial", { count: failed.length }));
      else uiMessage.success(subT("toastQuotaRefreshed"));
    } catch (error: unknown) {
      const message = formatSubscriptionError(error);
      if (accountId) quotaErrors.value[accountId] = message;
      if (!quiet) uiMessage.error(message);
    } finally {
      setPending(key, false);
    }
  }

  async function refreshModels(
    provider?: SubscriptionProviderId
  ): Promise<void> {
    const key = provider ? `refreshModels:${provider}` : "refreshModels:all";
    if (isQuotaPending(provider)) return;
    setPending(key, true);
    try {
      const next = await requireSubscriptionsApi().refreshModels(
        provider ? { provider } : {}
      );
      applySnapshot(next);
      if (provider === "google-antigravity") {
        const accounts =
          next.providers
            .find((item) => item.provider === provider)
            ?.accounts.filter((account) => account.enabled) ?? [];
        const updated =
          accounts.find((account) => account.isPrimary) ?? accounts[0];
        if (updated) delete quotaErrors.value[updated.id];
      }
      options.onModelsChanged?.();
      uiMessage.success(subT("toastModelsRefreshed"));
    } catch (error: unknown) {
      uiMessage.error(formatSubscriptionError(error));
    } finally {
      setPending(key, false);
    }
  }

  watch(
    () => activeProvider.value?.provider,
    (provider) => {
      if (
        provider !== "google-antigravity" ||
        document.visibilityState !== "visible"
      )
        return;
      const enabled =
        activeProvider.value?.accounts.filter((account) => account.enabled) ??
        [];
      const primary =
        enabled.find((account) => account.isPrimary) ?? enabled[0];
      if (
        primary &&
        Date.now() - (Date.parse(primary.quotaUpdatedAt ?? "") || 0) >= 60_000
      ) {
        void refreshQuota(provider, primary.id, true);
      }
    }
  );

  async function startAuth(
    provider: SubscriptionProviderOverview,
    method: SubscriptionInteractiveAuthMethod
  ): Promise<void> {
    if (startingAuth.value || authSession.value) return;
    startingAuth.value = true;
    try {
      const api = requireSubscriptionsApi();
      const result = await api.startAuth({
        provider: provider.provider,
        method,
        ...(method === "oauth" ? { openBrowser: false } : {})
      });
      if (disposed) {
        await api.cancelAuth({ authSessionId: result.authSessionId });
        return;
      }
      authSession.value = {
        ...result,
        providerName: provider.name,
        status: "pending"
      };
      const earlyEvent = earlyAuthEvents.get(result.authSessionId);
      if (earlyEvent) handleDesktopEvent(earlyEvent);
    } catch (error: unknown) {
      if (!disposed)
        uiMessage.error(formatSubscriptionError(error, subT("errAuthFailed")));
    } finally {
      earlyAuthEvents.clear();
      startingAuth.value = false;
    }
  }

  async function cancelAuth(authSessionId: string): Promise<void> {
    const key = `cancelAuth:${authSessionId}`;
    if (isPending(key)) return;
    setPending(key, true);
    try {
      const result = await requireSubscriptionsApi().cancelAuth({
        authSessionId
      });
      if (!result.cancelled) return;
      if (authSession.value?.authSessionId === authSessionId) {
        authSession.value = null;
      }
      uiMessage.info(subT("toastAuthCancelled"));
    } catch (error: unknown) {
      uiMessage.error(formatSubscriptionError(error));
    } finally {
      setPending(key, false);
    }
  }

  function closeAuthDialog(): void {
    const session = authSession.value;
    if (!session) return;
    if (session.status === "pending") {
      void cancelAuth(session.authSessionId);
      return;
    }
    authSession.value = null;
  }

  async function openScanDialog(
    providerFilter?: SubscriptionProviderId
  ): Promise<void> {
    scanDialog.value = {
      open: true,
      scanning: true,
      importing: false,
      ...(providerFilter ? { providerFilter } : {}),
      candidates: []
    };
    try {
      const result = await requireSubscriptionsApi().scanLocal(
        providerFilter ? { provider: providerFilter } : {}
      );
      if (!scanDialog.value.open) return;
      scanDialog.value = {
        ...scanDialog.value,
        scanning: false,
        candidates: result.candidates
      };
    } catch (error: unknown) {
      if (!scanDialog.value.open) return;
      scanDialog.value = {
        ...scanDialog.value,
        scanning: false,
        candidates: []
      };
      uiMessage.error(formatSubscriptionError(error));
    }
  }

  function closeScanDialog(): void {
    if (scanDialog.value.importing) return;
    scanDialog.value = {
      open: false,
      scanning: false,
      importing: false,
      candidates: []
    };
  }

  function openManualImportDialog(
    provider: SubscriptionProviderOverview,
    browserLogin = false
  ): void {
    manualLoginUri.value =
      browserLogin && provider.provider === "windsurf"
        ? `https://windsurf.com/profile?response_type=token&redirect_uri=vim-show-auth-token&state=${crypto.randomUUID()}&scope=openid%20profile%20email&redirect_parameters_type=query`
        : "";
    manualImportProvider.value = provider;
  }

  function closeManualImportDialog(): void {
    if (manualImportSubmitting.value) return;
    manualImportProvider.value = null;
  }

  async function submitManualImport(payload: {
    token: string;
    refreshToken?: string;
    email?: string;
  }): Promise<void> {
    const provider = manualImportProvider.value;
    if (!provider || manualImportSubmitting.value) return;
    manualImportSubmitting.value = true;
    try {
      const next = await requireSubscriptionsApi().importManual({
        provider: provider.provider,
        token: payload.token,
        ...(manualLoginUri.value ? { browserToken: true as const } : {}),
        ...(payload.refreshToken ? { refreshToken: payload.refreshToken } : {}),
        ...(payload.email ? { email: payload.email } : {})
      });
      applySnapshot(next);
      options.onModelsChanged?.();
      manualImportProvider.value = null;
      uiMessage.success(subT("toastManualImported"));
    } catch (error: unknown) {
      uiMessage.error(formatSubscriptionError(error));
    } finally {
      manualImportSubmitting.value = false;
    }
  }

  async function importSelectedCandidates(
    candidates: SubscriptionLocalCandidate[]
  ): Promise<void> {
    if (candidates.length === 0 || scanDialog.value.importing) return;
    scanDialog.value = { ...scanDialog.value, importing: true };
    let importedCount = 0;
    let latestSnapshot: SubscriptionSettingsSnapshot | undefined;
    try {
      const subApi = requireSubscriptionsApi();
      for (const candidate of candidates) {
        latestSnapshot = await subApi.importLocal({
          provider: candidate.provider,
          candidateId: candidate.candidateId
        });
        importedCount += 1;
      }
      if (latestSnapshot) {
        applySnapshot(latestSnapshot);
        options.onModelsChanged?.();
      }
      scanDialog.value = {
        open: false,
        scanning: false,
        importing: false,
        candidates: []
      };
      if (importedCount > 0) {
        uiMessage.success(subT("toastImportedCount", { count: importedCount }));
      }
    } catch (error: unknown) {
      if (latestSnapshot) {
        applySnapshot(latestSnapshot);
        options.onModelsChanged?.();
      }
      scanDialog.value = { ...scanDialog.value, importing: false };
      uiMessage.error(formatSubscriptionError(error));
    }
  }

  async function setPrimaryAccount(
    provider: SubscriptionProviderId,
    accountId: string
  ): Promise<void> {
    const key = `primary:${accountId}`;
    if (isPending(key) || !snapshot.value) return;
    const previous = snapshot.value;
    snapshot.value = {
      ...previous,
      providers: previous.providers.map((item) =>
        item.provider === provider
          ? {
              ...item,
              accounts: item.accounts.map((acct) => ({
                ...acct,
                isPrimary: acct.id === accountId
              }))
            }
          : item
      )
    };
    setPending(key, true);
    try {
      const next = await requireSubscriptionsApi().setPrimaryAccount({
        provider,
        accountId
      });
      applySnapshot(next);
      uiMessage.success(subT("toastPrimaryUpdated"));
    } catch (error: unknown) {
      snapshot.value = previous;
      uiMessage.error(formatSubscriptionError(error));
    } finally {
      setPending(key, false);
    }
  }

  async function toggleAccountEnabled(
    account: SubscriptionAccountSummary,
    enabled: boolean
  ): Promise<void> {
    const key = `accountEnabled:${account.id}`;
    if (isPending(key) || !snapshot.value) return;
    const previous = snapshot.value;
    snapshot.value = {
      ...previous,
      providers: previous.providers.map((item) =>
        item.provider === account.provider
          ? {
              ...item,
              accounts: item.accounts.map((acct) =>
                acct.id === account.id
                  ? {
                      ...acct,
                      enabled,
                      status: enabled
                        ? acct.status === "disabled"
                          ? "active"
                          : acct.status
                        : "disabled"
                    }
                  : acct
              )
            }
          : item
      )
    };
    setPending(key, true);
    try {
      const next = await requireSubscriptionsApi().setAccountEnabled({
        provider: account.provider,
        accountId: account.id,
        enabled
      });
      applySnapshot(next);
      options.onModelsChanged?.();
      uiMessage.success(
        enabled ? subT("toastAccountEnabled") : subT("toastAccountDisabled")
      );
    } catch (error: unknown) {
      snapshot.value = previous;
      uiMessage.error(formatSubscriptionError(error));
    } finally {
      setPending(key, false);
    }
  }

  function requestRemoveAccount(account: SubscriptionAccountSummary): void {
    removeConfirmAccount.value = account;
  }

  function cancelRemoveAccount(): void {
    if (
      removeConfirmAccount.value &&
      isPending(`remove:${removeConfirmAccount.value.id}`)
    ) {
      return;
    }
    removeConfirmAccount.value = null;
  }

  async function confirmRemoveAccount(): Promise<void> {
    const target = removeConfirmAccount.value;
    if (!target) return;
    const key = `remove:${target.id}`;
    if (isPending(key)) return;
    setPending(key, true);
    try {
      const next = await requireSubscriptionsApi().removeAccount({
        provider: target.provider,
        accountId: target.id
      });
      applySnapshot(next);
      removeConfirmAccount.value = null;
      options.onModelsChanged?.();
      uiMessage.success(subT("toastAccountRemoved"));
    } catch (error: unknown) {
      uiMessage.error(formatSubscriptionError(error));
    } finally {
      setPending(key, false);
    }
  }

  async function toggleModel(
    model: SubscriptionModelItem,
    enabled: boolean
  ): Promise<void> {
    if (!snapshot.value) return;
    const sequence = (modelToggleSequences.get(model.id) ?? 0) + 1;
    modelToggleSequences.set(model.id, sequence);

    const previousEnabled = model.enabled;
    snapshot.value = {
      ...snapshot.value,
      providers: snapshot.value.providers.map((item) =>
        item.provider === model.provider
          ? {
              ...item,
              models: item.models.map((entry) =>
                entry.id === model.id ? { ...entry, enabled } : entry
              )
            }
          : item
      )
    };

    try {
      const next = await requireSubscriptionsApi().setModelEnabled({
        modelId: model.id,
        enabled
      });
      if (modelToggleSequences.get(model.id) !== sequence) return;
      applySnapshot(next);
      options.onModelsChanged?.();
    } catch (error: unknown) {
      if (modelToggleSequences.get(model.id) !== sequence) return;
      if (snapshot.value) {
        snapshot.value = {
          ...snapshot.value,
          providers: snapshot.value.providers.map((item) =>
            item.provider === model.provider
              ? {
                  ...item,
                  models: item.models.map((entry) =>
                    entry.id === model.id
                      ? { ...entry, enabled: previousEnabled }
                      : entry
                  )
                }
              : item
          )
        };
      }
      uiMessage.error(formatSubscriptionError(error));
    }
  }

  async function setDefaultModel(model: SubscriptionModelItem): Promise<void> {
    if (!snapshot.value || snapshot.value.defaultModelId === model.id) return;
    const sequence = ++defaultModelSequence;
    const previousDefaultId = snapshot.value.defaultModelId;
    pendingDefaultModelId.value = model.id;
    snapshot.value = {
      ...snapshot.value,
      defaultModelId: model.id,
      providers: snapshot.value.providers.map((item) =>
        item.provider === model.provider
          ? {
              ...item,
              models: item.models.map((entry) =>
                entry.id === model.id ? { ...entry, enabled: true } : entry
              )
            }
          : item
      )
    };
    try {
      const next = await requireSubscriptionsApi().setDefaultModel({
        modelId: model.id
      });
      if (defaultModelSequence !== sequence) return;
      applySnapshot(next);
      options.onModelsChanged?.();
      uiMessage.success(subT("toastDefaultModelUpdated"));
    } catch (error: unknown) {
      if (defaultModelSequence !== sequence) return;
      if (snapshot.value) {
        snapshot.value = {
          ...snapshot.value,
          defaultModelId: previousDefaultId
        };
      }
      uiMessage.error(formatSubscriptionError(error));
    } finally {
      if (defaultModelSequence === sequence) {
        pendingDefaultModelId.value = null;
      }
    }
  }

  async function testModel(model: SubscriptionModelItem): Promise<void> {
    const api = resolveApi();
    if (!api?.models || testingModelId.value) return;
    testingModelId.value = model.id;
    try {
      const input: ModelConfigInput = {
        id: model.id,
        label: model.label,
        provider: model.provider,
        modelId: model.modelId,
        api: model.api,
        baseUrl: "",
        reasoning: model.reasoning,
        defaultThinkingLevel: model.defaultThinkingLevel,
        thinkingLevelOptions: model.thinkingLevelOptions ?? [
          "minimal",
          "low",
          "medium",
          "high",
          "xhigh"
        ],
        temperatureOptions: [0.1, 0.7, 1],
        managedBy: "subscription",
        ...(model.contextWindow && model.maxTokens
          ? { contextWindow: model.contextWindow, maxTokens: model.maxTokens }
          : {})
      };
      const result = await api.models.test(input);
      uiMessage.success(result.message || subT("toastTestSuccess"));
    } catch (error: unknown) {
      const reason =
        getErrorDetail(error) ?? formatSubscriptionError(error, "");
      uiMessage.error(
        reason
          ? subT("errTestFailed", { reason })
          : formatSubscriptionError(error),
        { duration: 7_000 }
      );
    } finally {
      if (testingModelId.value === model.id) {
        testingModelId.value = null;
      }
    }
  }

  function handleDesktopEvent(event: SystemEventEnvelope): void {
    if (event.type === "subscriptions.authProgress") {
      const payload = event.payload;
      if (
        startingAuth.value &&
        !authSession.value &&
        (payload.status !== "pending" ||
          payload.code === "subscriptions.oauth_callback_received")
      ) {
        earlyAuthEvents.set(payload.authSessionId, event);
      }
      if (authSession.value?.authSessionId === payload.authSessionId) {
        if (payload.status === "completed") {
          authSession.value = null;
          uiMessage.success(
            subT(
              payload.code === "subscriptions.account_updated"
                ? "toastAuthUpdated"
                : "toastAuthCompleted"
            )
          );
        } else if (
          payload.status === "pending" &&
          payload.code === "subscriptions.oauth_callback_received"
        ) {
          authSession.value = { ...authSession.value, callbackReceived: true };
        } else if (payload.status === "failed") {
          authSession.value = {
            ...authSession.value,
            status: "failed",
            errorMessage: payload.message ?? subT("deviceFailedHint")
          };
          uiMessage.error(payload.message ?? subT("errAuthFailed"));
        } else if (payload.status === "cancelled") {
          authSession.value = null;
        }
      }
      return;
    }

    if (event.type === "subscriptions.stateChanged") {
      void load(true);
      options.onModelsChanged?.();
      if (event.payload.autoDefaultModelId) {
        uiMessage.info(subT("toastAutoDefaultModel"));
      }
    }
  }

  onMounted(() => {
    void load();
    unsubscribeEvents = resolveApi()?.events?.subscribe(handleDesktopEvent);
    clockTimer = setInterval(() => {
      nowMs.value = Date.now();
    }, 30_000);
  });

  onBeforeUnmount(() => {
    disposed = true;
    if (authSession.value?.status === "pending") {
      void requireSubscriptionsApi()
        .cancelAuth({ authSessionId: authSession.value.authSessionId })
        .catch(() => undefined);
    }
    unsubscribeEvents?.();
    unsubscribeEvents = undefined;
    if (clockTimer !== undefined) {
      clearInterval(clockTimer);
      clockTimer = undefined;
    }
  });

  return {
    snapshot,
    loaded,
    initialLoading,
    loadError,
    selectedProviderId,
    showUpcomingProviders,
    nowMs,
    providers,
    implementedProviders,
    upcomingProviders,
    activeProvider,
    testingModelId,
    pendingDefaultModelId,
    startingAuth,
    authSession,
    scanDialog,
    removeConfirmAccount,
    manualImportProvider,
    manualLoginUri,
    manualImportSubmitting,
    isPending,
    isQuotaPending,
    quotaErrors,
    load,
    refreshQuota,
    refreshModels,
    startAuth,
    cancelAuth,
    closeAuthDialog,
    openScanDialog,
    closeScanDialog,
    openManualImportDialog,
    closeManualImportDialog,
    submitManualImport,
    importSelectedCandidates,
    setPrimaryAccount,
    toggleAccountEnabled,
    requestRemoveAccount,
    cancelRemoveAccount,
    confirmRemoveAccount,
    toggleModel,
    setDefaultModel,
    testModel
  };
}
