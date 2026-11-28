import { z } from "zod";
import {
  ModelApiSchema,
  ModelContextWindowSchema,
  ModelMaxTokensSchema,
  ThinkingLevelSchema,
  ThinkingLevelOptionsSchema
} from "../model-configuration";
import {
  SUBSCRIPTION_ACCOUNT_ID_MAX_LENGTH,
  SUBSCRIPTION_AUTH_SESSION_ID_MAX_LENGTH,
  SUBSCRIPTION_CANDIDATE_ID_MAX_LENGTH,
  SUBSCRIPTION_MAX_ACCOUNTS_PER_PROVIDER,
  SUBSCRIPTION_MAX_LOCAL_CANDIDATES,
  SUBSCRIPTION_MAX_MODELS_PER_PROVIDER,
  SUBSCRIPTION_MAX_PROVIDERS,
  SUBSCRIPTION_MAX_QUOTA_BUCKETS,
  SUBSCRIPTION_MODEL_ID_MAX_LENGTH,
  SubscriptionAccountStatusSchema,
  SubscriptionAuthMethodSchema,
  SubscriptionAuthProgressStatusSchema,
  SubscriptionInteractiveAuthMethodSchema,
  SubscriptionProviderIdSchema
} from "./providers";

export const SubscriptionQuotaBucketSchema = z
  .object({
    id: z.string().min(1).max(80),
    label: z.string().min(1).max(120),
    unlimited: z.literal(true).optional(),
    remaining: z.number().nonnegative().optional(),
    remainingPercent: z.number().min(0).max(100).optional(),
    used: z.number().nonnegative().optional(),
    limit: z.number().positive().optional(),
    unit: z.string().max(32).optional(),
    resetsAt: z.string().datetime().optional()
  })
  .strict();
export type SubscriptionQuotaBucket = z.infer<
  typeof SubscriptionQuotaBucketSchema
>;

export const SubscriptionAccountSummarySchema = z
  .object({
    id: z.string().min(1).max(SUBSCRIPTION_ACCOUNT_ID_MAX_LENGTH),
    provider: SubscriptionProviderIdSchema,
    displayName: z.string().min(1).max(160),
    email: z.string().max(240).optional(),
    planTier: z.string().max(80).optional(),
    source: SubscriptionAuthMethodSchema,
    isPrimary: z.boolean(),
    enabled: z.boolean(),
    status: SubscriptionAccountStatusSchema,
    statusMessage: z.string().max(300).optional(),
    cooldownUntil: z.string().datetime().optional(),
    quotaUpdatedAt: z.string().datetime().optional(),
    quotaBuckets: z
      .array(SubscriptionQuotaBucketSchema)
      .max(SUBSCRIPTION_MAX_QUOTA_BUCKETS),
    createdAt: z.string().datetime(),
    lastUsedAt: z.string().datetime().optional()
  })
  .strict();
export type SubscriptionAccountSummary = z.infer<
  typeof SubscriptionAccountSummarySchema
>;

export const SubscriptionModelItemSchema = z
  .object({
    id: z.string().min(1).max(SUBSCRIPTION_MODEL_ID_MAX_LENGTH),
    provider: SubscriptionProviderIdSchema,
    modelId: z.string().min(1).max(240),
    label: z.string().min(1).max(120),
    description: z.string().max(500).optional(),
    api: ModelApiSchema,
    reasoning: z.boolean(),
    defaultThinkingLevel: ThinkingLevelSchema,
    thinkingLevelOptions: ThinkingLevelOptionsSchema.optional(),
    contextWindow: ModelContextWindowSchema.optional(),
    maxTokens: ModelMaxTokensSchema.optional(),
    enabled: z.boolean(),
    recommended: z.boolean().optional()
  })
  .strict();
export type SubscriptionModelItem = z.infer<typeof SubscriptionModelItemSchema>;

export const SubscriptionProviderOverviewSchema = z
  .object({
    provider: SubscriptionProviderIdSchema,
    name: z.string().min(1).max(80),
    description: z.string().max(300),
    phase: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    implemented: z.boolean(),
    unofficialWarning: z.string().max(300).optional(),
    supportedAuthMethods: z.array(SubscriptionAuthMethodSchema).max(4),
    accounts: z
      .array(SubscriptionAccountSummarySchema)
      .max(SUBSCRIPTION_MAX_ACCOUNTS_PER_PROVIDER),
    models: z
      .array(SubscriptionModelItemSchema)
      .max(SUBSCRIPTION_MAX_MODELS_PER_PROVIDER)
  })
  .strict();
export type SubscriptionProviderOverview = z.infer<
  typeof SubscriptionProviderOverviewSchema
>;

export const SubscriptionSettingsSnapshotSchema = z
  .object({
    providers: z
      .array(SubscriptionProviderOverviewSchema)
      .max(SUBSCRIPTION_MAX_PROVIDERS),
    defaultModelId: z.string().max(SUBSCRIPTION_MODEL_ID_MAX_LENGTH)
  })
  .strict();
export type SubscriptionSettingsSnapshot = z.infer<
  typeof SubscriptionSettingsSnapshotSchema
>;

export const SubscriptionLocalCandidateSchema = z
  .object({
    candidateId: z.string().min(1).max(SUBSCRIPTION_CANDIDATE_ID_MAX_LENGTH),
    provider: SubscriptionProviderIdSchema,
    displayName: z.string().min(1).max(160),
    email: z.string().max(240).optional(),
    sourceLabel: z.string().min(1).max(120),
    sourcePathHint: z.string().max(240).optional(),
    alreadyImported: z.boolean()
  })
  .strict();
export type SubscriptionLocalCandidate = z.infer<
  typeof SubscriptionLocalCandidateSchema
>;

export const SubscriptionScanLocalResultSchema = z
  .object({
    candidates: z
      .array(SubscriptionLocalCandidateSchema)
      .max(SUBSCRIPTION_MAX_LOCAL_CANDIDATES)
  })
  .strict();
export type SubscriptionScanLocalResult = z.infer<
  typeof SubscriptionScanLocalResultSchema
>;

export const SubscriptionStartAuthResultSchema = z
  .object({
    authSessionId: z
      .string()
      .min(1)
      .max(SUBSCRIPTION_AUTH_SESSION_ID_MAX_LENGTH),
    provider: SubscriptionProviderIdSchema,
    method: SubscriptionInteractiveAuthMethodSchema,
    verificationUri: z.url().max(2_000).optional(),
    userCode: z.string().min(1).max(64).optional(),
    expiresAt: z.string().datetime().optional()
  })
  .strict();
export type SubscriptionStartAuthResult = z.infer<
  typeof SubscriptionStartAuthResultSchema
>;

export const SubscriptionCancelAuthResultSchema = z
  .object({
    cancelled: z.boolean()
  })
  .strict();
export type SubscriptionCancelAuthResult = z.infer<
  typeof SubscriptionCancelAuthResultSchema
>;

export const SubscriptionAuthProgressPayloadSchema = z
  .object({
    authSessionId: z
      .string()
      .min(1)
      .max(SUBSCRIPTION_AUTH_SESSION_ID_MAX_LENGTH),
    provider: SubscriptionProviderIdSchema,
    status: SubscriptionAuthProgressStatusSchema,
    accountId: z
      .string()
      .min(1)
      .max(SUBSCRIPTION_ACCOUNT_ID_MAX_LENGTH)
      .optional(),
    message: z.string().max(300).optional(),
    code: z.string().max(120).optional()
  })
  .strict();
export type SubscriptionAuthProgressPayload = z.infer<
  typeof SubscriptionAuthProgressPayloadSchema
>;

export const SubscriptionStateChangedReasonSchema = z.enum([
  "account_added",
  "account_updated",
  "account_removed",
  "account_status_changed",
  "quota_updated",
  "models_refreshed",
  "failover",
  "cooldown_recovered",
  "model_toggled",
  "default_model_changed"
]);
export type SubscriptionStateChangedReason = z.infer<
  typeof SubscriptionStateChangedReasonSchema
>;

export const SubscriptionStateChangedPayloadSchema = z
  .object({
    reason: SubscriptionStateChangedReasonSchema,
    provider: SubscriptionProviderIdSchema.optional(),
    accountId: z
      .string()
      .min(1)
      .max(SUBSCRIPTION_ACCOUNT_ID_MAX_LENGTH)
      .optional(),
    defaultModelId: z.string().max(SUBSCRIPTION_MODEL_ID_MAX_LENGTH).optional(),
    autoDefaultModelId: z
      .string()
      .max(SUBSCRIPTION_MODEL_ID_MAX_LENGTH)
      .optional()
  })
  .strict();
export type SubscriptionStateChangedPayload = z.infer<
  typeof SubscriptionStateChangedPayloadSchema
>;
