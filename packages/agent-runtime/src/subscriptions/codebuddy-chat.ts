import { randomUUID } from "node:crypto";
import {
  createAssistantMessageEventStream,
  getCurrentSystemPrompt,
  getCurrentTools,
  normalizeContext,
  type Api,
  type AssistantMessage,
  type Context,
  type Model,
  type ProviderStreams,
  type SimpleStreamOptions,
  type TextContent,
  type ThinkingContent,
  type ToolCall
} from "@earendil-works/pi-ai";

export const CODEBUDDY_CHAT_DEFAULT_BASE_URL = "https://www.codebuddy.ai";
const CODEBUDDY_CHAT_PATH = "/v2/chat/completions";
const CODEBUDDY_DEFAULT_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
  "x-codebuddy-client": "ide"
};

export type CodeBuddyChatFetcher = (
  input: string,
  init?: RequestInit
) => Promise<Response>;

interface ToolAccumulator {
  index: number;
  toolCall: ToolCall;
  rawArgs: string;
  closed: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function resolveCodeBuddyEndpoint(baseUrl: string): string {
  const root = (baseUrl || CODEBUDDY_CHAT_DEFAULT_BASE_URL).replace(
    /\/+$/u,
    ""
  );
  if (root.endsWith("/chat/completions")) {
    return root;
  }
  return `${root}${CODEBUDDY_CHAT_PATH}`;
}

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter(
      (item): item is { type: "text"; text: string } =>
        isRecord(item) && item.type === "text" && typeof item.text === "string"
    )
    .map((item) => item.text)
    .join("\n");
}

export function buildCodeBuddyChatRequest(
  model: Model<Api>,
  context: Context,
  options?: SimpleStreamOptions
): Record<string, unknown> {
  const normalized = normalizeContext(context);
  const systemPrompt = getCurrentSystemPrompt(normalized.messages).trim();
  const currentTools = getCurrentTools(normalized.messages);
  const messages: Array<Record<string, unknown>> = [];

  if (systemPrompt) {
    messages.push({
      role: "system",
      content: systemPrompt
    });
  }

  for (const message of normalized.messages) {
    if (message.role === "user") {
      messages.push({
        role: "user",
        content: extractText(message.content)
      });
    } else if (message.role === "assistant") {
      const texts: string[] = [];
      const toolCalls: Array<Record<string, unknown>> = [];
      for (const block of message.content) {
        if (block.type === "text" && block.text) {
          texts.push(block.text);
        } else if (block.type === "toolCall") {
          toolCalls.push({
            id: block.id,
            type: "function",
            function: {
              name: block.name,
              arguments: JSON.stringify(block.arguments ?? {})
            }
          });
        }
      }
      messages.push({
        role: "assistant",
        content: texts.join("\n") || null,
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {})
      });
    } else if (message.role === "toolResult") {
      messages.push({
        role: "tool",
        tool_call_id: message.toolCallId,
        name: message.toolName,
        content: extractText(message.content)
      });
    }
  }

  const tools = currentTools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description || tool.name,
      parameters: tool.parameters ?? { type: "object", properties: {} }
    }
  }));

  return {
    model: model.id,
    messages,
    stream: true,
    stream_options: { include_usage: true },
    ...(tools.length > 0 ? { tools } : {}),
    ...(model.reasoning && options?.reasoning
      ? { reasoning_effort: options.reasoning }
      : {}),
    ...(options?.temperature !== undefined
      ? { temperature: options.temperature }
      : {}),
    ...(options?.maxTokens !== undefined
      ? { max_tokens: options.maxTokens }
      : {})
  };
}

function buildHttpError(
  status: number,
  bodyText: string,
  retryAfterHeader: string | null
): Error {
  let detail: string;
  try {
    const parsed = JSON.parse(bodyText) as {
      error?: { message?: string; code?: string } | string;
      message?: string;
    };
    if (typeof parsed.message === "string") detail = parsed.message;
    else if (typeof parsed.error === "string") detail = parsed.error;
    else if (parsed.error && typeof parsed.error.message === "string") {
      detail = parsed.error.message;
    } else {
      detail = "";
    }
  } catch {
    detail = bodyText.trim().slice(0, 240);
  }
  const retryHint = retryAfterHeader
    ? ` (Retry-After: ${retryAfterHeader})`
    : "";
  return new Error(
    `[HTTP ${status}]${retryHint} ${detail || "CodeBuddy 接口请求失败。"}`.trim()
  );
}

function parseToolArgs(raw: string): ToolCall["arguments"] {
  if (!raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return isRecord(parsed) ? (parsed as ToolCall["arguments"]) : {};
  } catch {
    return {};
  }
}

export interface StreamCodeBuddyChatParams {
  model: Model<Api>;
  context: Context;
  options?: SimpleStreamOptions;
  fetcher?: CodeBuddyChatFetcher;
}

export function streamCodeBuddyChat({
  model,
  context,
  options,
  fetcher = fetch
}: StreamCodeBuddyChatParams) {
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
        throw new Error("[HTTP 401] 缺少有效 CodeBuddy 订阅访问令牌。");
      }

      const combinedHeaders: Record<string, string> = {};
      for (const source of [
        CODEBUDDY_DEFAULT_HEADERS,
        model.headers,
        options?.headers
      ]) {
        if (!source) continue;
        for (const [key, value] of Object.entries(source)) {
          if (typeof value === "string") {
            combinedHeaders[key] = value;
          }
        }
      }
      delete combinedHeaders["x-writer-subscription-project-id"];
      delete combinedHeaders["x-writer-subscription-profile-arn"];

      let payload: unknown = buildCodeBuddyChatRequest(model, context, options);
      if (options?.onPayload) {
        const replacement = await options.onPayload(payload, model);
        if (replacement !== undefined) {
          payload = replacement;
        }
      }

      const url = resolveCodeBuddyEndpoint(model.baseUrl);
      const response = await fetcher(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream, application/json",
          Authorization: `Bearer ${apiKey}`,
          "x-request-id": randomUUID(),
          ...combinedHeaders
        },
        body: JSON.stringify(payload),
        ...(options?.signal ? { signal: options.signal } : {})
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        throw buildHttpError(
          response.status,
          errorText,
          response.headers.get("retry-after")
        );
      }
      if (!response.body) {
        throw new Error("CodeBuddy 未返回响应流。");
      }

      stream.push({ type: "start", partial: output });

      let activeBlock:
        | { kind: "text"; index: number; block: TextContent }
        | { kind: "thinking"; index: number; block: ThinkingContent }
        | undefined;
      const openTools = new Map<number, ToolAccumulator>();
      let sawToolCall = false;

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

      const emitText = (delta: string) => {
        if (!delta) return;
        if (activeBlock && activeBlock.kind !== "text") closeActiveBlock();
        let state = activeBlock?.kind === "text" ? activeBlock : undefined;
        if (!state) {
          const block: TextContent = { type: "text", text: "" };
          const index = output.content.push(block) - 1;
          state = { kind: "text", index, block };
          activeBlock = state;
          stream.push({
            type: "text_start",
            contentIndex: index,
            partial: output
          });
        }
        state.block.text += delta;
        stream.push({
          type: "text_delta",
          contentIndex: state.index,
          delta,
          partial: output
        });
      };

      const emitThinking = (delta: string) => {
        if (!delta) return;
        if (activeBlock && activeBlock.kind !== "thinking") closeActiveBlock();
        let state = activeBlock?.kind === "thinking" ? activeBlock : undefined;
        if (!state) {
          const block: ThinkingContent = { type: "thinking", thinking: "" };
          const index = output.content.push(block) - 1;
          state = { kind: "thinking", index, block };
          activeBlock = state;
          stream.push({
            type: "thinking_start",
            contentIndex: index,
            partial: output
          });
        }
        state.block.thinking += delta;
        stream.push({
          type: "thinking_delta",
          contentIndex: state.index,
          delta,
          partial: output
        });
      };

      const finalizeTools = () => {
        for (const acc of openTools.values()) {
          if (acc.closed) continue;
          acc.closed = true;
          if (acc.rawArgs) {
            acc.toolCall.arguments = parseToolArgs(acc.rawArgs);
          }
          stream.push({
            type: "toolcall_end",
            contentIndex: acc.index,
            toolCall: acc.toolCall,
            partial: output
          });
        }
      };

      const processChunk = (chunk: Record<string, unknown>) => {
        if (isRecord(chunk.error)) {
          const code =
            typeof chunk.error.status === "number"
              ? chunk.error.status
              : typeof chunk.error.code === "number"
                ? chunk.error.code
                : 500;
          const msg =
            typeof chunk.error.message === "string"
              ? chunk.error.message
              : "CodeBuddy 上游流返回错误。";
          throw new Error(`[HTTP ${code}] ${msg}`);
        }

        if (isRecord(chunk.usage)) {
          const u = chunk.usage;
          if (typeof u.prompt_tokens === "number") {
            output.usage.input = u.prompt_tokens;
          }
          if (typeof u.completion_tokens === "number") {
            output.usage.output = u.completion_tokens;
          }
          if (
            isRecord(u.prompt_tokens_details) &&
            typeof u.prompt_tokens_details.cached_tokens === "number"
          ) {
            output.usage.cacheRead = u.prompt_tokens_details.cached_tokens;
          }
          output.usage.totalTokens =
            typeof u.total_tokens === "number"
              ? u.total_tokens
              : output.usage.input + output.usage.output;
        }

        const choices = Array.isArray(chunk.choices) ? chunk.choices : [];
        const choice = isRecord(choices[0]) ? choices[0] : undefined;
        if (!choice) return;

        const delta = isRecord(choice.delta)
          ? choice.delta
          : isRecord(choice.message)
            ? choice.message
            : undefined;
        if (delta) {
          const reasoning =
            typeof delta.reasoning_content === "string"
              ? delta.reasoning_content
              : typeof delta.thinking === "string"
                ? delta.thinking
                : "";
          if (reasoning) emitThinking(reasoning);

          if (typeof delta.content === "string" && delta.content.length > 0) {
            emitText(delta.content);
          }

          if (Array.isArray(delta.tool_calls)) {
            closeActiveBlock();
            sawToolCall = true;
            for (let i = 0; i < delta.tool_calls.length; i += 1) {
              const rawTc = delta.tool_calls[i];
              if (!isRecord(rawTc)) continue;
              const slot = typeof rawTc.index === "number" ? rawTc.index : i;
              const fn = isRecord(rawTc.function) ? rawTc.function : undefined;
              let acc = openTools.get(slot);
              if (!acc) {
                const toolCall: ToolCall = {
                  type: "toolCall",
                  id:
                    typeof rawTc.id === "string" && rawTc.id
                      ? rawTc.id
                      : `codebuddy_tool_${slot + 1}`,
                  name:
                    typeof fn?.name === "string" && fn.name ? fn.name : "tool",
                  arguments: {}
                };
                const index = output.content.push(toolCall) - 1;
                acc = { index, toolCall, rawArgs: "", closed: false };
                openTools.set(slot, acc);
                stream.push({
                  type: "toolcall_start",
                  contentIndex: index,
                  partial: output
                });
              } else {
                if (typeof rawTc.id === "string" && rawTc.id) {
                  acc.toolCall.id = rawTc.id;
                }
                if (typeof fn?.name === "string" && fn.name) {
                  acc.toolCall.name = fn.name;
                }
              }
              if (
                typeof fn?.arguments === "string" &&
                fn.arguments.length > 0
              ) {
                acc.rawArgs += fn.arguments;
                stream.push({
                  type: "toolcall_delta",
                  contentIndex: acc.index,
                  delta: fn.arguments,
                  partial: output
                });
              }
            }
          }
        }

        if (typeof choice.finish_reason === "string" && choice.finish_reason) {
          if (
            choice.finish_reason === "tool_calls" ||
            choice.finish_reason === "function_call" ||
            sawToolCall
          ) {
            output.stopReason = "toolUse";
          } else if (choice.finish_reason === "length") {
            output.stopReason = "length";
          } else {
            output.stopReason = "stop";
          }
        }
      };

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      const drainLines = (flushAll: boolean) => {
        const normalized = buffer.replace(/\r\n/gu, "\n");
        const lines = normalized.split("\n");
        buffer = flushAll ? "" : (lines.pop() ?? "");
        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line) continue;
          const data = line.startsWith("data:") ? line.slice(5).trim() : line;
          if (!data || data === "[DONE]") continue;
          const parsed = JSON.parse(data) as unknown;
          if (isRecord(parsed)) processChunk(parsed);
        }
      };

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          drainLines(false);
        }
        buffer += decoder.decode();
        drainLines(true);
      } finally {
        reader.releaseLock();
      }

      closeActiveBlock();
      finalizeTools();
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

export function codeBuddyChatApi(
  fetcher?: CodeBuddyChatFetcher
): ProviderStreams {
  const invoke: ProviderStreams["streamSimple"] = (model, context, options) =>
    streamCodeBuddyChat({
      model,
      context,
      ...(options ? { options } : {}),
      ...(fetcher ? { fetcher } : {})
    });

  return {
    stream: invoke,
    streamSimple: invoke
  };
}
