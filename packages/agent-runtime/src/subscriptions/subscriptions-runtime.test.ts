import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  Type,
  createAssistantMessageEventStream,
  normalizeContext,
  type Api,
  type AssistantMessage,
  type AssistantMessageEvent,
  type Context,
  type Model,
  type SimpleStreamOptions
} from "@earendil-works/pi-ai";
import type { AgentProviderRuntimeConfig } from "@writer/contracts";
import { applyGeminiWritingSafetySettings } from "../gemini-safety";
import { buildProviderRuntime } from "../provider-runtime";
import { PiAgentRuntimeAdapter } from "../adapter";
import {
  CODEBUDDY_CHAT_DEFAULT_BASE_URL,
  CONNECT_FLAG_COMPRESSED,
  CONNECT_FLAG_END_STREAM,
  CURSOR_CONNECT_DEFAULT_BASE_URL,
  GOOGLE_ANTIGRAVITY_DEFAULT_BASE_URL,
  GOOGLE_CLOUD_CODE_ASSIST_DEFAULT_BASE_URL,
  KIRO_CODEWHISPERER_DEFAULT_BASE_URL,
  WINDSURF_CONNECT_DEFAULT_BASE_URL,
  buildCodeBuddyChatRequest,
  buildCursorConnectRequest,
  buildGoogleSubscriptionRequestEnvelope,
  buildKiroCodeWhispererRequest,
  buildWindsurfConnectRequest,
  classifySubscriptionFailure,
  codeBuddyChatApi,
  concatUint8Arrays,
  cursorConnectApi,
  decodeAwsEventStreamFrames,
  encodeConnectEnvelope,
  encodeProtoBytesField,
  encodeProtoStringField,
  googleAntigravityApi,
  googleCloudCodeAssistApi,
  kiroCodeWhispererApi,
  windsurfConnectApi,
  withSubscriptionFailover,
  type SubscriptionCredentialBridge
} from "./index";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function createRuntimeConfig(
  overrides: Partial<AgentProviderRuntimeConfig> = {}
): AgentProviderRuntimeConfig {
  return {
    id: "sub:google-gemini-cli:gemini-2.5-pro",
    label: "Gemini 2.5 Pro",
    provider: "google-gemini-cli",
    modelId: "gemini-2.5-pro",
    api: "google-cloud-code-assist",
    apiKey: "sub-access-initial",
    baseUrl: "https://cloudcode.example.test",
    reasoning: true,
    defaultThinkingLevel: "medium",
    thinkingLevelOptions: ["minimal", "low", "medium", "high"],
    temperatureOptions: [0.1, 0.7, 1],
    managedBy: "subscription",
    subscriptionAuth: {
      provider: "google-gemini-cli",
      accountId: "sub_acct_1",
      expiresAt: "2099-01-01T00:00:00.000Z",
      metadata: { projectId: "proj-initial" }
    },
    ...overrides
  };
}

function createFakeCodexJwt(accountId: string): string {
  const header = Buffer.from(JSON.stringify({ alg: "RS256" })).toString(
    "base64url"
  );
  const payload = Buffer.from(
    JSON.stringify({
      email: "codex-user@example.test",
      "https://api.openai.com/auth": {
        chatgpt_account_id: accountId,
        chatgpt_plan_type: "plus"
      }
    })
  ).toString("base64url");
  return `${header}.${payload}.fake_signature`;
}

function createPiModel(overrides: Partial<Model<Api>> = {}): Model<Api> {
  return {
    id: "gemini-2.5-pro",
    name: "Gemini 2.5 Pro",
    api: "google-cloud-code-assist" as Api,
    provider: "google-gemini-cli",
    baseUrl: "https://cloudcode.example.test",
    reasoning: true,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1_048_576,
    maxTokens: 65_536,
    ...overrides
  } as Model<Api>;
}

function createBaseAssistantMessage(
  model: Model<Api>,
  overrides: Partial<AssistantMessage> = {}
): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
    },
    stopReason: "stop",
    timestamp: Date.now(),
    ...overrides
  };
}

function createSseResponse(
  chunks: unknown[],
  status = 200,
  headers: Record<string, string> = {}
): Response {
  const encoder = new TextEncoder();
  const payload =
    chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") +
    "data: [DONE]\n\n";
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(payload));
        controller.close();
      }
    }),
    {
      status,
      headers: {
        "Content-Type": "text/event-stream",
        ...headers
      }
    }
  );
}

describe("classifySubscriptionFailure", () => {
  it("classifies rate limits, quota resets, and invalid credentials without treating 500 as failover", () => {
    expect(
      classifySubscriptionFailure(
        new Error(
          "[HTTP 429] You have hit your ChatGPT usage limit (plus plan). Try again in ~42 min."
        )
      )
    ).toEqual({
      reason: "quota_exhausted",
      retryAfterSec: 42 * 60,
      message:
        "[HTTP 429] You have hit your ChatGPT usage limit (plus plan). Try again in ~42 min."
    });

    expect(
      classifySubscriptionFailure({
        status: 429,
        message: "RESOURCE_EXHAUSTED: quota reset at 2026-11-28T03:00:00.000Z"
      })
    ).toEqual({
      reason: "rate_limited",
      resetAt: "2026-11-28T03:00:00.000Z",
      message: "RESOURCE_EXHAUSTED: quota reset at 2026-11-28T03:00:00.000Z"
    });

    expect(
      classifySubscriptionFailure(new Error("[HTTP 401] invalid_token"))
    ).toEqual({
      reason: "unauthorized",
      message: "[HTTP 401] invalid_token"
    });

    expect(
      classifySubscriptionFailure(new Error("[HTTP 500] Internal Server Error"))
    ).toBeUndefined();
  });
});

describe("withSubscriptionFailover", () => {
  it("proactively refreshes expiring credentials before invoking the stream", async () => {
    const acquireCredential = vi.fn(async () => ({
      provider: "google-gemini-cli" as const,
      accountId: "sub_acct_1",
      apiKey: "sub-access-refreshed",
      baseUrl: "https://cloudcode-refreshed.example.test",
      expiresAt: "2099-02-01T00:00:00.000Z",
      metadata: { projectId: "proj-refreshed" }
    }));
    const reportAndFailover = vi.fn();
    const seenCalls: Array<{
      apiKey: string | undefined;
      baseUrl: string;
      projectId: string | undefined;
    }> = [];

    const wrapped = withSubscriptionFailover({
      config: createRuntimeConfig({
        subscriptionAuth: {
          provider: "google-gemini-cli",
          accountId: "sub_acct_1",
          expiresAt: new Date(1_000_030_000).toISOString(),
          metadata: { projectId: "proj-initial" }
        }
      }),
      bridge: { acquireCredential, reportAndFailover },
      now: () => 1_000_000_000,
      streamFn: (model, _context, options) => {
        seenCalls.push({
          apiKey: options?.apiKey,
          baseUrl: model.baseUrl,
          projectId:
            options?.headers?.["x-writer-subscription-project-id"] ?? undefined
        });
        const stream = createAssistantMessageEventStream();
        queueMicrotask(() => {
          const msg = createBaseAssistantMessage(model, {
            content: [{ type: "text", text: "ok" }]
          });
          stream.push({ type: "start", partial: msg });
          stream.push({ type: "text_start", contentIndex: 0, partial: msg });
          stream.push({
            type: "text_delta",
            contentIndex: 0,
            delta: "ok",
            partial: msg
          });
          stream.push({ type: "done", reason: "stop", message: msg });
          stream.end();
        });
        return stream;
      }
    });

    const events: AssistantMessageEvent[] = [];
    for await (const event of await wrapped(createPiModel(), {
      messages: []
    })) {
      events.push(event);
    }

    expect(acquireCredential).toHaveBeenCalledTimes(1);
    expect(reportAndFailover).not.toHaveBeenCalled();
    expect(seenCalls).toEqual([
      {
        apiKey: "sub-access-refreshed",
        baseUrl: "https://cloudcode-refreshed.example.test",
        projectId: "proj-refreshed"
      }
    ]);
    expect(events.map((e) => e.type)).toEqual([
      "start",
      "text_start",
      "text_delta",
      "done"
    ]);
  });

  it("fails over cleanly on 429 before any assistant output and emits a single start event", async () => {
    const acquireCredential = vi.fn();
    const reportAndFailover = vi.fn(async () => ({
      provider: "google-gemini-cli" as const,
      accountId: "sub_acct_2",
      apiKey: "sub-access-backup",
      baseUrl: "https://cloudcode-backup.example.test",
      expiresAt: "2099-02-01T00:00:00.000Z",
      extraHeaders: { "x-custom-acct": "backup-acct" },
      metadata: { projectId: "proj-backup" }
    }));

    let attempt = 0;
    const seenHeaders: Array<Record<string, string | null> | undefined> = [];
    const seenKeys: Array<string | undefined> = [];

    const wrapped = withSubscriptionFailover({
      config: createRuntimeConfig(),
      bridge: { acquireCredential, reportAndFailover },
      now: () => 1_000_000_000,
      streamFn: (model, _context, options) => {
        attempt += 1;
        seenKeys.push(options?.apiKey);
        seenHeaders.push(options?.headers);
        const stream = createAssistantMessageEventStream();
        queueMicrotask(() => {
          if (attempt === 1) {
            const errMsg = createBaseAssistantMessage(model, {
              stopReason: "error",
              errorMessage: "[HTTP 429] (Retry-After: 25) quota reached"
            });
            stream.push({ type: "start", partial: errMsg });
            stream.push({ type: "error", reason: "error", error: errMsg });
            stream.end();
            return;
          }
          const okMsg = createBaseAssistantMessage(model, {
            content: [{ type: "text", text: "续写完成" }]
          });
          stream.push({ type: "start", partial: okMsg });
          stream.push({ type: "text_start", contentIndex: 0, partial: okMsg });
          stream.push({
            type: "text_delta",
            contentIndex: 0,
            delta: "续写完成",
            partial: okMsg
          });
          stream.push({ type: "done", reason: "stop", message: okMsg });
          stream.end();
        });
        return stream;
      }
    });

    const events: AssistantMessageEvent[] = [];
    for await (const event of await wrapped(createPiModel(), {
      messages: []
    })) {
      events.push(event);
    }

    expect(attempt).toBe(2);
    expect(seenKeys).toEqual(["sub-access-initial", "sub-access-backup"]);
    expect(seenHeaders[1]).toMatchObject({
      "x-custom-acct": "backup-acct",
      "x-writer-subscription-project-id": "proj-backup"
    });
    expect(reportAndFailover).toHaveBeenCalledWith({
      provider: "google-gemini-cli",
      modelId: "sub:google-gemini-cli:gemini-2.5-pro",
      failedAccountId: "sub_acct_1",
      reason: "rate_limited",
      retryAfterSec: 25,
      message: "[HTTP 429] (Retry-After: 25) quota reached"
    });
    expect(events.filter((e) => e.type === "start")).toHaveLength(1);
    expect(events.map((e) => e.type)).toEqual([
      "start",
      "text_start",
      "text_delta",
      "done"
    ]);
  });

  it("does not replay after content has streamed, reporting failure in background", async () => {
    const reportAndFailover = vi.fn(async () => ({
      provider: "google-gemini-cli" as const,
      accountId: "sub_acct_2",
      apiKey: "sub-access-backup"
    }));
    const streamSpy = vi.fn((model: Model<Api>) => {
      const stream = createAssistantMessageEventStream();
      queueMicrotask(() => {
        const partial = createBaseAssistantMessage(model, {
          content: [{ type: "text", text: "半段正文" }]
        });
        stream.push({ type: "start", partial });
        stream.push({ type: "text_start", contentIndex: 0, partial });
        stream.push({
          type: "text_delta",
          contentIndex: 0,
          delta: "半段正文",
          partial
        });
        stream.push({
          type: "error",
          reason: "error",
          error: {
            ...partial,
            stopReason: "error",
            errorMessage: "[HTTP 429] mid-stream limit"
          }
        });
        stream.end();
      });
      return stream;
    });

    const wrapped = withSubscriptionFailover({
      config: createRuntimeConfig(),
      bridge: {
        acquireCredential: vi.fn(),
        reportAndFailover
      },
      streamFn: streamSpy
    });

    const events: AssistantMessageEvent[] = [];
    for await (const event of await wrapped(createPiModel(), {
      messages: []
    })) {
      events.push(event);
    }

    expect(streamSpy).toHaveBeenCalledTimes(1);
    expect(events.map((e) => e.type)).toEqual([
      "start",
      "text_start",
      "text_delta",
      "error"
    ]);
    expect(reportAndFailover).toHaveBeenCalledWith(
      expect.objectContaining({
        failedAccountId: "sub_acct_1",
        reason: "rate_limited"
      })
    );
  });

  it("stops retrying after maxFailovers", async () => {
    const reportAndFailover = vi.fn(async () => ({
      provider: "google-gemini-cli" as const,
      accountId: "sub_acct_next",
      apiKey: "sub-access-next"
    }));
    const streamSpy = vi.fn((model: Model<Api>) => {
      const stream = createAssistantMessageEventStream();
      queueMicrotask(() => {
        const errMsg = createBaseAssistantMessage(model, {
          stopReason: "error",
          errorMessage: "[HTTP 401] invalid_token"
        });
        stream.push({ type: "error", reason: "error", error: errMsg });
        stream.end();
      });
      return stream;
    });

    const wrapped = withSubscriptionFailover({
      config: createRuntimeConfig(),
      bridge: {
        acquireCredential: vi.fn(),
        reportAndFailover
      },
      maxFailovers: 2,
      streamFn: streamSpy
    });

    const events: AssistantMessageEvent[] = [];
    for await (const event of await wrapped(createPiModel(), {
      messages: []
    })) {
      events.push(event);
    }

    expect(reportAndFailover).toHaveBeenCalledTimes(2);
    expect(streamSpy).toHaveBeenCalledTimes(3);
    expect(events.at(-1)?.type).toBe("error");
  });
});

describe("google subscription SSE streams", () => {
  it("builds Antigravity Claude envelopes with parameters schema and safety settings", async () => {
    const antigravityModel = createPiModel({
      id: "claude-sonnet-4-5-thinking",
      api: "google-antigravity" as Api,
      provider: "google-antigravity",
      baseUrl: "https://antigravity.example.test"
    });
    const context: Context = {
      systemPrompt: "Be concise.",
      messages: [{ role: "user", content: "hi", timestamp: 1 }],
      tools: [
        {
          name: "read_scene",
          description: "Read scene",
          parameters: {
            type: "object",
            properties: { id: { type: "string" } },
            required: ["id"]
          } as never
        }
      ]
    };

    const envelope = buildGoogleSubscriptionRequestEnvelope(
      antigravityModel,
      context,
      undefined,
      "antigravity",
      "proj-ag"
    );

    expect(envelope).toMatchObject({
      project: "proj-ag",
      model: "claude-sonnet-4-5-thinking",
      userAgent: "antigravity",
      requestType: "agent"
    });
    expect(String(envelope.requestId)).toMatch(/^ag_req_/u);
    const inner = envelope.request as {
      tools?: Array<{ functionDeclarations?: Array<Record<string, unknown>> }>;
    };
    const declaration = inner.tools?.[0]?.functionDeclarations?.[0];
    expect(declaration?.parameters).toBeDefined();
    expect(declaration?.parametersJsonSchema).toBeUndefined();

    const safetyWrapped = applyGeminiWritingSafetySettings(
      createRuntimeConfig({
        provider: "google-antigravity",
        api: "google-antigravity",
        modelId: "gemini-3-pro-high"
      }),
      {}
    );
    const wrappedPayload = (await safetyWrapped.onPayload?.(
      { ...envelope } as unknown,
      antigravityModel
    )) as { request?: { safetySettings?: unknown[] } };
    expect(wrappedPayload.request?.safetySettings).toHaveLength(4);
  });

  it("parses thinking signatures, text blocks, tool calls, usage, and HTTP errors from Google SSE streams", async () => {
    const seenUrls: string[] = [];
    const seenBodies: unknown[] = [];
    const seenHeaders: Array<Record<string, string>> = [];

    const fetcher = vi.fn(async (input: string, init?: RequestInit) => {
      seenUrls.push(input);
      seenBodies.push(JSON.parse(String(init?.body ?? "{}")));
      seenHeaders.push((init?.headers ?? {}) as Record<string, string>);
      return createSseResponse([
        {
          response: {
            candidates: [
              {
                content: {
                  parts: [
                    {
                      thought: true,
                      text: "Thinking step",
                      thoughtSignature: "sig-think-1"
                    }
                  ]
                }
              }
            ]
          }
        },
        {
          response: {
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: "Checking ",
                      thoughtSignature: "sig-text-1"
                    }
                  ]
                }
              }
            ]
          }
        },
        {
          response: {
            candidates: [
              {
                content: {
                  parts: [
                    {
                      functionCall: {
                        id: "call_1",
                        name: "read_scene",
                        args: { id: "scene_1" }
                      },
                      thoughtSignature: "sig-tool-1"
                    }
                  ]
                },
                finishReason: "STOP"
              }
            ],
            usageMetadata: {
              promptTokenCount: 120,
              candidatesTokenCount: 30,
              thoughtsTokenCount: 15,
              cachedContentTokenCount: 10,
              totalTokenCount: 165
            }
          }
        }
      ]);
    });

    const api = googleCloudCodeAssistApi(fetcher);
    const model = createPiModel({
      baseUrl: "https://cloudcode.example.test"
    });
    const stream = await api.streamSimple(
      model,
      normalizeContext({
        messages: [{ role: "user", content: "inspect", timestamp: 1 }]
      }),
      {
        apiKey: "gemini-token-1",
        reasoning: "medium",
        headers: { "x-writer-subscription-project-id": "proj-123" }
      }
    );

    const events: AssistantMessageEvent[] = [];
    for await (const event of stream) {
      events.push(event);
    }

    expect(seenUrls[0]).toBe(
      "https://cloudcode.example.test/v1internal:streamGenerateContent?alt=sse"
    );
    expect(seenHeaders[0]?.Authorization).toBe("Bearer gemini-token-1");
    expect(
      seenHeaders[0]?.["x-writer-subscription-project-id"]
    ).toBeUndefined();
    expect(seenBodies[0]).toMatchObject({
      project: "proj-123",
      model: "gemini-2.5-pro"
    });

    const doneEvent = events.find((event) => event.type === "done");
    expect(doneEvent?.type).toBe("done");
    if (doneEvent?.type === "done") {
      expect(doneEvent.reason).toBe("toolUse");
      expect(doneEvent.message.content).toEqual([
        {
          type: "thinking",
          thinking: "Thinking step",
          thinkingSignature: "sig-think-1"
        },
        {
          type: "text",
          text: "Checking ",
          textSignature: "sig-text-1"
        },
        {
          type: "toolCall",
          id: "call_1",
          name: "read_scene",
          arguments: { id: "scene_1" },
          thoughtSignature: "sig-tool-1"
        }
      ]);
      expect(doneEvent.message.usage).toMatchObject({
        input: 120,
        output: 45,
        cacheRead: 10,
        totalTokens: 165
      });
    }

    const agErrorFetcher = vi.fn(
      async (_url: string) =>
        new Response(JSON.stringify({ error: { message: "quota depleted" } }), {
          status: 429,
          headers: { "Retry-After": "15" }
        })
    );
    const agStream = await googleAntigravityApi(agErrorFetcher).streamSimple(
      createPiModel({
        api: "google-antigravity" as Api,
        provider: "google-antigravity",
        baseUrl: ""
      }),
      normalizeContext({
        messages: [{ role: "user", content: "hi", timestamp: 1 }]
      }),
      { apiKey: "ag-token-1" }
    );
    const agEvents: AssistantMessageEvent[] = [];
    for await (const event of agStream) {
      agEvents.push(event);
    }
    expect(agErrorFetcher.mock.calls[0]?.[0]).toBe(
      `${GOOGLE_ANTIGRAVITY_DEFAULT_BASE_URL}/v1internal:streamGenerateContent?alt=sse`
    );
    const err = agEvents.at(-1);
    expect(err?.type).toBe("error");
    if (err?.type === "error") {
      expect(err.error.errorMessage).toContain("[HTTP 429]");
      expect(err.error.errorMessage).toContain("Retry-After: 15");
    }
  });
});

describe("provider-runtime and testConnection Phase 1 subscription routing", () => {
  it("resolves Codex and GitHub Copilot wire APIs, headers, and default base URLs", () => {
    const codexRuntime = buildProviderRuntime(
      createRuntimeConfig({
        id: "sub:openai-codex:gpt-5.3-codex",
        provider: "openai-codex",
        modelId: "gpt-5.3-codex",
        api: "openai-codex-responses",
        apiKey: createFakeCodexJwt("acct_codex_01"),
        baseUrl: "",
        subscriptionAuth: {
          provider: "openai-codex",
          accountId: "sub_codex_1",
          extraHeaders: { "chatgpt-account-id": "acct_codex_01" }
        }
      })
    );
    expect(codexRuntime.model.api).toBe("openai-codex-responses");
    expect(codexRuntime.model.baseUrl).toBe("https://chatgpt.com/backend-api");
    expect(codexRuntime.model.headers).toMatchObject({
      "chatgpt-account-id": "acct_codex_01"
    });

    const copilotClaude = buildProviderRuntime(
      createRuntimeConfig({
        id: "sub:github-copilot:claude-sonnet-4.6",
        provider: "github-copilot",
        modelId: "claude-sonnet-4.6",
        api: "github-copilot",
        apiKey: "copilot-short-token",
        baseUrl: ""
      })
    );
    expect(copilotClaude.model.api).toBe("anthropic-messages");
    expect(copilotClaude.model.headers).toMatchObject({
      "Copilot-Integration-Id": "vscode-chat"
    });

    const copilotCodex = buildProviderRuntime(
      createRuntimeConfig({
        id: "sub:github-copilot:gpt-5.3-codex",
        provider: "github-copilot",
        modelId: "gpt-5.3-codex",
        api: "github-copilot",
        apiKey: "copilot-short-token",
        baseUrl: "https://copilot.example.test"
      })
    );
    expect(copilotCodex.model.api).toBe("openai-responses");

    const copilotOpenAI = buildProviderRuntime(
      createRuntimeConfig({
        id: "sub:github-copilot:gpt-4o",
        provider: "github-copilot",
        modelId: "gpt-4o",
        api: "github-copilot",
        apiKey: "copilot-short-token",
        baseUrl: "https://copilot.example.test"
      })
    );
    expect(copilotOpenAI.model.api).toBe("openai-completions");

    const geminiRuntime = buildProviderRuntime(
      createRuntimeConfig({
        baseUrl: ""
      })
    );
    expect(geminiRuntime.model.baseUrl).toBe(
      GOOGLE_CLOUD_CODE_ASSIST_DEFAULT_BASE_URL
    );
    expect(geminiRuntime.model.headers).toMatchObject({
      "x-writer-subscription-project-id": "proj-initial"
    });
  });

  it("supports models.test connection failover via SubscriptionCredentialBridge", async () => {
    const seenTokens: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        const headers = new Headers(init?.headers);
        const auth = headers.get("Authorization") ?? "";
        seenTokens.push(auth);
        if (auth === "Bearer tok-exhausted") {
          return new Response(
            JSON.stringify({ error: { message: "quota depleted" } }),
            { status: 429, headers: { "Retry-After": "30" } }
          );
        }
        return createSseResponse([
          {
            response: {
              candidates: [
                {
                  content: { parts: [{ text: "pong" }] },
                  finishReason: "STOP"
                }
              ],
              usageMetadata: {
                promptTokenCount: 12,
                candidatesTokenCount: 4,
                totalTokenCount: 16
              }
            }
          }
        ]);
      })
    );

    const bridge: SubscriptionCredentialBridge = {
      acquireCredential: vi.fn(),
      reportAndFailover: vi.fn(async () => ({
        provider: "google-gemini-cli" as const,
        accountId: "sub_acct_2",
        apiKey: "tok-healthy",
        baseUrl: "https://cloudcode.example.test",
        metadata: { projectId: "proj-backup" }
      }))
    };

    const adapter = new PiAgentRuntimeAdapter();
    const result = await adapter.testConnection(
      createRuntimeConfig({
        apiKey: "tok-exhausted"
      }),
      { subscriptionCredentialBridge: bridge }
    );

    expect(seenTokens).toEqual(["Bearer tok-exhausted", "Bearer tok-healthy"]);
    expect(bridge.reportAndFailover).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(true);
    expect(result.usage?.totalTokens).toBe(16);
  });
});

function encodeAwsEventStreamFrame(
  headers: Record<string, string>,
  payload: unknown
): Uint8Array {
  const encoder = new TextEncoder();
  const headerChunks: Uint8Array[] = [];
  for (const [name, value] of Object.entries(headers)) {
    const nameBytes = encoder.encode(name);
    const valBytes = encoder.encode(value);
    const chunk = new Uint8Array(
      1 + nameBytes.length + 1 + 2 + valBytes.length
    );
    const view = new DataView(chunk.buffer);
    chunk[0] = nameBytes.length;
    chunk.set(nameBytes, 1);
    chunk[1 + nameBytes.length] = 7; // string header type
    view.setUint16(2 + nameBytes.length, valBytes.length, false);
    chunk.set(valBytes, 4 + nameBytes.length);
    headerChunks.push(chunk);
  }
  const headersLength = headerChunks.reduce(
    (sum, item) => sum + item.length,
    0
  );
  const payloadBytes =
    typeof payload === "string"
      ? encoder.encode(payload)
      : encoder.encode(JSON.stringify(payload));
  const totalLength = 12 + headersLength + payloadBytes.length + 4;
  const frame = new Uint8Array(totalLength);
  const view = new DataView(frame.buffer);
  view.setUint32(0, totalLength, false);
  view.setUint32(4, headersLength, false);
  view.setUint32(8, 0, false); // prelude crc placeholder
  let cursor = 12;
  for (const chunk of headerChunks) {
    frame.set(chunk, cursor);
    cursor += chunk.length;
  }
  frame.set(payloadBytes, cursor);
  view.setUint32(totalLength - 4, 0, false); // message crc placeholder
  return frame;
}

describe("Phase 2 protocols: Anthropic Claude OAuth & Kiro CodeWhisperer", () => {
  it("builds Kiro CodeWhisperer request with history, tools, tool results, and profileArn", () => {
    const model = createPiModel({
      id: "claude-sonnet-4.5",
      api: "kiro-codewhisperer" as Api,
      provider: "kiro",
      baseUrl: "https://codewhisperer.example.test"
    });
    const payload = buildKiroCodeWhispererRequest(
      model,
      {
        systemPrompt: "You are a literary editor.",
        messages: [
          { role: "user", content: "Read chapter 1", timestamp: 1 },
          {
            role: "assistant",
            content: [
              { type: "text", text: "Let me check." },
              {
                type: "toolCall",
                id: "call_1",
                name: "read_doc",
                arguments: { path: "ch1.md" }
              }
            ],
            api: model.api,
            provider: model.provider,
            model: model.id,
            usage: {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
              totalTokens: 0,
              cost: {
                input: 0,
                output: 0,
                cacheRead: 0,
                cacheWrite: 0,
                total: 0
              }
            },
            stopReason: "toolUse",
            timestamp: 2
          },
          {
            role: "toolResult",
            toolCallId: "call_1",
            toolName: "read_doc",
            content: [{ type: "text", text: "Chapter 1 body" }],
            isError: false,
            timestamp: 3
          }
        ],
        tools: [
          {
            name: "read_doc",
            description: "Read a document",
            parameters: {
              type: "object",
              properties: { path: { type: "string" } }
            } as unknown as NonNullable<Context["tools"]>[number]["parameters"]
          }
        ]
      },
      { reasoning: "medium", sessionId: "conv-kiro-1" },
      "arn:aws:codewhisperer:us-east-1:000000000000:profile/test"
    );

    expect(payload.profileArn).toBe(
      "arn:aws:codewhisperer:us-east-1:000000000000:profile/test"
    );
    const state = payload.conversationState as Record<string, unknown>;
    expect(state.conversationId).toBe("conv-kiro-1");
    expect(Array.isArray(state.history)).toBe(true);
    expect((state.history as unknown[]).length).toBe(2);
    const current = (state.currentMessage as Record<string, unknown>)
      .userInputMessage as Record<string, unknown>;
    const msgCtx = current.userInputMessageContext as Record<string, unknown>;
    expect((msgCtx.tools as unknown[]).length).toBe(1);
    expect((msgCtx.toolResults as unknown[]).length).toBe(1);
  });

  it("decodes chunk-fragmented AWS EventStream frames with thinking, text, incremental tool calls, and usage", async () => {
    const frames = [
      encodeAwsEventStreamFrame(
        { ":message-type": "event", ":event-type": "assistantResponseEvent" },
        { content: "<thinking>规划章节" }
      ),
      encodeAwsEventStreamFrame(
        { ":message-type": "event", ":event-type": "assistantResponseEvent" },
        { content: "结构</thinking>正片开始。" }
      ),
      encodeAwsEventStreamFrame(
        { ":message-type": "event", ":event-type": "reasoningContentEvent" },
        { text: "补充推理", signature: "sig-kiro-1" }
      ),
      encodeAwsEventStreamFrame(
        { ":message-type": "event", ":event-type": "toolUseEvent" },
        { toolUseId: "tu_1", name: "save_draft", input: '{"title":' }
      ),
      encodeAwsEventStreamFrame(
        { ":message-type": "event", ":event-type": "toolUseEvent" },
        {
          toolUseId: "tu_1",
          name: "save_draft",
          input: '"第一章"}',
          stop: true
        }
      ),
      encodeAwsEventStreamFrame(
        { ":message-type": "event", ":event-type": "metadataEvent" },
        {
          usage: {
            inputTokens: 120,
            outputTokens: 45,
            cacheReadInputTokens: 20
          }
        }
      )
    ];

    const totalBytes = frames.reduce((sum, f) => sum + f.byteLength, 0);
    const combined = new Uint8Array(totalBytes);
    let offset = 0;
    for (const f of frames) {
      combined.set(f, offset);
      offset += f.byteLength;
    }

    // Also test direct decoder across arbitrary split points.
    const partA = decodeAwsEventStreamFrames(combined.slice(0, 23));
    expect(partA.frames).toHaveLength(0);
    const merged = new Uint8Array(
      partA.remainder.length + (combined.length - 23)
    );
    merged.set(partA.remainder, 0);
    merged.set(combined.slice(23), partA.remainder.length);
    const partB = decodeAwsEventStreamFrames(merged);
    expect(partB.frames).toHaveLength(6);
    expect(partB.remainder.length).toBe(0);

    let capturedHeaders: Record<string, string> = {};
    let capturedBody = "";
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      capturedHeaders = Object.fromEntries(
        new Headers(init?.headers).entries()
      );
      capturedBody = String(init?.body ?? "");
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            // Split across frame boundaries to exercise streaming reassembly.
            controller.enqueue(combined.slice(0, 31));
            controller.enqueue(combined.slice(31, 140));
            controller.enqueue(combined.slice(140));
            controller.close();
          }
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/vnd.amazon.eventstream" }
        }
      );
    });

    const api = kiroCodeWhispererApi(fetcher);
    const model = createPiModel({
      id: "claude-sonnet-4.5",
      api: "kiro-codewhisperer" as Api,
      provider: "kiro",
      baseUrl: "https://codewhisperer.example.test",
      headers: {
        "x-writer-subscription-profile-arn":
          "arn:aws:codewhisperer:us-east-1:000000000000:profile/demo"
      }
    });

    const events: AssistantMessageEvent[] = [];
    for await (const event of api.streamSimple(
      model,
      normalizeContext({
        messages: [{ role: "user", content: "写开头", timestamp: 1 }]
      }),
      { apiKey: "kiro-access-placeholder" }
    )) {
      events.push(event);
    }

    expect(capturedHeaders.authorization).toBe(
      "Bearer kiro-access-placeholder"
    );
    expect(
      capturedHeaders["x-writer-subscription-profile-arn"]
    ).toBeUndefined();
    expect(JSON.parse(capturedBody).profileArn).toBe(
      "arn:aws:codewhisperer:us-east-1:000000000000:profile/demo"
    );

    const done = events.find((e) => e.type === "done");
    expect(done?.type).toBe("done");
    if (done?.type === "done") {
      expect(done.reason).toBe("toolUse");
      expect(done.message.usage).toMatchObject({
        input: 120,
        output: 45,
        cacheRead: 20,
        totalTokens: 165
      });
      expect(done.message.content).toEqual([
        { type: "thinking", thinking: "规划章节结构" },
        { type: "text", text: "正片开始。" },
        {
          type: "thinking",
          thinking: "补充推理",
          thinkingSignature: "sig-kiro-1"
        },
        {
          type: "toolCall",
          id: "tu_1",
          name: "save_draft",
          arguments: { title: "第一章" }
        }
      ]);
    }
  });

  it("triggers failover on Kiro AWS EventStream ThrottlingException before output", async () => {
    const seenAuth: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        const auth = new Headers(init?.headers).get("Authorization") ?? "";
        seenAuth.push(auth);
        if (auth === "Bearer kiro-throttled") {
          const errFrame = encodeAwsEventStreamFrame(
            {
              ":message-type": "exception",
              ":exception-type": "ThrottlingException"
            },
            { message: "Rate limit reached" }
          );
          return new Response(Buffer.from(errFrame), {
            status: 200,
            headers: { "Content-Type": "application/vnd.amazon.eventstream" }
          });
        }
        return new Response(
          `data: ${JSON.stringify({ assistantResponseEvent: { content: "备用账号成功" } })}\n\n`,
          {
            status: 200,
            headers: { "Content-Type": "text/event-stream" }
          }
        );
      })
    );

    const bridge: SubscriptionCredentialBridge = {
      acquireCredential: vi.fn(),
      reportAndFailover: vi.fn(async () => ({
        provider: "kiro" as const,
        accountId: "kiro_acct_2",
        apiKey: "kiro-healthy",
        baseUrl: "https://codewhisperer.example.test",
        metadata: {
          profileArn: "arn:aws:codewhisperer:us-east-1:000000000000:profile/b2"
        }
      }))
    };

    const { model, streamFn } = buildProviderRuntime(
      createRuntimeConfig({
        id: "sub:kiro:claude-sonnet-4.5",
        label: "Claude Sonnet 4.5 (Kiro)",
        provider: "kiro",
        modelId: "claude-sonnet-4.5",
        api: "kiro-codewhisperer",
        apiKey: "kiro-throttled",
        baseUrl: "",
        subscriptionAuth: {
          provider: "kiro",
          accountId: "kiro_acct_1",
          expiresAt: "2099-01-01T00:00:00.000Z",
          metadata: {
            endpoint: "https://codewhisperer.example.test",
            profileArn:
              "arn:aws:codewhisperer:us-east-1:000000000000:profile/b1"
          }
        }
      }),
      undefined,
      "medium",
      { subscriptionCredentialBridge: bridge }
    );

    expect(model.api).toBe("kiro-codewhisperer");
    expect(model.baseUrl).toBe("https://codewhisperer.example.test");

    const events: AssistantMessageEvent[] = [];
    for await (const event of await streamFn(model, {
      messages: [{ role: "user", content: "测试", timestamp: 1 }]
    })) {
      events.push(event);
    }

    expect(seenAuth).toEqual(["Bearer kiro-throttled", "Bearer kiro-healthy"]);
    expect(bridge.reportAndFailover).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "kiro",
        failedAccountId: "kiro_acct_1",
        reason: "rate_limited"
      })
    );
    const done = events.find((e) => e.type === "done");
    expect(done?.type).toBe("done");
    if (done?.type === "done") {
      expect(done.message.content).toEqual([
        { type: "text", text: "备用账号成功" }
      ]);
    }
  });

  it("uses Bearer auth and OAuth headers for Claude subscriptions without affecting custom Anthropic API keys", async () => {
    const capturedRequests: Array<{
      url: string;
      authorization: string | null;
      xApiKey: string | null;
      beta: string | null;
      xApp: string | null;
    }> = [];

    const createAnthropicSse = (text: string) => {
      const sse = [
        `event: message_start\ndata: ${JSON.stringify({ type: "message_start", message: { id: "msg_1", type: "message", role: "assistant", model: "claude-sonnet-4-6", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 0 } } })}\n\n`,
        `event: content_block_start\ndata: ${JSON.stringify({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } })}\n\n`,
        `event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text } })}\n\n`,
        `event: content_block_stop\ndata: ${JSON.stringify({ type: "content_block_stop", index: 0 })}\n\n`,
        `event: message_delta\ndata: ${JSON.stringify({ type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 5 } })}\n\n`,
        `event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}\n\n`
      ].join("");
      return new Response(sse, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" }
      });
    };

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;
        const headers = new Headers(
          init?.headers ??
            (input instanceof Request ? input.headers : undefined)
        );
        capturedRequests.push({
          url,
          authorization: headers.get("authorization"),
          xApiKey: headers.get("x-api-key"),
          beta: headers.get("anthropic-beta"),
          xApp: headers.get("x-app")
        });
        return createAnthropicSse("ok");
      })
    );

    const runOnce = async (config: AgentProviderRuntimeConfig) => {
      const { model, streamFn } = buildProviderRuntime(config);
      for await (const event of await streamFn(model, {
        messages: [{ role: "user", content: "hi", timestamp: 1 }]
      })) {
        if (event.type === "error") {
          throw new Error(event.error.errorMessage);
        }
      }
      return model;
    };

    // 1. Standard Claude OAuth token (sk-ant-oat...)
    const oauthModel = await runOnce(
      createRuntimeConfig({
        id: "sub:anthropic-claude:claude-sonnet-4-6",
        label: "Claude Sonnet 4.6",
        provider: "anthropic-claude",
        modelId: "claude-sonnet-4-6",
        api: "anthropic-messages",
        apiKey: "sk-ant-oat01-placeholder-token",
        baseUrl: "https://anthropic.example.test",
        subscriptionAuth: {
          provider: "anthropic-claude",
          accountId: "claude_acct_1",
          expiresAt: "2099-01-01T00:00:00.000Z"
        }
      })
    );
    expect(oauthModel.api).toBe("anthropic-messages");

    // 2. Non-prefixed OAuth Bearer token for Claude subscription
    await runOnce(
      createRuntimeConfig({
        id: "sub:anthropic-claude:claude-sonnet-4-6",
        label: "Claude Sonnet 4.6",
        provider: "anthropic-claude",
        modelId: "claude-sonnet-4-6",
        api: "anthropic-messages",
        apiKey: "generic-bearer-placeholder",
        baseUrl: "https://anthropic.example.test",
        subscriptionAuth: {
          provider: "anthropic-claude",
          accountId: "claude_acct_2",
          expiresAt: "2099-01-01T00:00:00.000Z"
        }
      })
    );

    // 3. Custom Anthropic API Key model (must keep x-api-key untouched)
    await runOnce({
      id: "custom-anthropic",
      label: "Custom Claude",
      provider: "anthropic",
      modelId: "claude-sonnet-4-6",
      api: "anthropic-messages",
      apiKey: "sk-ant-api03-custom-placeholder",
      baseUrl: "https://anthropic.example.test",
      reasoning: false,
      defaultThinkingLevel: "off",
      thinkingLevelOptions: ["low", "medium", "high"],
      temperatureOptions: [0.1, 0.7, 1]
    });

    expect(capturedRequests).toHaveLength(3);
    expect(capturedRequests[0]).toMatchObject({
      authorization: "Bearer sk-ant-oat01-placeholder-token",
      xApiKey: null,
      xApp: "cli"
    });
    expect(capturedRequests[0]!.beta).toContain("oauth-2025-04-20");

    expect(capturedRequests[1]).toMatchObject({
      authorization: "Bearer generic-bearer-placeholder",
      xApiKey: null,
      xApp: "cli"
    });
    expect(capturedRequests[1]!.beta).toContain("oauth-2025-04-20");

    expect(capturedRequests[2]).toMatchObject({
      authorization: null,
      xApiKey: "sk-ant-api03-custom-placeholder"
    });
    expect(capturedRequests[2]!.beta ?? "").not.toContain("oauth-2025-04-20");
    expect(KIRO_CODEWHISPERER_DEFAULT_BASE_URL).toContain(
      "q.us-east-1.amazonaws.com"
    );
  });
});

describe("Phase 3A protocols: Cursor Connect & Windsurf Connect", () => {
  it("decodes Cursor Connect+JSON (including gzipped and split frames), Connect+Proto, degradation errors, and triggers failover on resource_exhausted", async () => {
    const encoder = new TextEncoder();
    const frame1 = encodeConnectEnvelope(
      new Uint8Array(
        gzipSync(
          encoder.encode(
            JSON.stringify({
              thinking: { text: "构思桥段", signature: "sig-cur-1" }
            })
          )
        )
      ),
      CONNECT_FLAG_COMPRESSED
    );
    const frame2 = encodeConnectEnvelope(
      encoder.encode(
        JSON.stringify({
          text: "第一章正文。",
          clientSideToolV2Call: {
            toolCallId: "cur_tc_1",
            name: "read_outline",
            rawArgs: '{"chapter":1}'
          },
          tokenUsage: { inputTokens: 80, outputTokens: 20, totalTokens: 100 }
        })
      ),
      0
    );
    const endFrame = encodeConnectEnvelope(
      encoder.encode("{}"),
      CONNECT_FLAG_END_STREAM
    );
    const combined = concatUint8Arrays(
      concatUint8Arrays(frame1, frame2),
      endFrame
    );

    const model = createPiModel({
      id: "claude-4.5-sonnet",
      api: "cursor-connect" as Api,
      provider: "cursor",
      baseUrl: "https://cursor.example.test"
    });
    const req = buildCursorConnectRequest(
      model,
      {
        systemPrompt: "小说编辑",
        messages: [{ role: "user", content: "写开头", timestamp: 1 }]
      },
      { reasoning: "medium", sessionId: "cur-sess-1" }
    );
    expect(req.conversationId).toBe("cur-sess-1");

    const api = cursorConnectApi(async () => {
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(combined.slice(0, 17));
            controller.enqueue(combined.slice(17, 63));
            controller.enqueue(combined.slice(63));
            controller.close();
          }
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/connect+json" }
        }
      );
    });

    const events: AssistantMessageEvent[] = [];
    for await (const event of api.streamSimple(
      model,
      normalizeContext({
        messages: [{ role: "user", content: "写开头", timestamp: 1 }]
      }),
      { apiKey: "cursor-token-placeholder" }
    )) {
      events.push(event);
    }
    const done = events.find((e) => e.type === "done");
    expect(done?.type).toBe("done");
    if (done?.type === "done") {
      expect(done.reason).toBe("toolUse");
      expect(done.message.usage.totalTokens).toBe(100);
      expect(done.message.content).toEqual([
        {
          type: "thinking",
          thinking: "构思桥段",
          thinkingSignature: "sig-cur-1"
        },
        { type: "text", text: "第一章正文。" },
        {
          type: "toolCall",
          id: "cur_tc_1",
          name: "read_outline",
          arguments: { chapter: 1 }
        }
      ]);
    }

    // Connect+Proto binary payload decoding
    const protoPayload = concatUint8Arrays(
      encodeProtoStringField(1, "Proto 正文"),
      encodeProtoBytesField(
        25,
        concatUint8Arrays(
          encodeProtoStringField(1, "Proto 思考"),
          encodeProtoStringField(2, "sig-proto")
        )
      )
    );
    const protoFrame = encodeConnectEnvelope(protoPayload, 0);
    const protoApi = cursorConnectApi(
      async () =>
        new Response(Buffer.from(protoFrame), {
          status: 200,
          headers: { "Content-Type": "application/connect+proto" }
        })
    );
    const protoEvents: AssistantMessageEvent[] = [];
    for await (const event of protoApi.streamSimple(
      model,
      normalizeContext({
        messages: [{ role: "user", content: "hi", timestamp: 1 }]
      }),
      { apiKey: "cursor-token-placeholder" }
    )) {
      protoEvents.push(event);
    }
    const protoDone = protoEvents.find((e) => e.type === "done");
    expect(protoDone?.type).toBe("done");
    if (protoDone?.type === "done") {
      expect(protoDone.message.content).toEqual([
        {
          type: "thinking",
          thinking: "Proto 思考",
          thinkingSignature: "sig-proto"
        },
        { type: "text", text: "Proto 正文" }
      ]);
    }

    // Protocol change degradation hint (HTTP 404 / unimplemented)
    const degradedApi = cursorConnectApi(
      async () => new Response("not found", { status: 404 })
    );
    const degradedEvents: AssistantMessageEvent[] = [];
    for await (const event of degradedApi.streamSimple(
      model,
      normalizeContext({
        messages: [{ role: "user", content: "hi", timestamp: 1 }]
      }),
      { apiKey: "cursor-token-placeholder" }
    )) {
      degradedEvents.push(event);
    }
    const degradedErr = degradedEvents.find((e) => e.type === "error");
    expect(degradedErr?.type).toBe("error");
    if (degradedErr?.type === "error") {
      expect(degradedErr.error.errorMessage).toContain("非官方社区适配协议");
    }

    // EndStream resource_exhausted triggers automatic failover
    const seenAuth: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        const auth = new Headers(init?.headers).get("Authorization") ?? "";
        seenAuth.push(auth);
        if (auth === "Bearer cur-exhausted") {
          const errEnd = encodeConnectEnvelope(
            encoder.encode(
              JSON.stringify({
                error: {
                  code: "resource_exhausted",
                  message: "Fast requests exhausted"
                }
              })
            ),
            CONNECT_FLAG_END_STREAM
          );
          return new Response(Buffer.from(errEnd), {
            status: 200,
            headers: { "Content-Type": "application/connect+json" }
          });
        }
        const okFrame = encodeConnectEnvelope(
          encoder.encode(JSON.stringify({ text: "Cursor 备用账号成功" })),
          0
        );
        return new Response(Buffer.from(okFrame), {
          status: 200,
          headers: { "Content-Type": "application/connect+json" }
        });
      })
    );

    const bridge: SubscriptionCredentialBridge = {
      acquireCredential: vi.fn(),
      reportAndFailover: vi.fn(async () => ({
        provider: "cursor" as const,
        accountId: "cur_acct_2",
        apiKey: "cur-healthy",
        baseUrl: "https://cursor.example.test"
      }))
    };

    const runtime = buildProviderRuntime(
      createRuntimeConfig({
        id: "sub:cursor:claude-4.5-sonnet",
        label: "Claude 4.5 Sonnet (Cursor)",
        provider: "cursor",
        modelId: "claude-4.5-sonnet",
        api: "cursor-connect",
        apiKey: "cur-exhausted",
        baseUrl: "",
        subscriptionAuth: {
          provider: "cursor",
          accountId: "cur_acct_1",
          metadata: { endpoint: "https://cursor.example.test" }
        }
      }),
      undefined,
      "medium",
      { subscriptionCredentialBridge: bridge }
    );
    const failoverEvents: AssistantMessageEvent[] = [];
    for await (const event of await runtime.streamFn(runtime.model, {
      messages: [{ role: "user", content: "测试", timestamp: 1 }]
    })) {
      failoverEvents.push(event);
    }
    expect(seenAuth).toEqual(["Bearer cur-exhausted", "Bearer cur-healthy"]);
    expect(bridge.reportAndFailover).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "cursor",
        failedAccountId: "cur_acct_1",
        reason: "quota_exhausted"
      })
    );
    expect(CURSOR_CONNECT_DEFAULT_BASE_URL).toContain("cursor");
  });

  it("decodes Windsurf Connect+JSON, Connect+Proto, degradation errors, and triggers failover on credit exhaustion", async () => {
    const encoder = new TextEncoder();
    const model = createPiModel({
      id: "swe-1.5",
      api: "windsurf-connect" as Api,
      provider: "windsurf",
      baseUrl: "https://windsurf.example.test"
    });
    const req = buildWindsurfConnectRequest(
      model,
      {
        systemPrompt: "故事助手",
        messages: [{ role: "user", content: "继续", timestamp: 1 }]
      },
      "ws-key-placeholder",
      { reasoning: "high", sessionId: "ws-sess-1" }
    );
    expect(req.chatModelName).toBe("swe-1.5");

    // Connect+Proto decoding (field 1 deltaMessage -> 1 text, 2 thinking, 3 toolCall)
    const toolMsg = concatUint8Arrays(
      concatUint8Arrays(
        encodeProtoStringField(1, "ws_call_1"),
        encodeProtoStringField(2, "list_notes")
      ),
      encodeProtoStringField(3, '{"tag":"plot"}')
    );
    const deltaMsg = concatUint8Arrays(
      concatUint8Arrays(
        encodeProtoStringField(1, "Windsurf 正文"),
        encodeProtoStringField(2, "Windsurf 思考")
      ),
      encodeProtoBytesField(3, toolMsg)
    );
    const protoFrame = encodeConnectEnvelope(
      encodeProtoBytesField(1, deltaMsg),
      0
    );
    const wsApi = windsurfConnectApi(
      async () =>
        new Response(Buffer.from(protoFrame), {
          status: 200,
          headers: { "Content-Type": "application/connect+proto" }
        })
    );
    const wsEvents: AssistantMessageEvent[] = [];
    for await (const event of wsApi.streamSimple(
      model,
      normalizeContext({
        messages: [{ role: "user", content: "继续", timestamp: 1 }]
      }),
      { apiKey: "ws-key-placeholder" }
    )) {
      wsEvents.push(event);
    }
    const wsDone = wsEvents.find((e) => e.type === "done");
    expect(wsDone?.type).toBe("done");
    if (wsDone?.type === "done") {
      expect(wsDone.reason).toBe("toolUse");
      expect(wsDone.message.content).toEqual([
        { type: "thinking", thinking: "Windsurf 思考" },
        { type: "text", text: "Windsurf 正文" },
        {
          type: "toolCall",
          id: "ws_call_1",
          name: "list_notes",
          arguments: { tag: "plot" }
        }
      ]);
    }

    // Failover on Windsurf out of prompt credits
    const seenAuth: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        const auth = new Headers(init?.headers).get("Authorization") ?? "";
        seenAuth.push(auth);
        if (auth === "Bearer ws-depleted") {
          return new Response(
            JSON.stringify({
              code: "resource_exhausted",
              message: "Out of prompt credits"
            }),
            { status: 429 }
          );
        }
        const okFrame = encodeConnectEnvelope(
          encoder.encode(
            JSON.stringify({
              deltaMessage: { text: "Windsurf 备用账号成功" },
              usage: { inputTokens: 30, outputTokens: 15, totalTokens: 45 }
            })
          ),
          0
        );
        return new Response(Buffer.from(okFrame), {
          status: 200,
          headers: { "Content-Type": "application/connect+json" }
        });
      })
    );

    const bridge: SubscriptionCredentialBridge = {
      acquireCredential: vi.fn(),
      reportAndFailover: vi.fn(async () => ({
        provider: "windsurf" as const,
        accountId: "ws_acct_2",
        apiKey: "ws-healthy",
        baseUrl: "https://windsurf.example.test"
      }))
    };

    const runtime = buildProviderRuntime(
      createRuntimeConfig({
        id: "sub:windsurf:swe-1.5",
        label: "SWE-1.5 (Windsurf)",
        provider: "windsurf",
        modelId: "swe-1.5",
        api: "windsurf-connect",
        apiKey: "ws-depleted",
        baseUrl: "",
        subscriptionAuth: {
          provider: "windsurf",
          accountId: "ws_acct_1",
          metadata: { endpoint: "https://windsurf.example.test" }
        }
      }),
      undefined,
      "medium",
      { subscriptionCredentialBridge: bridge }
    );
    const failoverEvents: AssistantMessageEvent[] = [];
    for await (const event of await runtime.streamFn(runtime.model, {
      messages: [{ role: "user", content: "测试", timestamp: 1 }]
    })) {
      failoverEvents.push(event);
    }
    expect(seenAuth).toEqual(["Bearer ws-depleted", "Bearer ws-healthy"]);
    expect(bridge.reportAndFailover).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "windsurf",
        failedAccountId: "ws_acct_1",
        reason: "quota_exhausted"
      })
    );
    const failoverDone = failoverEvents.find((e) => e.type === "done");
    expect(failoverDone?.type).toBe("done");
    if (failoverDone?.type === "done") {
      expect(failoverDone.message.usage.totalTokens).toBe(45);
    }
    expect(WINDSURF_CONNECT_DEFAULT_BASE_URL).toContain("codeium");
  });
});

describe("Phase 3B protocol: CodeBuddy Chat", () => {
  it("streams reasoning, text, incremental tool calls, usage, and fails over cleanly on 429", async () => {
    const model = createPiModel({
      id: "deepseek-r1",
      api: "codebuddy-chat" as Api,
      provider: "codebuddy",
      baseUrl: "https://codebuddy.example.test"
    });
    const req = buildCodeBuddyChatRequest(
      model,
      {
        systemPrompt: "长篇总编",
        messages: [{ role: "user", content: "检查本章", timestamp: 1 }]
      },
      { reasoning: "high" }
    );
    expect(req.model).toBe("deepseek-r1");
    expect(req.reasoning_effort).toBe("high");

    const api = codeBuddyChatApi(async () =>
      createSseResponse([
        { choices: [{ delta: { reasoning_content: "梳理伏笔" } }] },
        { choices: [{ delta: { content: "建议调整节奏。" } }] },
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: "cb_call_1",
                    function: { name: "read_chapter", arguments: '{"num":' }
                  }
                ]
              }
            }
          ]
        },
        {
          choices: [
            {
              delta: {
                tool_calls: [{ index: 0, function: { arguments: "3}" } }]
              },
              finish_reason: "tool_calls"
            }
          ],
          usage: {
            prompt_tokens: 90,
            completion_tokens: 30,
            prompt_tokens_details: { cached_tokens: 15 },
            total_tokens: 120
          }
        }
      ])
    );

    const events: AssistantMessageEvent[] = [];
    for await (const event of api.streamSimple(
      model,
      normalizeContext({
        messages: [{ role: "user", content: "检查本章", timestamp: 1 }]
      }),
      { apiKey: "cb-access-placeholder" }
    )) {
      events.push(event);
    }
    const done = events.find((e) => e.type === "done");
    expect(done?.type).toBe("done");
    if (done?.type === "done") {
      expect(done.reason).toBe("toolUse");
      expect(done.message.usage).toMatchObject({
        input: 90,
        output: 30,
        cacheRead: 15,
        totalTokens: 120
      });
      expect(done.message.content).toEqual([
        { type: "thinking", thinking: "梳理伏笔" },
        { type: "text", text: "建议调整节奏。" },
        {
          type: "toolCall",
          id: "cb_call_1",
          name: "read_chapter",
          arguments: { num: 3 }
        }
      ]);
    }

    const seenAuth: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        const auth = new Headers(init?.headers).get("Authorization") ?? "";
        seenAuth.push(auth);
        if (auth === "Bearer cb-limited") {
          return new Response(
            JSON.stringify({ message: "Too many requests" }),
            { status: 429, headers: { "Retry-After": "60" } }
          );
        }
        return createSseResponse([
          {
            choices: [
              {
                delta: { content: "CodeBuddy 切号成功" },
                finish_reason: "stop"
              }
            ]
          }
        ]);
      })
    );

    const bridge: SubscriptionCredentialBridge = {
      acquireCredential: vi.fn(),
      reportAndFailover: vi.fn(async () => ({
        provider: "codebuddy" as const,
        accountId: "cb_acct_2",
        apiKey: "cb-healthy",
        baseUrl: "https://codebuddy.example.test"
      }))
    };

    const runtime = buildProviderRuntime(
      createRuntimeConfig({
        id: "sub:codebuddy:deepseek-r1",
        label: "DeepSeek R1 (CodeBuddy)",
        provider: "codebuddy",
        modelId: "deepseek-r1",
        api: "codebuddy-chat",
        apiKey: "cb-limited",
        baseUrl: "",
        subscriptionAuth: {
          provider: "codebuddy",
          accountId: "cb_acct_1",
          metadata: { endpoint: "https://codebuddy.example.test" }
        }
      }),
      undefined,
      "medium",
      { subscriptionCredentialBridge: bridge }
    );

    const failoverEvents: AssistantMessageEvent[] = [];
    for await (const event of await runtime.streamFn(runtime.model, {
      messages: [{ role: "user", content: "测试", timestamp: 1 }]
    })) {
      failoverEvents.push(event);
    }
    expect(seenAuth).toEqual(["Bearer cb-limited", "Bearer cb-healthy"]);
    expect(bridge.reportAndFailover).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "codebuddy",
        failedAccountId: "cb_acct_1",
        reason: "rate_limited",
        retryAfterSec: 60
      })
    );
    expect(CODEBUDDY_CHAT_DEFAULT_BASE_URL).toContain("www.codebuddy.ai");
  });
});

describe("Audit regression: normalized context, Google thinking/maxTokens, and failover isolation", () => {
  it("preserves systemPrompt and tools across all 5 custom subscription streams when context is pre-normalized", () => {
    const rawContext: Context = {
      systemPrompt: "你是专业小说审校助手。",
      tools: [
        {
          name: "read_chapter",
          description: "读取章节内容",
          parameters: Type.Object({ chapterId: Type.String() })
        }
      ],
      messages: [{ role: "user", content: "检查第一章", timestamp: 1 }]
    };
    const preNormalized = normalizeContext(rawContext);
    expect("systemPrompt" in preNormalized).toBe(false);
    expect("tools" in preNormalized).toBe(false);

    const googleEnv = buildGoogleSubscriptionRequestEnvelope(
      createPiModel({
        id: "gemini-2.5-pro",
        api: "google-cloud-code-assist" as Api,
        provider: "google-gemini-cli"
      }),
      preNormalized,
      { reasoning: "xhigh", maxTokens: 8 },
      "cloud-code-assist",
      "proj_norm_1"
    ) as {
      request: {
        systemInstruction?: { parts: Array<{ text: string }> };
        tools?: unknown[];
        generationConfig?: {
          maxOutputTokens?: number;
          thinkingConfig?: { thinkingBudget?: number };
        };
      };
    };
    expect(googleEnv.request.systemInstruction?.parts[0]?.text).toBe(
      "你是专业小说审校助手。"
    );
    expect(googleEnv.request.tools?.length).toBeGreaterThan(0);
    // Regression: xhigh clamped cleanly without throwing, and maxOutputTokens > thinkingBudget.
    const budget =
      googleEnv.request.generationConfig?.thinkingConfig?.thinkingBudget ?? 0;
    const maxOut = googleEnv.request.generationConfig?.maxOutputTokens ?? 0;
    expect(budget).toBeGreaterThan(0);
    expect(maxOut).toBeGreaterThan(budget);

    const kiroReq = buildKiroCodeWhispererRequest(
      createPiModel({
        id: "claude-sonnet-4.5",
        api: "kiro-codewhisperer" as Api,
        provider: "kiro"
      }),
      preNormalized,
      undefined,
      "arn:aws:codewhisperer:us-east-1:123:profile/test"
    ) as {
      conversationState: {
        currentMessage: {
          userInputMessage: {
            content: string;
            userInputMessageContext?: { tools?: unknown[] };
          };
        };
      };
    };
    expect(
      kiroReq.conversationState.currentMessage.userInputMessage.content
    ).toContain("你是专业小说审校助手。");
    expect(
      kiroReq.conversationState.currentMessage.userInputMessage
        .userInputMessageContext?.tools?.length
    ).toBe(1);

    const cursorReq = buildCursorConnectRequest(
      createPiModel({
        id: "claude-4.5-sonnet",
        api: "cursor-connect" as Api,
        provider: "cursor"
      }),
      preNormalized
    ) as {
      conversation: Array<{ type: string; text?: string }>;
      tools?: unknown[];
    };
    expect(cursorReq.conversation[0]).toMatchObject({
      type: "MESSAGE_TYPE_SYSTEM",
      text: "你是专业小说审校助手。"
    });
    expect(cursorReq.tools?.length).toBe(1);

    const windsurfReq = buildWindsurfConnectRequest(
      createPiModel({
        id: "swe-1.5",
        api: "windsurf-connect" as Api,
        provider: "windsurf"
      }),
      preNormalized,
      "ws-key"
    ) as {
      chatMessages: Array<{
        source: string;
        intent?: { generic?: { text?: string } };
      }>;
      tools?: unknown[];
    };
    expect(windsurfReq.chatMessages[0]).toMatchObject({
      source: "CHAT_MESSAGE_SOURCE_SYSTEM",
      intent: { generic: { text: "你是专业小说审校助手。" } }
    });
    expect(windsurfReq.tools?.length).toBe(1);

    const codeBuddyReq = buildCodeBuddyChatRequest(
      createPiModel({
        id: "deepseek-r1",
        api: "codebuddy-chat" as Api,
        provider: "codebuddy"
      }),
      preNormalized
    ) as {
      messages: Array<{ role: string; content?: string }>;
      tools?: unknown[];
    };
    expect(codeBuddyReq.messages[0]).toMatchObject({
      role: "system",
      content: "你是专业小说审校助手。"
    });
    expect(codeBuddyReq.tools?.length).toBe(1);
  });

  it("does not leak failed account headers, metadata, or baseUrl onto failover account", async () => {
    const seen: Array<{
      baseUrl: string;
      headers: Record<string, string | null | undefined>;
      apiKey: string | undefined;
    }> = [];
    const innerStreamFn = vi.fn(
      (model: Model<Api>, _ctx: Context, opts?: SimpleStreamOptions) => {
        seen.push({
          baseUrl: model.baseUrl,
          headers: {
            ...(model.headers ?? {}),
            ...(opts?.headers ?? {})
          },
          apiKey: opts?.apiKey
        });
        const s = createAssistantMessageEventStream();
        queueMicrotask(() => {
          if (seen.length === 1) {
            s.push({
              type: "error",
              reason: "error",
              error: createBaseAssistantMessage(model, {
                stopReason: "error",
                errorMessage: "[HTTP 429] Too Many Requests"
              })
            });
          } else {
            const msg = createBaseAssistantMessage(model, {
              content: [{ type: "text", text: "ok" }]
            });
            s.push({ type: "start", partial: msg });
            s.push({ type: "done", reason: "stop", message: msg });
          }
          s.end();
        });
        return s;
      }
    );

    const bridge: SubscriptionCredentialBridge = {
      acquireCredential: vi.fn(),
      reportAndFailover: vi.fn(async () => ({
        provider: "kiro" as const,
        accountId: "acct_b",
        apiKey: "tok_b"
        // Intentionally omits baseUrl, extraHeaders, and metadata.profileArn
      }))
    };

    const wrapped = withSubscriptionFailover({
      config: createRuntimeConfig({
        id: "sub:kiro:claude-sonnet-4.5",
        provider: "kiro",
        modelId: "claude-sonnet-4.5",
        api: "kiro-codewhisperer",
        apiKey: "tok_a",
        baseUrl: "https://default.kiro.example.test",
        subscriptionAuth: {
          provider: "kiro",
          accountId: "acct_a",
          extraHeaders: { "x-account-only": "from-a" },
          metadata: {
            profileArn: "arn:aws:codewhisperer:us-east-1:1:profile/A"
          }
        }
      }),
      bridge,
      streamFn: innerStreamFn
    });

    const baseModel = createPiModel({
      id: "claude-sonnet-4.5",
      api: "kiro-codewhisperer" as Api,
      provider: "kiro",
      baseUrl: "https://account-a.kiro.example.test",
      headers: { "x-account-only": "from-a" }
    });
    const events: AssistantMessageEvent[] = [];
    for await (const ev of await wrapped(baseModel, {
      messages: [{ role: "user", content: "hi", timestamp: 1 }]
    })) {
      events.push(ev);
    }

    expect(seen).toHaveLength(2);
    expect(seen[0]!.headers["x-account-only"]).toBe("from-a");
    expect(seen[0]!.headers["x-writer-subscription-profile-arn"]).toBe(
      "arn:aws:codewhisperer:us-east-1:1:profile/A"
    );
    // Account B must not inherit Account A's extraHeaders, profileArn, or custom baseUrl
    expect(seen[1]!.apiKey).toBe("tok_b");
    expect(seen[1]!.baseUrl).toBe("https://default.kiro.example.test");
    expect(seen[1]!.headers["x-account-only"]).toBeUndefined();
    expect(
      seen[1]!.headers["x-writer-subscription-profile-arn"]
    ).toBeUndefined();
  });
});
