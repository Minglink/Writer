import { z } from "zod";
import { EnvelopeBaseSchema, type Envelope } from "../envelope";
import {
  SUBSCRIPTION_ACCOUNT_ID_MAX_LENGTH,
  SUBSCRIPTION_AUTH_SESSION_ID_MAX_LENGTH,
  SUBSCRIPTION_CANDIDATE_ID_MAX_LENGTH,
  SUBSCRIPTION_MODEL_ID_MAX_LENGTH,
  SubscriptionInteractiveAuthMethodSchema,
  SubscriptionProviderIdSchema
} from "./providers";
import {
  SubscriptionAuthProgressPayloadSchema,
  SubscriptionStateChangedPayloadSchema,
  type SubscriptionAuthProgressPayload,
  type SubscriptionStateChangedPayload
} from "./schemas";
import {
  SubscriptionAcquireCredentialInputSchema,
  SubscriptionReportAndFailoverInputSchema
} from "./internal";

const AccountIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(SUBSCRIPTION_ACCOUNT_ID_MAX_LENGTH);

const ModelIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(SUBSCRIPTION_MODEL_ID_MAX_LENGTH);

export const SubscriptionStartAuthInputSchema = z
  .object({
    provider: SubscriptionProviderIdSchema,
    method: SubscriptionInteractiveAuthMethodSchema.optional(),
    openBrowser: z.boolean().optional()
  })
  .strict();
export type SubscriptionStartAuthInput = z.infer<
  typeof SubscriptionStartAuthInputSchema
>;

export const SubscriptionCancelAuthInputSchema = z
  .object({
    authSessionId: z
      .string()
      .trim()
      .min(1)
      .max(SUBSCRIPTION_AUTH_SESSION_ID_MAX_LENGTH)
  })
  .strict();
export type SubscriptionCancelAuthInput = z.infer<
  typeof SubscriptionCancelAuthInputSchema
>;

export const SubscriptionScanLocalInputSchema = z
  .object({
    provider: SubscriptionProviderIdSchema.optional()
  })
  .strict();
export type SubscriptionScanLocalInput = z.infer<
  typeof SubscriptionScanLocalInputSchema
>;

export const SubscriptionImportLocalInputSchema = z
  .object({
    provider: SubscriptionProviderIdSchema,
    candidateId: z
      .string()
      .trim()
      .min(1)
      .max(SUBSCRIPTION_CANDIDATE_ID_MAX_LENGTH)
  })
  .strict();
export type SubscriptionImportLocalInput = z.infer<
  typeof SubscriptionImportLocalInputSchema
>;

export const SubscriptionImportManualInputSchema = z
  .object({
    provider: SubscriptionProviderIdSchema,
    token: z.string().trim().min(1).max(16_000),
    browserToken: z.literal(true).optional(),
    refreshToken: z.string().trim().max(16_000).optional(),
    displayName: z.string().trim().max(160).optional(),
    email: z.string().trim().max(240).optional()
  })
  .strict()
  .refine(
    (input) =>
      !input.browserToken ||
      (input.provider === "windsurf" && !input.refreshToken),
    {
      message: "Browser tokens are supported only for Windsurf sign-in"
    }
  );
export type SubscriptionImportManualInput = z.infer<
  typeof SubscriptionImportManualInputSchema
>;

export const SubscriptionSetPrimaryAccountInputSchema = z
  .object({
    provider: SubscriptionProviderIdSchema,
    accountId: AccountIdSchema
  })
  .strict();
export type SubscriptionSetPrimaryAccountInput = z.infer<
  typeof SubscriptionSetPrimaryAccountInputSchema
>;

export const SubscriptionSetAccountEnabledInputSchema = z
  .object({
    provider: SubscriptionProviderIdSchema,
    accountId: AccountIdSchema,
    enabled: z.boolean()
  })
  .strict();
export type SubscriptionSetAccountEnabledInput = z.infer<
  typeof SubscriptionSetAccountEnabledInputSchema
>;

export const SubscriptionRemoveAccountInputSchema = z
  .object({
    provider: SubscriptionProviderIdSchema,
    accountId: AccountIdSchema
  })
  .strict();
export type SubscriptionRemoveAccountInput = z.infer<
  typeof SubscriptionRemoveAccountInputSchema
>;

export const SubscriptionRefreshQuotaInputSchema = z
  .object({
    provider: SubscriptionProviderIdSchema.optional(),
    accountId: AccountIdSchema.optional()
  })
  .strict();
export type SubscriptionRefreshQuotaInput = z.infer<
  typeof SubscriptionRefreshQuotaInputSchema
>;

export const SubscriptionRefreshModelsInputSchema = z
  .object({
    provider: SubscriptionProviderIdSchema.optional()
  })
  .strict();
export type SubscriptionRefreshModelsInput = z.infer<
  typeof SubscriptionRefreshModelsInputSchema
>;

export const SubscriptionSetModelEnabledInputSchema = z
  .object({
    modelId: ModelIdSchema,
    enabled: z.boolean()
  })
  .strict();
export type SubscriptionSetModelEnabledInput = z.infer<
  typeof SubscriptionSetModelEnabledInputSchema
>;

export const SubscriptionSetDefaultModelInputSchema = z
  .object({
    modelId: ModelIdSchema
  })
  .strict();
export type SubscriptionSetDefaultModelInput = z.infer<
  typeof SubscriptionSetDefaultModelInputSchema
>;

const envelope = <T extends string, S extends z.ZodType>(type: T, payload: S) =>
  EnvelopeBaseSchema.extend({ type: z.literal(type), payload });

export const SubscriptionCommandSchemas = [
  envelope("subscriptions.getState", z.object({}).strict()),
  envelope("subscriptions.startAuth", SubscriptionStartAuthInputSchema),
  envelope("subscriptions.cancelAuth", SubscriptionCancelAuthInputSchema),
  envelope("subscriptions.scanLocal", SubscriptionScanLocalInputSchema),
  envelope("subscriptions.importLocal", SubscriptionImportLocalInputSchema),
  envelope("subscriptions.importManual", SubscriptionImportManualInputSchema),
  envelope(
    "subscriptions.setPrimaryAccount",
    SubscriptionSetPrimaryAccountInputSchema
  ),
  envelope(
    "subscriptions.setAccountEnabled",
    SubscriptionSetAccountEnabledInputSchema
  ),
  envelope("subscriptions.removeAccount", SubscriptionRemoveAccountInputSchema),
  envelope("subscriptions.refreshQuota", SubscriptionRefreshQuotaInputSchema),
  envelope("subscriptions.refreshModels", SubscriptionRefreshModelsInputSchema),
  envelope(
    "subscriptions.setModelEnabled",
    SubscriptionSetModelEnabledInputSchema
  ),
  envelope(
    "subscriptions.setDefaultModel",
    SubscriptionSetDefaultModelInputSchema
  ),
  envelope(
    "subscriptions.acquireCredential",
    SubscriptionAcquireCredentialInputSchema
  ),
  envelope(
    "subscriptions.reportAndFailover",
    SubscriptionReportAndFailoverInputSchema
  )
] as const;

export const SubscriptionsAuthProgressEventEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("subscriptions.authProgress"),
    payload: SubscriptionAuthProgressPayloadSchema
  });
export type SubscriptionsAuthProgressEventEnvelope = Envelope<
  SubscriptionAuthProgressPayload,
  "subscriptions.authProgress"
>;

export const SubscriptionsStateChangedEventEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("subscriptions.stateChanged"),
    payload: SubscriptionStateChangedPayloadSchema
  });
export type SubscriptionsStateChangedEventEnvelope = Envelope<
  SubscriptionStateChangedPayload,
  "subscriptions.stateChanged"
>;
