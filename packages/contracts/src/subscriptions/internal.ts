import { z } from "zod";
import {
  SUBSCRIPTION_ACCOUNT_ID_MAX_LENGTH,
  SUBSCRIPTION_MODEL_ID_MAX_LENGTH,
  SubscriptionFailoverReasonSchema,
  SubscriptionProviderIdSchema
} from "./providers";

export const SubscriptionAcquireCredentialInputSchema = z
  .object({
    runId: z.string().trim().min(1).max(160),
    provider: SubscriptionProviderIdSchema,
    modelId: z.string().trim().min(1).max(SUBSCRIPTION_MODEL_ID_MAX_LENGTH),
    accountId: z
      .string()
      .trim()
      .min(1)
      .max(SUBSCRIPTION_ACCOUNT_ID_MAX_LENGTH)
      .optional()
  })
  .strict();
export type SubscriptionAcquireCredentialInput = z.infer<
  typeof SubscriptionAcquireCredentialInputSchema
>;

export const SubscriptionReportAndFailoverInputSchema = z
  .object({
    runId: z.string().trim().min(1).max(160),
    provider: SubscriptionProviderIdSchema,
    modelId: z.string().trim().min(1).max(SUBSCRIPTION_MODEL_ID_MAX_LENGTH),
    failedAccountId: z
      .string()
      .trim()
      .min(1)
      .max(SUBSCRIPTION_ACCOUNT_ID_MAX_LENGTH),
    reason: SubscriptionFailoverReasonSchema,
    retryAfterSec: z.number().nonnegative().max(86_400).optional(),
    resetAt: z.string().datetime().optional(),
    message: z.string().max(300).optional()
  })
  .strict();
export type SubscriptionReportAndFailoverInput = z.infer<
  typeof SubscriptionReportAndFailoverInputSchema
>;

/** Short-lived runtime credential passed from Main to Agent; never includes refresh tokens. */
export const SubscriptionAcquiredCredentialSchema = z
  .object({
    provider: SubscriptionProviderIdSchema,
    accountId: z.string().min(1).max(SUBSCRIPTION_ACCOUNT_ID_MAX_LENGTH),
    apiKey: z.string().min(1).max(16_000),
    baseUrl: z.url().max(2_000).optional(),
    expiresAt: z.string().datetime().optional(),
    extraHeaders: z.record(z.string(), z.string()).optional(),
    metadata: z.record(z.string(), z.string()).optional()
  })
  .strict();
export type SubscriptionAcquiredCredential = z.infer<
  typeof SubscriptionAcquiredCredentialSchema
>;
