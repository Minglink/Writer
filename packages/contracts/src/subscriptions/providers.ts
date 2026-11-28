import { z } from "zod";

export const SUBSCRIPTION_PROVIDER_IDS = [
  "google-gemini-cli",
  "google-antigravity",
  "openai-codex",
  "github-copilot",
  "anthropic-claude",
  "kiro",
  "cursor",
  "windsurf",
  "codebuddy"
] as const;

export const SubscriptionProviderIdSchema = z.enum(SUBSCRIPTION_PROVIDER_IDS);
export type SubscriptionProviderId = z.infer<
  typeof SubscriptionProviderIdSchema
>;

export const SUBSCRIPTION_AUTH_METHODS = [
  "oauth",
  "device_flow",
  "local_import",
  "manual_token"
] as const;

export const SubscriptionAuthMethodSchema = z.enum(SUBSCRIPTION_AUTH_METHODS);
export type SubscriptionAuthMethod = z.infer<
  typeof SubscriptionAuthMethodSchema
>;

export const SUBSCRIPTION_INTERACTIVE_AUTH_METHODS = [
  "oauth",
  "device_flow"
] as const;

export const SubscriptionInteractiveAuthMethodSchema = z.enum(
  SUBSCRIPTION_INTERACTIVE_AUTH_METHODS
);
export type SubscriptionInteractiveAuthMethod = z.infer<
  typeof SubscriptionInteractiveAuthMethodSchema
>;

export const SUBSCRIPTION_ACCOUNT_STATUSES = [
  "active",
  "cooldown",
  "quota_exhausted",
  "expired",
  "disabled"
] as const;

export const SubscriptionAccountStatusSchema = z.enum(
  SUBSCRIPTION_ACCOUNT_STATUSES
);
export type SubscriptionAccountStatus = z.infer<
  typeof SubscriptionAccountStatusSchema
>;

export const SUBSCRIPTION_FAILOVER_REASONS = [
  "rate_limited",
  "quota_exhausted",
  "unauthorized",
  "forbidden"
] as const;

export const SubscriptionFailoverReasonSchema = z.enum(
  SUBSCRIPTION_FAILOVER_REASONS
);
export type SubscriptionFailoverReason = z.infer<
  typeof SubscriptionFailoverReasonSchema
>;

export const SUBSCRIPTION_AUTH_PROGRESS_STATUSES = [
  "pending",
  "completed",
  "failed",
  "cancelled"
] as const;

export const SubscriptionAuthProgressStatusSchema = z.enum(
  SUBSCRIPTION_AUTH_PROGRESS_STATUSES
);
export type SubscriptionAuthProgressStatus = z.infer<
  typeof SubscriptionAuthProgressStatusSchema
>;

export const SUBSCRIPTION_MAX_PROVIDERS = 20;
export const SUBSCRIPTION_MAX_ACCOUNTS_PER_PROVIDER = 50;
export const SUBSCRIPTION_MAX_MODELS_PER_PROVIDER = 100;
export const SUBSCRIPTION_MAX_QUOTA_BUCKETS = 20;
export const SUBSCRIPTION_MAX_LOCAL_CANDIDATES = 100;
export const SUBSCRIPTION_ACCOUNT_ID_MAX_LENGTH = 120;
export const SUBSCRIPTION_MODEL_ID_MAX_LENGTH = 120;
export const SUBSCRIPTION_AUTH_SESSION_ID_MAX_LENGTH = 120;
export const SUBSCRIPTION_CANDIDATE_ID_MAX_LENGTH = 160;
