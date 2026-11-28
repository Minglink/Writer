import { randomUUID } from "node:crypto";
import {
  clampThinkingLevel,
  createAssistantMessageEventStream,
  getCurrentSystemPrompt,
  getCurrentTools,
  normalizeContext,
  type Api,
  type AssistantMessage,
  type Context,
  type Model,
  type SimpleStreamOptions,
  type TextContent,
  type ThinkingContent,
  type ToolCall
} from "@earendil-works/pi-ai";
import {
  adjustMaxTokensForThinking,
  clampReasoning
} from "@earendil-works/pi-ai/api/simple-options";
import {
  convertMessages,
  convertTools,
  getDisabledGoogleThinkingConfig,
  isThinkingPart,
  mapStopReasonString,
  resolveGoogleFunctionCallingMode,
  resolveGoogleThinkingLevel,
  retainThoughtSignature,
  supportsGoogleStrictToolSampling,
  toGoogleThinkingLevel,
  usesGoogleThinkingLevel
} from "@earendil-works/pi-ai/api/google-shared";

export type GoogleSubscriptionMode = "cloud-code-assist" | "antigravity";

export type GoogleSubscriptionFetcher = (
  input: string,
  init?: RequestInit
) => Promise<Response>;

const PROJECT_ID_INTERNAL_HEADER = "x-writer-subscription-project-id";

interface GoogleWirePart {
  text?: string;
  thought?: boolean;
  thoughtSignature?: string;
  functionCall?: {
    id?: string;
    name?: string;
    args?: Record<string, unknown>;
  };
}

interface GoogleWireResponse {
  response?: GoogleWireResponse;
  candidates?: Array<{
    content?: {
      parts?: GoogleWirePart[];
    };
    finishReason?: string;
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    thoughtsTokenCount?: number;
    cachedContentTokenCount?: number;
    totalTokenCount?: number;
  };
  error?: {
    code?: number;
    status?: string;
    message?: string;
  };
}

function resolveEndpointUrl(baseUrl: string, defaultBaseUrl: string): string {
  const root = (baseUrl || defaultBaseUrl).replace(/\/+$/u, "");
  if (root.includes(":streamGenerateContent")) {
    return root.includes("alt=sse")
      ? root
      : `${root}${root.includes("?") ? "&" : "?"}alt=sse`;
  }
  return `${root}/v1internal:streamGenerateContent?alt=sse`;
}

function buildThinkingConfig(
  model: Model<"google-generative-ai">,
  options: SimpleStreamOptions | undefined
):
  | {
      thinkingConfig: Record<string, unknown>;
      adjustedMaxOutputTokens?: number;
    }
  | undefined {
  const reasoning = options?.reasoning;
  if (!model.reasoning) return undefined;
  if (!reasoning) return undefined;
  if ((reasoning as string) === "off") {
    return {
      thinkingConfig: getDisabledGoogleThinkingConfig(model) as Record<
        string,
        unknown
      >
    };
  }
  const clamped = clampThinkingLevel(model, reasoning);
  if (clamped === "off") {
    return {
      thinkingConfig: getDisabledGoogleThinkingConfig(model) as Record<
        string,
        unknown
      >
    };
  }
  const safeLevel = clampReasoning(clamped) ?? "high";
  const resolved = resolveGoogleThinkingLevel(model, safeLevel);
  if (usesGoogleThinkingLevel(model)) {
    return {
      thinkingConfig: {
        includeThoughts: true,
        thinkingLevel: toGoogleThinkingLevel(resolved)
      }
    };
  }
  const { maxTokens, thinkingBudget } = adjustMaxTokensForThinking(
    options?.maxTokens,
    model.maxTokens,
    resolved,
    options?.thinkingBudgets
  );
  return {
    thinkingConfig: {
      includeThoughts: true,
      thinkingBudget
    },
    ...(options?.maxTokens !== undefined
      ? { adjustedMaxOutputTokens: maxTokens }
      : {})
  };
}

export function buildGoogleSubscriptionRequestEnvelope(
  model: Model<Api>,
  context: Context,
  options: SimpleStreamOptions | undefined,
  mode: GoogleSubscriptionMode,
  projectId: string
): Record<string, unknown> {
  const googleModel = {
    ...model,
    api: "google-generative-ai" as const
  } as Model<"google-generative-ai">;
  const normalized = normalizeContext(context);
  const systemPrompt = getCurrentSystemPrompt(normalized.messages).trim();
  const currentTools = getCurrentTools(normalized.messages);
  const contents = convertMessages(googleModel, normalized);
  const isClaudeOnAntigravity =
    mode === "antigravity" && /^claude/iu.test(model.id);
  const supportsStrict =
    !isClaudeOnAntigravity && supportsGoogleStrictToolSampling(model.id);
  const convertedTools =
    currentTools.length > 0
      ? convertTools(currentTools, isClaudeOnAntigravity, supportsStrict)
      : undefined;
  const functionCallingMode =
    currentTools.length > 0
      ? resolveGoogleFunctionCallingMode(
          currentTools,
          undefined,
          supportsStrict
        )
      : undefined;

  const generationConfig: Record<string, unknown> = {};
  if (options?.temperature !== undefined) {
    generationConfig.temperature = options.temperature;
  }
  if (options?.maxTokens !== undefined) {
    generationConfig.maxOutputTokens = options.maxTokens;
  }
  const thinking = buildThinkingConfig(googleModel, options);
  if (thinking) {
    generationConfig.thinkingConfig = thinking.thinkingConfig;
    if (thinking.adjustedMaxOutputTokens !== undefined) {
      generationConfig.maxOutputTokens = thinking.adjustedMaxOutputTokens;
    }
  }

  const innerRequest: Record<string, unknown> = {
    contents,
    ...(Object.keys(generationConfig).length > 0 ? { generationConfig } : {})
  };
  if (systemPrompt) {
    innerRequest.systemInstruction = {
      parts: [{ text: systemPrompt }]
    };
  }
  if (convertedTools && convertedTools.length > 0) {
    innerRequest.tools = convertedTools;
    if (functionCallingMode) {
      innerRequest.toolConfig = {
        functionCallingConfig: { mode: functionCallingMode }
      };
    }
  }

  const trimmedProject = projectId.trim();
  if (mode === "antigravity") {
    return {
      ...(trimmedProject ? { project: trimmedProject } : {}),
      model: model.id,
      userAgent: "antigravity",
      requestType: "agent",
      requestId: `ag_req_${randomUUID()}`,
      request: innerRequest
    };
  }
  return {
    ...(trimmedProject ? { project: trimmedProject } : {}),
    model: model.id,
    request: innerRequest
  };
}

function buildErrorMessage(
  status: number,
  bodyText: string,
  retryAfterHeader: string | null
): string {
  let detail: string;
  try {
    const parsed = JSON.parse(bodyText) as {
      error?: { message?: string; status?: string };
    };
    detail = parsed.error?.message || parsed.error?.status || "";
  } catch {
    detail = bodyText.trim().slice(0, 240);
  }
  const retryHint = retryAfterHeader
    ? ` (Retry-After: ${retryAfterHeader})`
    : "";
  return `[HTTP ${status}]${retryHint} ${detail || "Google 订阅接口请求失败。"}`.trim();
}

export interface StreamGoogleSubscriptionParams {
  model: Model<Api>;
  context: Context;
  options?: SimpleStreamOptions;
  mode: GoogleSubscriptionMode;
  defaultBaseUrl: string;
  defaultHeaders: Record<string, string>;
  fetcher?: GoogleSubscriptionFetcher;
}

export function streamGoogleSubscription({
  model,
  context,
  options,
  mode,
  defaultBaseUrl,
  defaultHeaders,
  fetcher = fetch
}: StreamGoogleSubscriptionParams) {
  const stream = createAssistantMessageEventStream();

  void (async () => {
    const output: AssistantMessage = {
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
      timestamp: Date.now()
    };

    try {
      const apiKey = options?.apiKey?.trim();
      if (!apiKey) {
        throw new Error("[HTTP 401] 缺少有效订阅访问令牌。");
      }

      const combinedHeaders: Record<string, string> = {};
      for (const source of [defaultHeaders, model.headers, options?.headers]) {
        if (!source) continue;
        for (const [key, value] of Object.entries(source)) {
          if (typeof value === "string") {
            combinedHeaders[key] = value;
          }
        }
      }
      const projectId =
        combinedHeaders[PROJECT_ID_INTERNAL_HEADER]?.trim() ?? "";
      delete combinedHeaders[PROJECT_ID_INTERNAL_HEADER];

      let payload: unknown = buildGoogleSubscriptionRequestEnvelope(
        model,
        context,
        options,
        mode,
        projectId
      );
      if (options?.onPayload) {
        const replacement = await options.onPayload(payload, model);
        if (replacement !== undefined) {
          payload = replacement;
        }
      }

      const url = resolveEndpointUrl(model.baseUrl, defaultBaseUrl);
      const response = await fetcher(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
          Authorization: `Bearer ${apiKey}`,
          ...combinedHeaders
        },
        body: JSON.stringify(payload),
        ...(options?.signal ? { signal: options.signal } : {})
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        throw new Error(
          buildErrorMessage(
            response.status,
            errorText,
            response.headers.get("retry-after")
          )
        );
      }
      if (!response.body) {
        throw new Error("Google 订阅接口未返回响应流。");
      }

      stream.push({ type: "start", partial: output });

      let activeBlock:
        | { kind: "text"; index: number; block: TextContent }
        | { kind: "thinking"; index: number; block: ThinkingContent }
        | undefined;
      let sawToolCall = false;
      let toolCallSequence = 0;

      const closeActiveBlock = () => {
        if (!activeBlock) return;
        if (activeBlock.kind === "text") {
          stream.push({
            type: "text_end",
            contentIndex: activeBlock.index,
            content: activeBlock.block.text,
            partial: output
          });
        } else {
          stream.push({
            type: "thinking_end",
            contentIndex: activeBlock.index,
            content: activeBlock.block.thinking,
            partial: output
          });
        }
        activeBlock = undefined;
      };

      const processChunk = (wire: GoogleWireResponse) => {
        const data = wire.response ?? wire;
        if (data.error) {
          throw new Error(
            `[HTTP ${data.error.code ?? 500}] ${data.error.message || data.error.status || "上游流错误"}`
          );
        }

        if (data.usageMetadata) {
          const input =
            data.usageMetadata.promptTokenCount ?? output.usage.input;
          const cacheRead =
            data.usageMetadata.cachedContentTokenCount ??
            output.usage.cacheRead;
          const out =
            (data.usageMetadata.candidatesTokenCount ?? 0) +
            (data.usageMetadata.thoughtsTokenCount ?? 0);
          output.usage.input = input;
          output.usage.cacheRead = cacheRead;
          if (out > 0) output.usage.output = out;
          output.usage.totalTokens =
            data.usageMetadata.totalTokenCount ?? input + output.usage.output;
        }

        const candidate = data.candidates?.[0];
        const parts = candidate?.content?.parts ?? [];
        for (const part of parts) {
          if (isThinkingPart(part) && typeof part.text === "string") {
            if (activeBlock && activeBlock.kind !== "thinking") {
              closeActiveBlock();
            }
            let thinkingState =
              activeBlock?.kind === "thinking" ? activeBlock : undefined;
            if (!thinkingState) {
              const block: ThinkingContent = {
                type: "thinking",
                thinking: "",
                ...(part.thoughtSignature
                  ? { thinkingSignature: part.thoughtSignature }
                  : {})
              };
              const index = output.content.push(block) - 1;
              thinkingState = { kind: "thinking", index, block };
              activeBlock = thinkingState;
              stream.push({
                type: "thinking_start",
                contentIndex: index,
                partial: output
              });
            }
            const nextSig = retainThoughtSignature(
              thinkingState.block.thinkingSignature,
              part.thoughtSignature
            );
            if (nextSig) {
              thinkingState.block.thinkingSignature = nextSig;
            }
            if (part.text.length > 0) {
              thinkingState.block.thinking += part.text;
              stream.push({
                type: "thinking_delta",
                contentIndex: thinkingState.index,
                delta: part.text,
                partial: output
              });
            }
            continue;
          }

          if (typeof part.text === "string") {
            if (activeBlock && activeBlock.kind !== "text") {
              closeActiveBlock();
            }
            let textState =
              activeBlock?.kind === "text" ? activeBlock : undefined;
            if (!textState) {
              const block: TextContent = {
                type: "text",
                text: "",
                ...(part.thoughtSignature
                  ? { textSignature: part.thoughtSignature }
                  : {})
              };
              const index = output.content.push(block) - 1;
              textState = { kind: "text", index, block };
              activeBlock = textState;
              stream.push({
                type: "text_start",
                contentIndex: index,
                partial: output
              });
            }
            const nextSig = retainThoughtSignature(
              textState.block.textSignature,
              part.thoughtSignature
            );
            if (nextSig) {
              textState.block.textSignature = nextSig;
            }
            if (part.text.length > 0) {
              textState.block.text += part.text;
              stream.push({
                type: "text_delta",
                contentIndex: textState.index,
                delta: part.text,
                partial: output
              });
            }
            continue;
          }

          if (part.functionCall && part.functionCall.name) {
            closeActiveBlock();
            sawToolCall = true;
            toolCallSequence += 1;
            const args = (part.functionCall.args ??
              {}) as ToolCall["arguments"];
            const toolCall: ToolCall = {
              type: "toolCall",
              id:
                part.functionCall.id ||
                `${part.functionCall.name}_${toolCallSequence}`,
              name: part.functionCall.name,
              arguments: args,
              ...(part.thoughtSignature
                ? { thoughtSignature: part.thoughtSignature }
                : {})
            };
            const index = output.content.push(toolCall) - 1;
            stream.push({
              type: "toolcall_start",
              contentIndex: index,
              partial: output
            });
            stream.push({
              type: "toolcall_delta",
              contentIndex: index,
              delta: JSON.stringify(args),
              partial: output
            });
            stream.push({
              type: "toolcall_end",
              contentIndex: index,
              toolCall,
              partial: output
            });
          }
        }

        if (candidate?.finishReason) {
          output.stopReason = sawToolCall
            ? "toolUse"
            : mapStopReasonString(candidate.finishReason);
        }
      };

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      const drainFrames = (flushAll: boolean) => {
        const normalized = buffer.replace(/\r\n/gu, "\n");
        const parts = normalized.split("\n\n");
        buffer = flushAll ? "" : (parts.pop() ?? "");
        const frames = flushAll ? parts : parts;
        for (const frame of frames) {
          const dataLines = frame
            .split("\n")
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trim())
            .filter((line) => line.length > 0 && line !== "[DONE]");
          if (dataLines.length === 0) continue;
          const parsed = JSON.parse(dataLines.join("\n")) as GoogleWireResponse;
          processChunk(parsed);
        }
      };

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          drainFrames(false);
        }
        buffer += decoder.decode();
        drainFrames(true);
      } finally {
        reader.releaseLock();
      }

      closeActiveBlock();
      if (sawToolCall && output.stopReason === "stop") {
        output.stopReason = "toolUse";
      }
      stream.push({
        type: "done",
        reason: output.stopReason as "stop" | "length" | "toolUse",
        message: output
      });
      stream.end();
    } catch (error: unknown) {
      const aborted = options?.signal?.aborted === true;
      output.stopReason = aborted ? "aborted" : "error";
      output.errorMessage = aborted
        ? "模型请求已中止。"
        : error instanceof Error
          ? error.message
          : String(error);
      stream.push({
        type: "error",
        reason: aborted ? "aborted" : "error",
        error: output
      });
      stream.end();
    }
  })();

  return stream;
}
