import { describe, expect, it, vi } from "vitest";
import type { StoredAccountRecord, StoredAccountSecret } from "../types";
import {
  createAnthropicClaudeAdapter,
  createCodeBuddyAdapter,
  createCursorAdapter,
  createGitHubCopilotAdapter,
  createGoogleAntigravityAdapter,
  createGoogleGeminiCliAdapter,
  createKiroAdapter,
  createOpenAICodexAdapter,
  createWindsurfAdapter
} from "./index";

function makeAccount(
  provider: StoredAccountRecord["provider"],
  metadata?: Record<string, string>
): StoredAccountRecord {
  return {
    id: `acct_${provider}`,
    provider,
    displayName: `${provider}@example.test`,
    email: `${provider}@example.test`,
    source: "oauth",
    isPrimary: true,
    enabled: true,
    status: "active",
    consecutiveRateLimits: 0,
    quotaBuckets: [],
    createdAt: "2026-11-28T00:00:00.000Z",
    ...(metadata ? { metadata } : {})
  };
}

function makeSecret(
  overrides: Partial<StoredAccountSecret> = {}
): StoredAccountSecret {
  return {
    accessToken: "placeholder-access-token",
    refreshToken: "placeholder-refresh-token",
    expiresAt: "2026-11-29T00:00:00.000Z",
    ...overrides
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

describe("live remote model pulling across all 9 subscription providers", () => {
  it("fetches latest Gemini CLI models via fetchAvailableModels and falls back to retrieveUserQuota", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes(":loadCodeAssist")) {
        return jsonResponse({ cloudaicompanionProject: "proj-live-1" });
      }
      if (url.includes(":fetchAvailableModels")) {
        return jsonResponse({
          models: {
            "gemini-2.5-pro": {
              displayName: "Gemini 2.5 Pro",
              maxTokens: 1_048_576,
              maxOutputTokens: 65_536
            },
            "gemini-3.5-pro-preview": {
              displayName: "Gemini 3.5 Pro Preview",
              maxTokens: 2_000_000,
              maxOutputTokens: 65_536,
              supportsThinking: true
            }
          }
        });
      }
      return jsonResponse({}, 404);
    });

    const adapter = createGoogleGeminiCliAdapter({
      fetcher: fetcher as unknown as typeof fetch,
      cloudCodeBaseUrl: "https://cloudcode.example.test"
    });
    const models = await adapter.listModels(
      makeAccount("google-gemini-cli"),
      makeSecret()
    );
    expect(models.some((m) => m.modelId === "gemini-3.5-pro-preview")).toBe(
      true
    );
    expect(
      models.find((m) => m.modelId === "gemini-3.5-pro-preview")?.contextWindow
    ).toBe(2_000_000);

    // Fallback to retrieveUserQuota when fetchAvailableModels fails.
    const quotaFallbackFetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes(":fetchAvailableModels")) {
        return jsonResponse({ error: "not available" }, 404);
      }
      if (url.includes(":retrieveUserQuota")) {
        return jsonResponse({
          buckets: [
            { modelId: "gemini-3.0-ultra-live", remainingFraction: 0.9 }
          ]
        });
      }
      return jsonResponse({}, 404);
    });
    const fallbackAdapter = createGoogleGeminiCliAdapter({
      fetcher: quotaFallbackFetcher as unknown as typeof fetch,
      cloudCodeBaseUrl: "https://cloudcode.example.test"
    });
    const fallbackModels = await fallbackAdapter.listModels(
      makeAccount("google-gemini-cli", { projectId: "proj-live-2" }),
      makeSecret()
    );
    expect(
      fallbackModels.some((m) => m.modelId === "gemini-3.0-ultra-live")
    ).toBe(true);
  });

  it("lists the published Google subscription models when signed out", async () => {
    const legacy = await createGoogleGeminiCliAdapter().listModels();
    expect(legacy.length).toBeGreaterThan(0);
    expect(legacy.every((model) => model.modelId.startsWith("gemini-3"))).toBe(
      true
    );
    const current = await createGoogleAntigravityAdapter().listModels();
    expect(current.map((model) => model.modelId)).toContain(
      "gemini-4-hydrogen"
    );
  });

  it.each([createGoogleGeminiCliAdapter, createGoogleAntigravityAdapter])(
    "propagates Google catalog 401s for the manager to retry",
    async (createAdapter) => {
      const adapter = createAdapter({
        fetcher: async () => jsonResponse({}, 401)
      });
      await expect(
        adapter.listModels(
          makeAccount(adapter.id),
          makeSecret({ extra: { projectId: "fixture" } })
        )
      ).rejects.toMatchObject({ code: "subscriptions.secret_refresh_failed" });
    }
  );

  it("negotiates the Hub inventory and removes disabled menu placeholders", async () => {
    const adapter = createGoogleAntigravityAdapter({
      fetcher: async (_url, init) => {
        const hub = new Headers(init?.headers)
          .get("user-agent")
          ?.includes("antigravity/hub/");
        const preferred = hub ? "new-chat-xhigh" : "old-chat";
        return jsonResponse({
          models: {
            [preferred]: {
              supportsThinking: true,
              quotaInfo: { remainingFraction: 0.9 }
            },
            "locked-chat": { disabled: true },
            "locked-disabled": {}
          },
          defaultAgentModelId: preferred,
          agentModelSorts: [
            {
              groups: [
                { modelIds: [preferred, "locked-chat", "locked-disabled"] }
              ]
            }
          ]
        });
      }
    });
    const result = await adapter.fetchQuota(
      makeAccount(adapter.id),
      makeSecret({ extra: { projectId: "fixture" } })
    );
    expect(
      result.models?.map((m) => [m.modelId, m.defaultThinkingLevel])
    ).toEqual([["new-chat-xhigh", "xhigh"]]);
    expect(result.quotaBuckets.map((b) => b.id)).toEqual(["new-chat-xhigh"]);
  });

  it("uses the advertised chat menu for both quota and models, retaining fractional balances", async () => {
    const adapter = createGoogleAntigravityAdapter({
      fetcher: async () =>
        jsonResponse({
          defaultAgentModelId: "chat-b",
          agentModelSorts: [
            {
              groups: [{ modelIds: ["chat-b", "chat-a", "chat-b", "unknown"] }]
            }
          ],
          models: {
            "tab-preview": {
              displayName: "Alias",
              quotaInfo: { remainingFraction: 1 }
            },
            "chat-a": {
              supportsThinking: false,
              quotaInfo: { remainingFraction: 0.001 }
            },
            "chat-b": {
              supportsThinking: true,
              quotaInfo: { resetTime: "2026-11-28T06:00:00.000Z" }
            }
          }
        })
    });
    const result = await adapter.fetchQuota(
      makeAccount(adapter.id),
      makeSecret({ extra: { projectId: "fixture" } })
    );
    expect(result.quotaBuckets.map((b) => b.id)).toEqual(["chat-b", "chat-a"]);
    expect(result.quotaBuckets[0]?.remainingPercent).toBeUndefined();
    expect(result.quotaBuckets[1]?.remainingPercent).toBeCloseTo(0.1);
    expect(
      result.models?.map((m) => [m.modelId, m.recommended, m.reasoning])
    ).toEqual([
      ["chat-b", true, true],
      ["chat-a", false, false]
    ]);
  });

  it("auto-resolves missing projectId for Google Antigravity before calling fetchAvailableModels", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes(":loadCodeAssist")) {
        return jsonResponse({ cloudaicompanionProject: "ag-proj-live" });
      }
      if (url.includes(":fetchAvailableModels")) {
        return jsonResponse({
          models: {
            "claude-sonnet-4-7-thinking": {
              displayName: "Claude Sonnet 4.7 (Thinking)",
              maxTokens: 200_000,
              maxOutputTokens: 64_000
            }
          }
        });
      }
      return jsonResponse({}, 404);
    });

    const adapter = createGoogleAntigravityAdapter({
      fetcher: fetcher as unknown as typeof fetch,
      endpointUrl: "https://ag.example.test"
    });
    const models = await adapter.listModels(
      makeAccount("google-antigravity"),
      makeSecret()
    );
    expect(models[0]).toMatchObject({
      modelId: "claude-sonnet-4-7-thinking",
      contextWindow: 200_000,
      maxTokens: 64_000,
      recommended: true
    });
  });

  it("fetches latest OpenAI Codex models from /codex/models and filters unsupported entries", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      expect(url).toContain("/codex/models");
      return jsonResponse({
        models: [
          {
            slug: "gpt-6-astra",
            display_name: "GPT-6 Astra",
            context_window: 400_000,
            max_output_tokens: 128_000,
            supported_reasoning_levels: ["low", "medium", "high"],
            default_reasoning_level: "high",
            supported_in_api: true
          },
          {
            slug: "hidden-internal-model",
            visibility: "hide",
            supported_in_api: true
          }
        ]
      });
    });

    const adapter = createOpenAICodexAdapter({
      fetcher: fetcher as unknown as typeof fetch,
      apiBaseUrl: "https://codex.example.test/backend-api"
    });
    const models = await adapter.listModels(
      makeAccount("openai-codex", { chatgptAccountId: "acct-org-1" }),
      makeSecret()
    );
    expect(models.some((m) => m.modelId === "gpt-6-astra")).toBe(true);
    expect(models.some((m) => m.modelId === "hidden-internal-model")).toBe(
      false
    );
    expect(
      models.find((m) => m.modelId === "gpt-6-astra")?.defaultThinkingLevel
    ).toBe("high");
  });

  it("parses context window and reasoning capabilities from GitHub Copilot /models", async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({
        data: [
          {
            id: "claude-opus-4.6",
            name: "Claude Opus 4.6",
            model_picker_enabled: true,
            capabilities: {
              limits: {
                max_context_window_tokens: 200_000,
                max_output_tokens: 32_000
              },
              supports: { thinking: true }
            }
          }
        ]
      })
    );

    const adapter = createGitHubCopilotAdapter({
      fetcher: fetcher as unknown as typeof fetch
    });
    const models = await adapter.listModels(
      makeAccount("github-copilot"),
      makeSecret({
        providerToken: "placeholder-copilot-token",
        providerTokenExpiresAt: "2026-11-29T00:00:00.000Z",
        extra: { apiBaseUrl: "https://copilot.example.test" }
      })
    );
    const opus = models.find((m) => m.modelId === "claude-opus-4.6");
    expect(opus?.contextWindow).toBe(200_000);
    expect(opus?.maxTokens).toBe(32_000);
    expect(opus?.reasoning).toBe(true);
  });

  it("fetches latest Anthropic Claude models from /v1/models", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toContain("/v1/models");
      return jsonResponse({
        data: [
          {
            id: "claude-opus-4-6-20260901",
            display_name: "Claude Opus 4.6",
            max_tokens: 32_000
          },
          { id: "non-claude-internal", display_name: "Internal" }
        ]
      });
    });

    const adapter = createAnthropicClaudeAdapter({
      fetcher: fetcher as unknown as typeof fetch,
      apiBaseUrl: "https://anthropic.example.test"
    });
    const models = await adapter.listModels(
      makeAccount("anthropic-claude"),
      makeSecret()
    );
    expect(models.some((m) => m.modelId === "claude-opus-4-6-20260901")).toBe(
      true
    );
    expect(models.some((m) => m.modelId === "non-claude-internal")).toBe(false);
  });

  it("fetches latest Kiro models from /ListAvailableModels", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toContain("/ListAvailableModels");
      return jsonResponse({
        models: [
          {
            modelId: "claude-sonnet-4.6",
            modelName: "Claude Sonnet 4.6",
            tokenLimits: {
              maxInputTokens: 200_000,
              maxOutputTokens: 16_384
            }
          }
        ]
      });
    });

    const adapter = createKiroAdapter({
      fetcher: fetcher as unknown as typeof fetch,
      codeWhispererBaseUrl: "https://kiro.example.test"
    });
    const models = await adapter.listModels(
      makeAccount("kiro", {
        profileArn: "arn:aws:codewhisperer:us-east-1:0:profile/test"
      }),
      makeSecret()
    );
    const model = models.find((m) => m.modelId === "claude-sonnet-4.6");
    expect(model?.contextWindow).toBe(200_000);
    expect(model?.maxTokens).toBe(16_384);
  });

  it("fetches latest Cursor models from AiService/AvailableModels", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toContain("AiService/AvailableModels");
      return jsonResponse({
        models: [
          {
            name: "composer-2-thinking",
            clientDisplayName: "Composer 2 Thinking",
            supportsThinking: true,
            maxTokenLength: 256_000
          }
        ]
      });
    });

    const adapter = createCursorAdapter({
      fetcher: fetcher as unknown as typeof fetch,
      apiBaseUrl: "https://cursor.example.test"
    });
    const models = await adapter.listModels(
      makeAccount("cursor"),
      makeSecret()
    );
    const model = models.find((m) => m.modelId === "composer-2-thinking");
    expect(model?.label).toBe("Composer 2 Thinking");
    expect(model?.reasoning).toBe(true);
    expect(model?.contextWindow).toBe(256_000);
  });

  it("fetches latest Windsurf models from SeatManagementService/GetUserStatus", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toContain("SeatManagementService/GetUserStatus");
      return jsonResponse({
        userStatus: {
          cascadeModelConfigData: {
            clientModelConfigs: [
              {
                label: "SWE-2 Pro",
                modelOrAlias: { model: "swe-2-pro" },
                supportsThinking: true,
                maxTokens: 200_000
              }
            ]
          }
        }
      });
    });

    const adapter = createWindsurfAdapter({
      fetcher: fetcher as unknown as typeof fetch,
      apiBaseUrl: "https://windsurf.example.test"
    });
    const models = await adapter.listModels(
      makeAccount("windsurf"),
      makeSecret()
    );
    const model = models.find((m) => m.modelId === "swe-2-pro");
    expect(model?.label).toBe("SWE-2 Pro");
    expect(model?.reasoning).toBe(true);
  });

  it("fetches latest CodeBuddy models from /v2/models with /v1/models fallback", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/v2/models")) {
        return jsonResponse({ error: "not found" }, 404);
      }
      if (url.endsWith("/v1/models")) {
        return jsonResponse({
          data: [
            {
              id: "deepseek-r2-live",
              name: "DeepSeek R2",
              context_length: 131_072,
              max_output_tokens: 16_384,
              supports_reasoning: true
            }
          ]
        });
      }
      return jsonResponse({}, 404);
    });

    const adapter = createCodeBuddyAdapter({
      fetcher: fetcher as unknown as typeof fetch,
      apiBaseUrl: "https://codebuddy.example.test"
    });
    const models = await adapter.listModels(
      makeAccount("codebuddy", { domain: "https://codebuddy.example.test" }),
      makeSecret()
    );
    const model = models.find((m) => m.modelId === "deepseek-r2-live");
    expect(model?.label).toBe("DeepSeek R2");
    expect(model?.contextWindow).toBe(131_072);
    expect(model?.reasoning).toBe(true);
  });
});
