import { describe, expect, it } from "vitest";
import {
  AgentProviderRuntimeConfigSchema,
  CommandEnvelopeSchema,
  ModelApiSchema,
  ModelConfigSchema,
  ModelManagedBySchema,
  ModelSettingsSchema,
  SUBSCRIPTION_MAX_ACCOUNTS_PER_PROVIDER,
  SUBSCRIPTION_MAX_QUOTA_BUCKETS,
  SUBSCRIPTION_MODEL_ID_PREFIX,
  SubscriptionAccountSummarySchema,
  SubscriptionLocalCandidateSchema,
  SubscriptionSettingsSnapshotSchema,
  SystemEventEnvelopeSchema,
  createEnvelope,
  isSubscriptionModel,
  isSyncableModelId,
  syncModelConfigSchema,
  toSyncModelConfig
} from "../index";
import * as rendererContracts from "../renderer";

const ISO = "2026-11-27T12:00:00.000Z";

function baseModel(overrides: Record<string, unknown> = {}) {
  return {
    id: "custom-model",
    label: "Custom Model",
    provider: "custom",
    modelId: "model-v1",
    api: "openai-completions",
    baseUrl: "https://example.test/v1",
    reasoning: false,
    defaultThinkingLevel: "off",
    thinkingLevelOptions: ["minimal", "low", "medium", "high", "xhigh", "max"],
    temperatureOptions: [0.1, 0.7, 1],
    ...overrides
  };
}

describe("subscription contracts and model schema compatibility", () => {
  it("extends ModelManagedBySchema and ModelApiSchema with Phase 1 subscription values", () => {
    expect(ModelManagedBySchema.parse("writer-free")).toBe("writer-free");
    expect(ModelManagedBySchema.parse("subscription")).toBe("subscription");
    expect(() => ModelManagedBySchema.parse("unknown")).toThrow();

    for (const api of [
      "openai-completions",
      "openai-responses",
      "openai-codex-responses",
      "github-copilot",
      "anthropic-messages",
      "google-generative-ai",
      "google-cloud-code-assist",
      "google-antigravity",
      "kiro-codewhisperer",
      "cursor-connect",
      "windsurf-connect",
      "codebuddy-chat"
    ]) {
      expect(ModelApiSchema.parse(api)).toBe(api);
    }
    expect(() => ModelApiSchema.parse("unsupported-api")).toThrow();
  });

  it("identifies subscription models by prefix or managedBy", () => {
    expect(SUBSCRIPTION_MODEL_ID_PREFIX).toBe("sub:");
    expect(isSubscriptionModel("sub:google-gemini-cli:gemini-2.5-pro")).toBe(
      true
    );
    expect(isSubscriptionModel("custom-writer")).toBe(false);
    expect(
      isSubscriptionModel({
        id: "sub:openai-codex:gpt-5.3-codex",
        managedBy: undefined
      })
    ).toBe(true);
    expect(
      isSubscriptionModel({
        configId: "legacy-id",
        managedBy: "subscription"
      })
    ).toBe(true);
    expect(
      isSubscriptionModel({
        id: "writer-free-writing",
        managedBy: "writer-free"
      })
    ).toBe(false);
  });

  it("keeps legacy ModelSettings compatible while supporting optional subscriptionAuth on runtime config", () => {
    const legacy = ModelSettingsSchema.parse({
      models: [{ ...baseModel(), hasApiKey: true }],
      defaultModelId: "custom-model"
    });
    expect(legacy.models).toHaveLength(1);

    const plainRuntime = AgentProviderRuntimeConfigSchema.parse({
      ...baseModel(),
      apiKey: "test-placeholder-key"
    });
    expect(plainRuntime.subscriptionAuth).toBeUndefined();

    const subRuntime = AgentProviderRuntimeConfigSchema.parse({
      ...baseModel({
        id: "sub:google-gemini-cli:gemini-2.5-pro",
        provider: "google-gemini-cli",
        modelId: "gemini-2.5-pro",
        api: "google-cloud-code-assist",
        baseUrl: "",
        managedBy: "subscription"
      }),
      apiKey: "short-lived-placeholder",
      subscriptionAuth: {
        provider: "google-gemini-cli",
        accountId: "sub_acct_1",
        expiresAt: ISO,
        extraHeaders: { "x-test": "1" },
        metadata: { projectId: "demo-project" }
      }
    });
    expect(subRuntime.subscriptionAuth?.provider).toBe("google-gemini-cli");
    expect(subRuntime.subscriptionAuth?.accountId).toBe("sub_acct_1");

    const parsedModelConfig = ModelConfigSchema.parse({
      ...baseModel({
        id: "sub:github-copilot:gpt-4.1",
        api: "github-copilot",
        baseUrl: "",
        managedBy: "subscription"
      }),
      hasApiKey: true
    });
    expect(parsedModelConfig.managedBy).toBe("subscription");
  });

  it("rejects secret fields in public subscription schemas and enforces array limits", () => {
    const validAccount = {
      id: "sub_acct_1",
      provider: "google-gemini-cli" as const,
      displayName: "user@example.test",
      email: "user@example.test",
      planTier: "Pro",
      source: "oauth" as const,
      isPrimary: true,
      enabled: true,
      status: "active" as const,
      quotaBuckets: [],
      createdAt: ISO
    };
    expect(SubscriptionAccountSummarySchema.parse(validAccount)).toEqual(
      validAccount
    );
    for (const secretField of [
      "accessToken",
      "refreshToken",
      "idToken",
      "providerToken"
    ]) {
      expect(() =>
        SubscriptionAccountSummarySchema.parse({
          ...validAccount,
          [secretField]: "secret-placeholder"
        })
      ).toThrow();
    }

    expect(() =>
      SubscriptionLocalCandidateSchema.parse({
        candidateId: "cand_1",
        provider: "openai-codex",
        displayName: "user@example.test",
        sourceLabel: "Codex CLI",
        alreadyImported: false,
        accessToken: "secret-placeholder"
      })
    ).toThrow();

    const makeBucket = (i: number) => ({
      id: `bucket_${i}`,
      label: `配额 ${i}`,
      remainingPercent: 80
    });
    expect(
      SubscriptionAccountSummarySchema.parse({
        ...validAccount,
        quotaBuckets: Array.from(
          { length: SUBSCRIPTION_MAX_QUOTA_BUCKETS },
          (_, i) => makeBucket(i)
        )
      }).quotaBuckets
    ).toHaveLength(SUBSCRIPTION_MAX_QUOTA_BUCKETS);
    expect(() =>
      SubscriptionAccountSummarySchema.parse({
        ...validAccount,
        quotaBuckets: Array.from(
          { length: SUBSCRIPTION_MAX_QUOTA_BUCKETS + 1 },
          (_, i) => makeBucket(i)
        )
      })
    ).toThrow();

    expect(() =>
      SubscriptionSettingsSnapshotSchema.parse({
        providers: [
          {
            provider: "openai-codex",
            name: "OpenAI Codex",
            description: "desc",
            phase: 1,
            implemented: true,
            supportedAuthMethods: ["oauth"],
            accounts: Array.from(
              { length: SUBSCRIPTION_MAX_ACCOUNTS_PER_PROVIDER + 1 },
              (_, i) => ({
                ...validAccount,
                id: `acct_${i}`,
                provider: "openai-codex"
              })
            ),
            models: []
          }
        ],
        defaultModelId: ""
      })
    ).toThrow();
  });

  it("validates subscription command and event envelopes and rejects invalid inputs", () => {
    for (const payload of [
      { provider: "cursor", token: "fixture", browserToken: true },
      {
        provider: "windsurf",
        token: "fixture",
        browserToken: true,
        refreshToken: "fixture"
      }
    ]) {
      expect(() =>
        CommandEnvelopeSchema.parse(
          createEnvelope("subscriptions.importManual", payload, {
            id: "cmd_invalid"
          })
        )
      ).toThrow();
    }
    const validCommands: Array<[string, unknown]> = [
      [
        "subscriptions.importManual",
        { provider: "windsurf", token: "fixture", browserToken: true }
      ],
      ["subscriptions.getState", {}],
      [
        "subscriptions.startAuth",
        { provider: "google-gemini-cli", method: "oauth" }
      ],
      ["subscriptions.cancelAuth", { authSessionId: "sub_auth_1" }],
      ["subscriptions.scanLocal", {}],
      ["subscriptions.scanLocal", { provider: "openai-codex" }],
      [
        "subscriptions.importLocal",
        { provider: "openai-codex", candidateId: "cand_1" }
      ],
      [
        "subscriptions.importManual",
        {
          provider: "cursor",
          token: "placeholder-manual-token",
          email: "cursor@example.test"
        }
      ],
      [
        "subscriptions.setPrimaryAccount",
        { provider: "openai-codex", accountId: "acct_1" }
      ],
      [
        "subscriptions.setAccountEnabled",
        { provider: "openai-codex", accountId: "acct_1", enabled: false }
      ],
      [
        "subscriptions.removeAccount",
        { provider: "openai-codex", accountId: "acct_1" }
      ],
      ["subscriptions.refreshQuota", { provider: "github-copilot" }],
      ["subscriptions.refreshModels", { provider: "openai-codex" }],
      ["subscriptions.refreshModels", {}],
      [
        "subscriptions.setModelEnabled",
        { modelId: "sub:openai-codex:gpt-5.3-codex", enabled: true }
      ],
      [
        "subscriptions.setDefaultModel",
        { modelId: "sub:openai-codex:gpt-5.3-codex" }
      ],
      [
        "subscriptions.acquireCredential",
        {
          runId: "run_1",
          provider: "openai-codex",
          modelId: "sub:openai-codex:gpt-5.3-codex"
        }
      ],
      [
        "subscriptions.reportAndFailover",
        {
          runId: "run_1",
          provider: "openai-codex",
          modelId: "sub:openai-codex:gpt-5.3-codex",
          failedAccountId: "acct_1",
          reason: "rate_limited",
          retryAfterSec: 45
        }
      ]
    ];

    for (const [type, payload] of validCommands) {
      const parsed = CommandEnvelopeSchema.parse(
        createEnvelope(type, payload, { id: "cmd_sub_test" })
      );
      expect(parsed.type).toBe(type);
    }

    expect(() =>
      CommandEnvelopeSchema.parse(
        createEnvelope(
          "subscriptions.startAuth",
          { provider: "invalid-provider" },
          { id: "cmd_bad" }
        )
      )
    ).toThrow();

    expect(
      SystemEventEnvelopeSchema.parse(
        createEnvelope(
          "subscriptions.authProgress",
          {
            authSessionId: "sub_auth_1",
            provider: "github-copilot",
            status: "completed",
            accountId: "sub_acct_1"
          },
          { id: "evt_auth" }
        )
      ).type
    ).toBe("subscriptions.authProgress");

    expect(
      SystemEventEnvelopeSchema.parse(
        createEnvelope(
          "subscriptions.stateChanged",
          {
            reason: "failover",
            provider: "google-gemini-cli",
            accountId: "sub_acct_2"
          },
          { id: "evt_state" }
        )
      ).type
    ).toBe("subscriptions.stateChanged");

    expect(
      SystemEventEnvelopeSchema.parse(
        createEnvelope(
          "subscriptions.stateChanged",
          {
            reason: "models_refreshed",
            provider: "openai-codex"
          },
          { id: "evt_models_refreshed" }
        )
      ).type
    ).toBe("subscriptions.stateChanged");
  });

  it("keeps subscription models excluded from device sync schemas", () => {
    expect(isSyncableModelId("sub:google-gemini-cli:gemini-2.5-pro")).toBe(
      false
    );
    expect(() =>
      syncModelConfigSchema.parse(
        baseModel({
          id: "sub:google-gemini-cli:gemini-2.5-pro",
          api: "google-cloud-code-assist",
          managedBy: "subscription"
        })
      )
    ).toThrow();
    expect(() =>
      toSyncModelConfig(
        baseModel({
          id: "sub:openai-codex:gpt-5.3-codex",
          api: "openai-codex-responses"
        })
      )
    ).toThrow();
  });

  it("keeps internal credential and command schemas out of renderer contracts entry", () => {
    expect(rendererContracts.SUBSCRIPTION_MODEL_ID_PREFIX).toBe("sub:");
    expect(
      rendererContracts.isSubscriptionModel("sub:openai-codex:gpt-5.3-codex")
    ).toBe(true);
    expect(rendererContracts.SubscriptionSettingsSnapshotSchema).toBeDefined();

    const exportedKeys = new Set(Object.keys(rendererContracts));
    expect(exportedKeys.has("SubscriptionCommandSchemas")).toBe(false);
    expect(exportedKeys.has("SubscriptionAcquireCredentialInputSchema")).toBe(
      false
    );
    expect(exportedKeys.has("SubscriptionReportAndFailoverInputSchema")).toBe(
      false
    );
    expect(exportedKeys.has("SubscriptionAcquiredCredentialSchema")).toBe(
      false
    );
  });
});
