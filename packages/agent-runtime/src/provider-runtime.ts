import type {
  StreamFn,
  ThinkingLevel as PiThinkingLevel
} from "@earendil-works/pi-agent-core";
import {
  createAssistantMessageEventStream,
  normalizeContext,
  type Api,
  type AssistantMessage,
  type AssistantMessageEvent,
  type Context,
  type Model,
  type ProviderStreams,
  type SimpleStreamOptions,
  type ThinkingLevelMap
} from "@earendil-works/pi-ai";
import { anthropicMessagesApi } from "@earendil-works/pi-ai/api/anthropic-messages.lazy";
import {
  buildCopilotDynamicHeaders,
  hasCopilotVisionInput
} from "@earendil-works/pi-ai/api/github-copilot-headers";
import { googleGenerativeAIApi } from "@earendil-works/pi-ai/api/google-generative-ai.lazy";
import { openAICodexResponsesApi } from "@earendil-works/pi-ai/api/openai-codex-responses.lazy";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { openAIResponsesApi } from "@earendil-works/pi-ai/api/openai-responses.lazy";
import {
  DEFAULT_CUSTOM_MODEL_CONTEXT_WINDOW,
  DEFAULT_CUSTOM_MODEL_MAX_TOKENS,
  isUnsupportedDeveloperRoleError,
  type AgentProviderRuntimeConfig,
  type ThinkingLevel as ConfiguredThinkingLevel
} from "@writer/contracts";
import {
  CODEBUDDY_CHAT_DEFAULT_BASE_URL,
  CURSOR_CONNECT_DEFAULT_BASE_URL,
  GOOGLE_ANTIGRAVITY_DEFAULT_BASE_URL,
  GOOGLE_CLOUD_CODE_ASSIST_DEFAULT_BASE_URL,
  KIRO_CODEWHISPERER_DEFAULT_BASE_URL,
  KIRO_PROFILE_ARN_INTERNAL_HEADER,
  WINDSURF_CONNECT_DEFAULT_BASE_URL,
  codeBuddyChatApi,
  cursorConnectApi,
  googleAntigravityApi,
  googleCloudCodeAssistApi,
  kiroCodeWhispererApi,
  windsurfConnectApi,
  withSubscriptionFailover
} from "./subscriptions";
import {
  applyProviderToolSchemaCompatibility,
  isOllamaProviderName,
  type ProviderRuntimeCompatibilityOptions
} from "./portable-tool-schema";
import { findProviderModel } from "./provider-model-catalog";
import { enforceProviderToolSchemaCompatibility } from "./provider-tool-schema-compat";
import { applyGoogleClaudeThinkingCompatibility } from "./google-claude-thinking";
import { applyGeminiWritingSafetySettings } from "./gemini-safety";
import { createOpenCodeRequestHeaders } from "./opencode-request-headers";
import { createSiteSessionHeaders } from "./site-session-headers";
import {
  isGeminiOpenAIConfig,
  withGeminiOpenAIToolSignatures
} from "./gemini-openai";
import { resolveOpenAICompletionsCompat } from "./provider-completions-compat";

type ProviderStreamFn = (
  model: Model<Api>,
  context: Context,
  options?: SimpleStreamOptions
) => ReturnType<StreamFn>;

const OPENAI_CODEX_DEFAULT_BASE_URL = "https://chatgpt.com/backend-api";
const GITHUB_COPILOT_DEFAULT_BASE_URL =
  "https://api.individual.githubcopilot.com";
const ANTHROPIC_CLAUDE_SUBSCRIPTION_BASE_URL = "https://api.anthropic.com";
const ANTHROPIC_CLAUDE_OAUTH_IDENTITY_HEADERS: Record<string, string> = {
  "anthropic-dangerous-direct-browser-access": "true",
  "User-Agent": "claude-cli/2.1.280",
  "x-app": "cli"
};
const ANTHROPIC_CLAUDE_FALLBACK_BEARER_BETA =
  "claude-code-20250219,oauth-2025-04-20,fine-grained-tool-streaming-2025-05-14,interleaved-thinking-2025-05-14";
const GITHUB_COPILOT_STATIC_HEADERS: Record<string, string> = {
  "User-Agent": "GitHubCopilotChat/0.35.0",
  "Editor-Version": "vscode/1.107.0",
  "Editor-Plugin-Version": "copilot-chat/0.35.0",
  "Copilot-Integration-Id": "vscode-chat"
};

type ResolvedWireApi = Exclude<
  AgentProviderRuntimeConfig["api"],
  "github-copilot"
>;

function resolveCopilotWireApi(
  modelId: string,
  builtin: Model<Api> | undefined
): "anthropic-messages" | "openai-responses" | "openai-completions" {
  const builtinApi = builtin?.api;
  if (builtinApi === "anthropic-messages") {
    return "anthropic-messages";
  }
  if (builtinApi === "openai-responses") {
    return "openai-responses";
  }
  if (builtinApi === "openai-completions") {
    return "openai-completions";
  }
  if (/^claude/iu.test(modelId)) {
    return "anthropic-messages";
  }
  if (/^(?:gpt-5|gpt-6|o[134]|codex|grok-4|mai-code)/iu.test(modelId)) {
    return "openai-responses";
  }
  return "openai-completions";
}

function defaultBaseUrlForSubscriptionApi(
  config: AgentProviderRuntimeConfig
): string {
  switch (config.api) {
    case "openai-codex-responses":
      return OPENAI_CODEX_DEFAULT_BASE_URL;
    case "github-copilot":
      return GITHUB_COPILOT_DEFAULT_BASE_URL;
    case "anthropic-messages":
      return config.subscriptionAuth?.provider === "anthropic-claude"
        ? ANTHROPIC_CLAUDE_SUBSCRIPTION_BASE_URL
        : "";
    case "google-cloud-code-assist":
      return GOOGLE_CLOUD_CODE_ASSIST_DEFAULT_BASE_URL;
    case "google-antigravity":
      return (
        config.subscriptionAuth?.metadata?.endpoint ||
        GOOGLE_ANTIGRAVITY_DEFAULT_BASE_URL
      );
    case "kiro-codewhisperer":
      return (
        config.subscriptionAuth?.metadata?.endpoint ||
        KIRO_CODEWHISPERER_DEFAULT_BASE_URL
      );
    case "cursor-connect":
      return (
        config.subscriptionAuth?.metadata?.endpoint ||
        CURSOR_CONNECT_DEFAULT_BASE_URL
      );
    case "windsurf-connect":
      return (
        config.subscriptionAuth?.metadata?.endpoint ||
        WINDSURF_CONNECT_DEFAULT_BASE_URL
      );
    case "codebuddy-chat":
      return (
        config.subscriptionAuth?.metadata?.endpoint ||
        CODEBUDDY_CHAT_DEFAULT_BASE_URL
      );
    default:
      return "";
  }
}

function providerStreams(api: ResolvedWireApi): ProviderStreams {
  if (api === "openai-completions") {
    return openAICompletionsApi();
  }
  if (api === "openai-responses") {
    return openAIResponsesApi();
  }
  if (api === "openai-codex-responses") {
    return openAICodexResponsesApi();
  }
  if (api === "anthropic-messages") {
    return anthropicMessagesApi();
  }
  if (api === "google-cloud-code-assist") {
    return googleCloudCodeAssistApi();
  }
  if (api === "google-antigravity") {
    return googleAntigravityApi();
  }
  if (api === "kiro-codewhisperer") {
    return kiroCodeWhispererApi();
  }
  if (api === "cursor-connect") {
    return cursorConnectApi();
  }
  if (api === "windsurf-connect") {
    return windsurfConnectApi();
  }
  if (api === "codebuddy-chat") {
    return codeBuddyChatApi();
  }
  return googleGenerativeAIApi();
}

export function toPiThinkingLevel(
  level: ConfiguredThinkingLevel
): PiThinkingLevel {
  if (
    level === "off" ||
    level === "minimal" ||
    level === "low" ||
    level === "medium" ||
    level === "high" ||
    level === "xhigh"
  ) {
    return level;
  }
  // Pi exposes five reasoning carriers. The model-level map below rewrites the
  // xhigh carrier to max or to the user's provider-specific custom value.
  return "xhigh";
}

export function buildWorkspaceProviderRuntimes(
  config: AgentProviderRuntimeConfig,
  temperature?: number,
  configuredThinkingLevel?: ConfiguredThinkingLevel,
  compatibility: ProviderRuntimeCompatibilityOptions = {}
): {
  model: Model<Api>;
  streamFn: ProviderStreamFn;
  spawnStreamFn: ProviderStreamFn;
} {
  const runtime = buildProviderRuntime(
    config,
    temperature,
    configuredThinkingLevel,
    compatibility
  );
  return { ...runtime, spawnStreamFn: runtime.streamFn };
}

/** @internal Exported for runtime-configuration regression tests. */
export function buildProviderRuntime(
  config: AgentProviderRuntimeConfig,
  temperature?: number,
  configuredThinkingLevel?: ConfiguredThinkingLevel,
  compatibility: ProviderRuntimeCompatibilityOptions = {}
): {
  model: Model<Api>;
  streamFn: ProviderStreamFn;
} {
  const builtin = findProviderModel(config);
  const requestModelId = config.requestModelId ?? config.modelId;
  const effectiveApi: ResolvedWireApi =
    config.api === "github-copilot"
      ? resolveCopilotWireApi(requestModelId, builtin)
      : config.api;
  const configuredBaseUrl =
    config.baseUrl ||
    (builtin?.api === effectiveApi ? builtin.baseUrl : "") ||
    defaultBaseUrlForSubscriptionApi(config);
  // Anthropic's SDK appends /v1/messages itself; saved gateway URLs often
  // already include /v1, unlike the SDK's expected unversioned base URL.
  const baseUrl =
    effectiveApi === "anthropic-messages"
      ? configuredBaseUrl.replace(/\/v1\/?$/u, "")
      : configuredBaseUrl;
  if (!baseUrl) {
    throw new Error("当前模型不在 Pi 内置目录中，请填写 API 地址后再试。");
  }
  const effectiveTemperature =
    configuredThinkingLevel === "off" &&
    builtin?.reasoning === true &&
    builtin.thinkingLevelMap?.off === null
      ? undefined
      : temperature;

  const thinkingLevelMap: ThinkingLevelMap = {
    ...(builtin?.thinkingLevelMap ?? {})
  };
  const compat =
    effectiveApi === "openai-completions"
      ? resolveOpenAICompletionsCompat(config, builtin)
      : effectiveApi === "openai-responses" &&
          config.supportsDeveloperRole !== undefined
        ? {
            ...(builtin?.api === "openai-responses" ? builtin.compat : {}),
            supportsDeveloperRole: config.supportsDeveloperRole
          }
        : undefined;
  // Pi's Z.AI serializer emits `thinking: disabled` whenever reasoning is
  // absent, even when the catalog marks off as unsupported. GLM-5.3 rejects
  // that payload, so stale/off run settings must degrade to its lowest valid
  // effort instead of attempting to disable mandatory thinking.
  const mandatoryZaiThinkingFallback =
    configuredThinkingLevel === "off" &&
    builtin?.thinkingLevelMap?.off === null &&
    compat?.thinkingFormat === "zai"
      ? "low"
      : undefined;
  if (configuredThinkingLevel && configuredThinkingLevel !== "off") {
    const carrier = toPiThinkingLevel(configuredThinkingLevel);
    if (configuredThinkingLevel !== carrier) {
      thinkingLevelMap[carrier] = configuredThinkingLevel;
    } else if (carrier === "xhigh" && thinkingLevelMap.xhigh === undefined) {
      thinkingLevelMap.xhigh = "xhigh";
    }
  }
  const hasFailoverBridge = Boolean(
    config.subscriptionAuth && compatibility.subscriptionCredentialBridge
  );
  const subscriptionMetadataHeaders: Record<string, string> = {};
  if (!hasFailoverBridge) {
    if (config.subscriptionAuth?.metadata?.projectId) {
      subscriptionMetadataHeaders["x-writer-subscription-project-id"] =
        config.subscriptionAuth.metadata.projectId;
    }
    if (config.subscriptionAuth?.metadata?.profileArn) {
      subscriptionMetadataHeaders[KIRO_PROFILE_ARN_INTERNAL_HEADER] =
        config.subscriptionAuth.metadata.profileArn;
    }
  }
  const hasSubscriptionMetadataHeaders =
    Object.keys(subscriptionMetadataHeaders).length > 0;
  const initialSubscriptionExtraHeaders = hasFailoverBridge
    ? undefined
    : config.subscriptionAuth?.extraHeaders;
  const isAnthropicClaudeSubscription =
    effectiveApi === "anthropic-messages" &&
    config.subscriptionAuth?.provider === "anthropic-claude";
  const staticModelHeaders = {
    ...(config.api === "github-copilot" ? GITHUB_COPILOT_STATIC_HEADERS : {}),
    ...(isAnthropicClaudeSubscription
      ? ANTHROPIC_CLAUDE_OAUTH_IDENTITY_HEADERS
      : {}),
    ...(builtin?.headers ?? {}),
    ...(initialSubscriptionExtraHeaders ?? {}),
    ...subscriptionMetadataHeaders
  };
  const model = {
    ...(builtin?.api === effectiveApi ? builtin : {}),
    id: requestModelId,
    name: config.label,
    api: effectiveApi,
    provider: config.provider,
    baseUrl,
    // `reasoning` describes a model capability to pi-ai; it is not the
    // per-request switch. Keep that capability enabled while a run selects
    // "off" so pi-ai can serialize the provider-specific disable control
    // (`thinking: disabled`, `enable_thinking: false`, thinkingBudget: 0,
    // etc.). For catalog models, retain the catalog's known capability.
    // Unknown/custom models are treated as capable: compatible providers can
    // honor the control, while providers without a control simply omit it.
    reasoning: builtin?.reasoning ?? true,
    // A custom endpoint has no Pi catalog metadata. Keep image blocks enabled
    // and let that endpoint return an explicit capability error if its selected
    // model is text-only; silently dropping a user image is never acceptable.
    input: builtin?.input ?? ["text", "image"],
    cost: builtin?.cost ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    // Unknown routes inherit the GPT-5.6 Sol capacity baseline so a missing
    // catalog entry does not unnecessarily constrain long-form writing runs.
    // A saved custom-model override always wins over catalog and baseline.
    contextWindow:
      config.contextWindow ??
      builtin?.contextWindow ??
      DEFAULT_CUSTOM_MODEL_CONTEXT_WINDOW,
    maxTokens:
      config.maxTokens ?? builtin?.maxTokens ?? DEFAULT_CUSTOM_MODEL_MAX_TOKENS,
    ...(Object.keys(staticModelHeaders).length > 0
      ? { headers: staticModelHeaders }
      : {}),
    ...(Object.keys(thinkingLevelMap).length > 0 ? { thinkingLevelMap } : {}),
    ...(compat ? { compat } : {})
  } as Model<Api>;
  const streams = providerStreams(effectiveApi);
  const openCodeRequestHeaders = createOpenCodeRequestHeaders({
    provider: config.provider,
    baseUrl
  });
  const siteSessionHeaders = createSiteSessionHeaders(config);
  const isOllamaProvider = isOllamaProviderName(config.provider);
  const streamFn = (
    requestModel: Model<Api>,
    context: Context,
    options?: SimpleStreamOptions
  ) => {
    const openCodeHeaders = openCodeRequestHeaders(options?.sessionId);
    const sessionHeaders = siteSessionHeaders(options?.sessionId);
    const copilotDynamicHeaders =
      config.api === "github-copilot"
        ? buildCopilotDynamicHeaders({
            messages: context.messages,
            hasImages: hasCopilotVisionInput(context.messages)
          })
        : undefined;
    const resolvedToken =
      config.subscriptionAuth && options?.apiKey
        ? options.apiKey
        : config.apiKey;
    const useAnthropicSubscriptionBearer =
      isAnthropicClaudeSubscription &&
      Boolean(resolvedToken) &&
      !resolvedToken.includes("sk-ant-oat");
    const claudeBearerHeaders = useAnthropicSubscriptionBearer
      ? {
          ...ANTHROPIC_CLAUDE_OAUTH_IDENTITY_HEADERS,
          "anthropic-beta": ANTHROPIC_CLAUDE_FALLBACK_BEARER_BETA,
          Authorization: `Bearer ${resolvedToken}`
        }
      : undefined;
    const requestHeaders =
      openCodeHeaders ||
      sessionHeaders ||
      copilotDynamicHeaders ||
      claudeBearerHeaders ||
      initialSubscriptionExtraHeaders ||
      hasSubscriptionMetadataHeaders
        ? {
            ...openCodeHeaders,
            ...sessionHeaders,
            ...copilotDynamicHeaders,
            ...claudeBearerHeaders,
            ...(initialSubscriptionExtraHeaders ?? {}),
            ...subscriptionMetadataHeaders
          }
        : undefined;
    const baseCallOptions = applyGeminiWritingSafetySettings(
      config,
      options ?? {}
    );
    if (useAnthropicSubscriptionBearer) {
      delete baseCallOptions.apiKey;
    }
    return streams.streamSimple(
      requestModel,
      normalizeContext(
        applyProviderToolSchemaCompatibility(
          enforceProviderToolSchemaCompatibility(context),
          config.provider,
          config.toolSchemaProfile,
          compatibility.portableToolSchemaProfile
        )
      ),
      applyGoogleClaudeThinkingCompatibility(effectiveApi, requestModel.id, {
        ...baseCallOptions,
        ...(requestHeaders
          ? { headers: { ...requestHeaders, ...options?.headers } }
          : {}),
        ...(mandatoryZaiThinkingFallback
          ? { reasoning: mandatoryZaiThinkingFallback }
          : {}),
        ...(effectiveTemperature !== undefined
          ? { temperature: effectiveTemperature }
          : {}),
        ...(useAnthropicSubscriptionBearer
          ? {}
          : resolvedToken
            ? { apiKey: resolvedToken }
            : isOllamaProvider
              ? { apiKey: "ollama" }
              : {})
      })
    );
  };
  const baseStreamFn = isGeminiOpenAIConfig(config)
    ? withGeminiOpenAIToolSignatures(streamFn)
    : streamFn;
  const developerFallbackStreamFn = withDeveloperRoleFallback(
    config,
    model,
    baseStreamFn,
    compatibility.onDeveloperRoleFallback
  );
  const finalStreamFn =
    config.subscriptionAuth && compatibility.subscriptionCredentialBridge
      ? withSubscriptionFailover({
          config,
          bridge: compatibility.subscriptionCredentialBridge,
          streamFn: developerFallbackStreamFn
        })
      : developerFallbackStreamFn;
  return {
    model,
    streamFn: finalStreamFn
  };
}

function isAssistantOutputEvent(event: AssistantMessageEvent): boolean {
  return (
    event.type === "text_start" ||
    event.type === "text_delta" ||
    event.type === "text_end" ||
    event.type === "thinking_start" ||
    event.type === "thinking_delta" ||
    event.type === "thinking_end" ||
    event.type === "toolcall_start" ||
    event.type === "toolcall_delta" ||
    event.type === "toolcall_end" ||
    event.type === "done"
  );
}

function createDeveloperRoleFallbackErrorMessage(
  model: Model<Api>,
  error: unknown,
  aborted: boolean
): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text: "" }],
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
    stopReason: aborted ? "aborted" : "error",
    errorMessage: aborted
      ? "模型请求已中止。"
      : error instanceof Error
        ? error.message
        : String(error),
    timestamp: Date.now()
  };
}

type DeveloperRoleAwareModel = Model<"openai-completions" | "openai-responses">;

function disableDeveloperRoleCompat(
  target: Model<Api>
): DeveloperRoleAwareModel["compat"] {
  const compatible = target as DeveloperRoleAwareModel;
  const nextCompat = {
    ...(compatible.compat ?? {}),
    supportsDeveloperRole: false
  };
  compatible.compat = nextCompat;
  return nextCompat;
}

function withDeveloperRoleFallback(
  config: AgentProviderRuntimeConfig,
  model: Model<Api>,
  sourceStreamFn: ProviderStreamFn,
  onFallback?: () => void
): ProviderStreamFn {
  if (
    (config.api !== "openai-completions" &&
      config.api !== "openai-responses") ||
    config.supportsDeveloperRole === true ||
    (model as DeveloperRoleAwareModel).compat?.supportsDeveloperRole === false
  ) {
    return sourceStreamFn;
  }

  return (requestModel, context, options) => {
    if (
      (requestModel as DeveloperRoleAwareModel).compat
        ?.supportsDeveloperRole === false
    ) {
      return sourceStreamFn(requestModel, context, options);
    }

    const initialSource = sourceStreamFn(requestModel, context, options);
    const forwarded = createAssistantMessageEventStream();
    void (async () => {
      let sawStart = false;
      let emittedOutput = false;
      let terminalSeen = false;

      const forwardStream = async (
        sourcePromise: ReturnType<ProviderStreamFn>,
        targetModel: Model<Api>,
        allowFallback: boolean
      ): Promise<boolean> => {
        try {
          const source = await sourcePromise;
          for await (const event of source) {
            if (event.type === "start") {
              if (sawStart) continue;
              sawStart = true;
              forwarded.push(event);
              continue;
            }
            if (
              allowFallback &&
              !emittedOutput &&
              !options?.signal?.aborted &&
              event.type === "error" &&
              isUnsupportedDeveloperRoleError(event.error)
            ) {
              return true;
            }
            if (isAssistantOutputEvent(event)) {
              emittedOutput = true;
            }
            if (event.type === "done" || event.type === "error") {
              terminalSeen = true;
            }
            forwarded.push(event);
          }
          return false;
        } catch (error: unknown) {
          if (
            allowFallback &&
            !emittedOutput &&
            !options?.signal?.aborted &&
            isUnsupportedDeveloperRoleError(error)
          ) {
            return true;
          }
          const aborted = options?.signal?.aborted === true;
          terminalSeen = true;
          forwarded.push({
            type: "error",
            reason: aborted ? "aborted" : "error",
            error: createDeveloperRoleFallbackErrorMessage(
              targetModel,
              error,
              aborted
            )
          });
          return false;
        }
      };

      const shouldFallback = await forwardStream(
        initialSource,
        requestModel,
        true
      );
      if (shouldFallback) {
        const modelCompat = disableDeveloperRoleCompat(model);
        const nextCompat =
          requestModel === model
            ? modelCompat
            : disableDeveloperRoleCompat(requestModel);
        onFallback?.();
        const fallbackModel = {
          ...(requestModel as DeveloperRoleAwareModel),
          compat: nextCompat
        } as Model<Api>;
        await forwardStream(
          sourceStreamFn(fallbackModel, context, options),
          fallbackModel,
          false
        );
      }

      if (!terminalSeen) {
        const aborted = options?.signal?.aborted === true;
        forwarded.push({
          type: "error",
          reason: aborted ? "aborted" : "error",
          error: createDeveloperRoleFallbackErrorMessage(
            requestModel,
            "Model stream ended without a terminal event.",
            aborted
          )
        });
      }
    })();
    return forwarded;
  };
}

export function resolveProviderModelCapacity(
  config: AgentProviderRuntimeConfig
): { contextWindow: number; maxTokens: number } {
  const { model } = buildProviderRuntime(
    config,
    undefined,
    config.defaultThinkingLevel
  );
  return {
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens
  };
}
