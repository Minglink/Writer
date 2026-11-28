import {
  ModelConfigInputSchema,
  SUBSCRIPTION_MODEL_ID_PREFIX,
  SubscriptionAccountSummarySchema,
  type ModelApi,
  type ModelConfigInput,
  type ModelContextWindow,
  type ModelMaxTokens,
  type SubscriptionAccountStatus,
  type SubscriptionAccountSummary,
  type SubscriptionAuthMethod,
  type SubscriptionInteractiveAuthMethod,
  type SubscriptionProviderId,
  type SubscriptionQuotaBucket,
  type SubscriptionRuntimeAuth,
  type TemperatureOptions,
  type ThinkingLevel,
  type ThinkingLevelOptions,
  type ToolSchemaProfile
} from "@writer/contracts";

export class SubscriptionError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "SubscriptionError";
    this.code = code;
  }
}

export function safeSubscriptionError(error: unknown): {
  code: string;
  message: string;
} {
  if (error instanceof SubscriptionError) {
    return { code: error.code, message: error.message };
  }
  return {
    code: "subscriptions.operation_failed",
    message: "订阅模型操作失败，请检查账号状态或稍后重试。"
  };
}

export interface SecureStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(plainText: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

/** Stored only inside Main via Electron safeStorage; never sent to Renderer or disk in plaintext. */
export interface StoredAccountSecret {
  accessToken: string;
  refreshToken?: string;
  idToken?: string;
  expiresAt?: string;
  providerToken?: string;
  providerTokenExpiresAt?: string;
  extra?: Record<string, string>;
}

export interface StoredAccountRecord {
  id: string;
  provider: SubscriptionProviderId;
  displayName: string;
  email?: string;
  planTier?: string;
  source: SubscriptionAuthMethod;
  isPrimary: boolean;
  enabled: boolean;
  status: SubscriptionAccountStatus;
  statusMessage?: string;
  cooldownUntil?: string;
  consecutiveRateLimits: number;
  quotaUpdatedAt?: string;
  quotaBuckets: SubscriptionQuotaBucket[];
  createdAt: string;
  lastUsedAt?: string;
}

export interface SubscriptionModelDefinition {
  id: string;
  provider: SubscriptionProviderId;
  modelId: string;
  label: string;
  description?: string;
  api: ModelApi;
  baseUrl?: string;
  requestModelId?: string;
  supportsDeveloperRole?: boolean;
  toolSchemaProfile?: ToolSchemaProfile;
  reasoning: boolean;
  defaultThinkingLevel: ThinkingLevel;
  thinkingLevelOptions?: ThinkingLevelOptions;
  temperatureOptions?: TemperatureOptions;
  contextWindow?: ModelContextWindow;
  maxTokens?: ModelMaxTokens;
  recommended?: boolean;
}

export interface PersistedSubscriptionState {
  version: 1;
  accounts: StoredAccountRecord[];
  /** Explicit per-model visibility override; omitted falls back to `recommended`. */
  modelOverrides: Record<string, boolean>;
  cachedModels: Partial<
    Record<SubscriptionProviderId, SubscriptionModelDefinition[]>
  >;
  encryptedSecrets: Record<string, string>;
}

/** Short-lived runtime credential handed to Agent Utility; refreshToken is never included. */
export interface ResolvedSubscriptionCredential {
  provider: SubscriptionProviderId;
  accountId: string;
  apiKey: string;
  baseUrl?: string;
  expiresAt?: string;
  extraHeaders?: Record<string, string>;
  metadata?: Record<string, string>;
}

export interface LocalCredentialCandidate {
  candidateId: string;
  provider: SubscriptionProviderId;
  displayName: string;
  email?: string;
  sourceLabel: string;
  sourcePathHint?: string;
}

export interface ImportedAccountResult {
  displayName: string;
  email?: string;
  planTier?: string;
  source: SubscriptionAuthMethod;
  secret: StoredAccountSecret;
  quotaBuckets?: SubscriptionQuotaBucket[];
}

export interface QuotaFetchResult {
  models?: SubscriptionModelDefinition[];
  planTier?: string;
  quotaBuckets: SubscriptionQuotaBucket[];
  status?: Extract<SubscriptionAccountStatus, "active" | "quota_exhausted">;
  statusMessage?: string;
  cooldownUntil?: string;
}

export interface AuthFlowContext {
  authSessionId: string;
  method: SubscriptionInteractiveAuthMethod;
  signal: AbortSignal;
  openExternalUrl: (url: string) => Promise<void>;
  onProgress: (update: {
    status: "pending" | "completed" | "failed" | "cancelled";
    message?: string;
    code?: string;
  }) => void;
}

export interface AuthFlowHandle {
  method: SubscriptionInteractiveAuthMethod;
  verificationUri?: string;
  userCode?: string;
  expiresAt?: string;
  completion: Promise<ImportedAccountResult>;
  cancel: () => void | Promise<void>;
}

export interface SubscriptionProviderMeta {
  name: string;
  description: string;
  phase: 1 | 2 | 3;
  unofficialWarning?: string;
  supportedAuthMethods: readonly SubscriptionAuthMethod[];
}

export interface ManualTokenImportInput {
  browserToken?: boolean;
  token: string;
  refreshToken?: string;
  displayName?: string;
  email?: string;
}

export interface SubscriptionProviderAdapter {
  readonly quotaIncludesModels?: boolean;
  readonly id: SubscriptionProviderId;
  readonly meta: SubscriptionProviderMeta;

  startAuth?(ctx: AuthFlowContext): Promise<AuthFlowHandle>;

  scanLocalCandidates?(): Promise<LocalCredentialCandidate[]>;

  importLocalCandidate?(candidateId: string): Promise<ImportedAccountResult>;

  importManualToken?(
    input: ManualTokenImportInput
  ): Promise<ImportedAccountResult>;

  refreshSecret(
    account: StoredAccountRecord,
    secret: StoredAccountSecret,
    signal?: AbortSignal
  ): Promise<StoredAccountSecret>;

  fetchQuota(
    account: StoredAccountRecord,
    secret: StoredAccountSecret,
    signal?: AbortSignal
  ): Promise<QuotaFetchResult>;

  listModels(
    account?: StoredAccountRecord,
    secret?: StoredAccountSecret,
    signal?: AbortSignal
  ): Promise<SubscriptionModelDefinition[]>;

  toRuntimeCredential(
    account: StoredAccountRecord,
    secret: StoredAccountSecret,
    model: SubscriptionModelDefinition
  ): ResolvedSubscriptionCredential;
}

export interface SubscriptionModelCatalog {
  models: ModelConfigInput[];
  preferredDefaultModelId?: string;
}

export interface SubscriptionCatalogReader {
  initialize?(): Promise<void>;
  getCatalog(): Promise<SubscriptionModelCatalog>;
  resolveRuntimeCredential?(model: {
    id: string;
    provider: string;
    modelId: string;
  }): Promise<{
    apiKey: string;
    baseUrl?: string;
    subscriptionAuth: SubscriptionRuntimeAuth;
  }>;
}

export function toAccountSummary(
  record: StoredAccountRecord
): SubscriptionAccountSummary {
  return SubscriptionAccountSummarySchema.parse({
    id: record.id,
    provider: record.provider,
    displayName: record.displayName,
    ...(record.email !== undefined ? { email: record.email } : {}),
    ...(record.planTier !== undefined ? { planTier: record.planTier } : {}),
    source: record.source,
    isPrimary: record.isPrimary,
    enabled: record.enabled,
    status: record.enabled ? record.status : "disabled",
    ...(record.statusMessage !== undefined
      ? { statusMessage: record.statusMessage }
      : {}),
    ...(record.cooldownUntil !== undefined
      ? { cooldownUntil: record.cooldownUntil }
      : {}),
    ...(record.quotaUpdatedAt !== undefined
      ? { quotaUpdatedAt: record.quotaUpdatedAt }
      : {}),
    quotaBuckets: record.quotaBuckets,
    createdAt: record.createdAt,
    ...(record.lastUsedAt !== undefined
      ? { lastUsedAt: record.lastUsedAt }
      : {})
  });
}

export function toModelConfigInput(
  definition: SubscriptionModelDefinition
): ModelConfigInput {
  if (!definition.id.startsWith(SUBSCRIPTION_MODEL_ID_PREFIX)) {
    throw new SubscriptionError(
      "subscriptions.invalid_model_id",
      "订阅模型 ID 必须以 sub: 开头。"
    );
  }
  return ModelConfigInputSchema.parse({
    id: definition.id,
    label: definition.label,
    ...(definition.description !== undefined
      ? { description: definition.description }
      : {}),
    provider: definition.provider,
    modelId: definition.modelId,
    ...(definition.requestModelId !== undefined
      ? { requestModelId: definition.requestModelId }
      : {}),
    ...(definition.supportsDeveloperRole !== undefined
      ? { supportsDeveloperRole: definition.supportsDeveloperRole }
      : {}),
    ...(definition.toolSchemaProfile !== undefined
      ? { toolSchemaProfile: definition.toolSchemaProfile }
      : {}),
    api: definition.api,
    baseUrl: definition.baseUrl ?? "",
    reasoning: definition.reasoning,
    defaultThinkingLevel: definition.defaultThinkingLevel,
    ...(definition.thinkingLevelOptions !== undefined
      ? { thinkingLevelOptions: definition.thinkingLevelOptions }
      : {}),
    ...(definition.temperatureOptions !== undefined
      ? { temperatureOptions: definition.temperatureOptions }
      : {}),
    ...(definition.contextWindow !== undefined &&
    definition.maxTokens !== undefined
      ? {
          contextWindow: definition.contextWindow,
          maxTokens: definition.maxTokens
        }
      : {}),
    enabled: true,
    managedBy: "subscription"
  });
}
