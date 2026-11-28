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
import {
  concatUint8Arrays,
  decodeConnectEnvelopes,
  decodeProtoFields,
  encodeConnectEnvelope,
  formatConnectEndStreamError,
  formatConnectHttpError
} from "./connect-envelope";

export const WINDSURF_CONNECT_DEFAULT_BASE_URL = "https://server.codeium.com";
const WINDSURF_CHAT_PATH = "/exa.api_server_pb.ApiServerService/GetChatMessage";
const WINDSURF_DEFAULT_HEADERS: Record<string, string> = {
  "Connect-Protocol-Version": "1",
  "User-Agent": "connect-es/1.6.1 Windsurf/1.9.0"
};

export type WindsurfConnectFetcher = (
  input: string,
  init?: RequestInit
) => Promise<Response>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function resolveWindsurfEndpoint(baseUrl: string): string {
  const root = (baseUrl || WINDSURF_CONNECT_DEFAULT_BASE_URL).replace(
    /\/+$/u,
    ""
  );
  if (root.includes("/exa.")) {
    return root;
  }
  return `${root}${WINDSURF_CHAT_PATH}`;
}

function extractContentText(content: unknown): string {
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

export function buildWindsurfConnectRequest(
  model: Model<Api>,
  context: Context,
  apiKey: string,
  options?: SimpleStreamOptions
): Record<string, unknown> {
  const normalized = normalizeContext(context);
  const systemPrompt = getCurrentSystemPrompt(normalized.messages).trim();
  const currentTools = getCurrentTools(normalized.messages);
  const chatMessages: Array<Record<string, unknown>> = [];

  if (systemPrompt) {
    chatMessages.push({
      source: "CHAT_MESSAGE_SOURCE_SYSTEM",
      intent: { generic: { text: systemPrompt } }
    });
  }

  for (const message of normalized.messages) {
    if (message.role === "user") {
      chatMessages.push({
        source: "CHAT_MESSAGE_SOURCE_USER",
        intent: { generic: { text: extractContentText(message.content) } }
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
            name: block.name,
            argumentsJson: JSON.stringify(block.arguments ?? {})
          });
        }
      }
      chatMessages.push({
        source: "CHAT_MESSAGE_SOURCE_ASSISTANT",
        intent: { generic: { text: texts.join("\n") } },
        ...(toolCalls.length > 0 ? { toolCalls } : {})
      });
    } else if (message.role === "toolResult") {
      chatMessages.push({
        source: "CHAT_MESSAGE_SOURCE_TOOL",
        toolCallId: message.toolCallId,
        toolName: message.toolName,
        intent: { generic: { text: extractContentText(message.content) } },
        isError: message.isError
      });
    }
  }

  const tools = currentTools.map((tool) => ({
    name: tool.name,
    description: tool.description || tool.name,
    jsonSchema: tool.parameters ?? { type: "object", properties: {} }
  }));

  return {
    metadata: {
      ideName: "windsurf",
      ideVersion: "1.9.0",
      extensionName: "windsurf",
      sessionId: options?.sessionId || randomUUID(),
      apiKey
    },
    chatModelName: model.id,
    chatMessages,
    ...(tools.length > 0 ? { tools } : {}),
    ...(model.reasoning && options?.reasoning
      ? { reasoning: { enabled: true, effort: options.reasoning } }
      : {}),
    ...(options?.temperature !== undefined
      ? { temperature: options.temperature }
      : {}),
    ...(options?.maxTokens !== undefined
      ? { maxTokens: options.maxTokens }
      : {})
  };
}

function parseArgsObject(raw: unknown): ToolCall["arguments"] {
  if (isRecord(raw)) return raw as ToolCall["arguments"];
  if (typeof raw === "string" && raw.trim()) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      return isRecord(parsed) ? (parsed as ToolCall["arguments"]) : {};
    } catch {
      return {};
    }
  }
  return {};
}

/**
 * Decodes Windsurf Connect+Proto GetChatMessageResponse payloads:
 * field 1 = deltaMessage (1: text, 2: thinking, 3: toolCall),
 * field 2 = text (string fallback), field 3 = thinking (string fallback).
 */
function decodeWindsurfProtoPayload(
  bytes: Uint8Array
): Record<string, unknown> | undefined {
  const decoder = new TextDecoder();
  const fields = decodeProtoFields(bytes);
  const result: Record<string, unknown> = {};
  for (const field of fields) {
    if (field.wireType !== 2 || !field.bytes) continue;
    if (field.fieldNumber === 1) {
      const nested = decodeProtoFields(field.bytes);
      const delta: Record<string, unknown> = {};
      for (const inner of nested) {
        if (inner.wireType !== 2 || !inner.bytes) continue;
        if (inner.fieldNumber === 1) delta.text = decoder.decode(inner.bytes);
        if (inner.fieldNumber === 2) {
          delta.thinking = decoder.decode(inner.bytes);
        }
        if (inner.fieldNumber === 3) {
          const toolFields = decodeProtoFields(inner.bytes);
          const call: Record<string, string> = {};
          for (const tf of toolFields) {
            if (tf.wireType !== 2 || !tf.bytes) continue;
            if (tf.fieldNumber === 1) call.id = decoder.decode(tf.bytes);
            if (tf.fieldNumber === 2) call.name = decoder.decode(tf.bytes);
            if (tf.fieldNumber === 3) {
              call.argumentsJson = decoder.decode(tf.bytes);
            }
          }
          if (call.name) delta.toolCalls = [call];
        }
      }
      if (Object.keys(delta).length > 0) {
        result.deltaMessage = delta;
      }
    } else if (field.fieldNumber === 2) {
      result.text = decoder.decode(field.bytes);
    } else if (field.fieldNumber === 3) {
      result.thinkingDelta = decoder.decode(field.bytes);
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

export interface StreamWindsurfConnectParams {
  model: Model<Api>;
  context: Context;
  options?: SimpleStreamOptions;
  fetcher?: WindsurfConnectFetcher;
}

export function streamWindsurfConnect({
  model,
  context,
  options,
  fetcher = fetch
}: StreamWindsurfConnectParams) {
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
        throw new Error("[HTTP 401] 缺少有效 Windsurf 订阅访问令牌。");
      }

      const combinedHeaders: Record<string, string> = {};
      for (const source of [
        WINDSURF_DEFAULT_HEADERS,
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

      let payload: unknown = buildWindsurfConnectRequest(
        model,
        context,
        apiKey,
        options
      );
      if (options?.onPayload) {
        const replacement = await options.onPayload(payload, model);
        if (replacement !== undefined) {
          payload = replacement;
        }
      }

      const encodedPayload = encodeConnectEnvelope(
        new TextEncoder().encode(JSON.stringify(payload)),
        0
      );
      const url = resolveWindsurfEndpoint(model.baseUrl);
      const response = await fetcher(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/connect+json",
          Accept:
            "application/connect+json, application/connect+proto, text/event-stream, application/json",
          Authorization: `Bearer ${apiKey}`,
          ...combinedHeaders
        },
        body: Buffer.from(encodedPayload),
        ...(options?.signal ? { signal: options.signal } : {})
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        throw formatConnectHttpError(
          "Windsurf",
          response.status,
          errorText,
          response.headers.get("retry-after")
        );
      }
      if (!response.body) {
        throw new Error("Windsurf 非官方接口未返回响应流，请稍后重试。");
      }

      stream.push({ type: "start", partial: output });

      let activeBlock:
        | { kind: "text"; index: number; block: TextContent }
        | { kind: "thinking"; index: number; block: ThinkingContent }
        | undefined;
      let sawToolCall = false;
      let toolSequence = 0;

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

      const emitThinking = (delta: string, signature?: string) => {
        if (!delta && !signature) return;
        if (activeBlock && activeBlock.kind !== "thinking") closeActiveBlock();
        let state = activeBlock?.kind === "thinking" ? activeBlock : undefined;
        if (!state) {
          const block: ThinkingContent = {
            type: "thinking",
            thinking: "",
            ...(signature ? { thinkingSignature: signature } : {})
          };
          const index = output.content.push(block) - 1;
          state = { kind: "thinking", index, block };
          activeBlock = state;
          stream.push({
            type: "thinking_start",
            contentIndex: index,
            partial: output
          });
        }
        if (signature) state.block.thinkingSignature = signature;
        if (delta) {
          state.block.thinking += delta;
          stream.push({
            type: "thinking_delta",
            contentIndex: state.index,
            delta,
            partial: output
          });
        }
      };

      const emitToolCall = (raw: Record<string, unknown>) => {
        const name = typeof raw.name === "string" ? raw.name : "";
        if (!name) return;
        closeActiveBlock();
        sawToolCall = true;
        toolSequence += 1;
        const args = parseArgsObject(
          raw.argumentsJson ?? raw.arguments ?? raw.input
        );
        const toolCall: ToolCall = {
          type: "toolCall",
          id:
            typeof raw.id === "string" && raw.id
              ? raw.id
              : `windsurf_tool_${toolSequence}`,
          name,
          arguments: args
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
      };

      const processObject = (obj: Record<string, unknown>) => {
        if (isRecord(obj.error)) {
          const err = formatConnectEndStreamError(
            "Windsurf",
            JSON.stringify({ error: obj.error })
          );
          if (err) throw err;
        }

        const deltaMsg = isRecord(obj.deltaMessage)
          ? obj.deltaMessage
          : isRecord(obj.chatMessage)
            ? obj.chatMessage
            : undefined;

        const thinkingDelta =
          (typeof deltaMsg?.thinking === "string" && deltaMsg.thinking) ||
          (typeof deltaMsg?.reasoning === "string" && deltaMsg.reasoning) ||
          (typeof obj.thinkingDelta === "string" ? obj.thinkingDelta : "");
        const thinkingSig =
          typeof deltaMsg?.thinkingSignature === "string"
            ? deltaMsg.thinkingSignature
            : undefined;
        if (thinkingDelta || thinkingSig) {
          emitThinking(thinkingDelta, thinkingSig);
        }

        const textDelta =
          (typeof deltaMsg?.text === "string" && deltaMsg.text) ||
          (typeof obj.text === "string" ? obj.text : "");
        if (textDelta) {
          emitText(textDelta);
        }

        const toolCallsRaw = Array.isArray(deltaMsg?.toolCalls)
          ? deltaMsg.toolCalls
          : Array.isArray(obj.toolCalls)
            ? obj.toolCalls
            : isRecord(obj.toolCall)
              ? [obj.toolCall]
              : [];
        for (const item of toolCallsRaw) {
          if (isRecord(item)) emitToolCall(item);
        }

        const usage = isRecord(obj.usage)
          ? obj.usage
          : isRecord(obj.modelUsage)
            ? obj.modelUsage
            : undefined;
        if (usage) {
          if (typeof usage.inputTokens === "number") {
            output.usage.input = usage.inputTokens;
          }
          if (typeof usage.outputTokens === "number") {
            output.usage.output = usage.outputTokens;
          }
          if (typeof usage.cacheReadTokens === "number") {
            output.usage.cacheRead = usage.cacheReadTokens;
          }
          output.usage.totalTokens =
            typeof usage.totalTokens === "number"
              ? usage.totalTokens
              : output.usage.input + output.usage.output;
        }
      };

      const contentType = (
        response.headers.get("content-type") ?? ""
      ).toLowerCase();
      const isConnectStream = contentType.includes("application/connect+");
      const isConnectProto = contentType.includes("application/connect+proto");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      try {
        if (isConnectStream) {
          let pending: Uint8Array = new Uint8Array(0);
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            pending = concatUint8Arrays(pending, value);
            const { frames, remainder } = decodeConnectEnvelopes(pending);
            pending = remainder;
            for (const frame of frames) {
              if (frame.endStream) {
                const err = formatConnectEndStreamError(
                  "Windsurf",
                  decoder.decode(frame.payload)
                );
                if (err) throw err;
                continue;
              }
              if (frame.payload.byteLength === 0) continue;
              if (isConnectProto) {
                const decoded = decodeWindsurfProtoPayload(frame.payload);
                if (decoded) processObject(decoded);
              } else {
                const text = decoder.decode(frame.payload).trim();
                if (!text) continue;
                let parsed: unknown;
                try {
                  parsed = JSON.parse(text) as unknown;
                } catch {
                  throw new Error(
                    "Windsurf 非官方社区适配协议返回了非预期 JSON 帧，上游接口可能已调整；建议切换其他订阅渠道。"
                  );
                }
                if (isRecord(parsed)) processObject(parsed);
              }
            }
          }
          if (pending.byteLength > 0) {
            throw new Error(
              "Windsurf Connect 响应流意外截断，上游接口可能已调整或连接中断。"
            );
          }
        } else {
          let buffer = "";
          const drainLines = (flushAll: boolean) => {
            const normalized = buffer.replace(/\r\n/gu, "\n");
            const lines = normalized.split("\n");
            buffer = flushAll ? "" : (lines.pop() ?? "");
            for (const rawLine of lines) {
              const line = rawLine.trim();
              if (!line) continue;
              const data = line.startsWith("data:")
                ? line.slice(5).trim()
                : line;
              if (!data || data === "[DONE]") continue;
              let parsed: unknown;
              try {
                parsed = JSON.parse(data) as unknown;
              } catch {
                throw new Error(
                  "Windsurf 非官方社区适配协议响应格式已变化，暂无法解析；建议切换其他订阅渠道。"
                );
              }
              if (isRecord(parsed)) processObject(parsed);
            }
          };
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            drainLines(false);
          }
          buffer += decoder.decode();
          drainLines(true);
        }
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

export function windsurfConnectApi(
  fetcher?: WindsurfConnectFetcher
): ProviderStreams {
  const invoke: ProviderStreams["streamSimple"] = (model, context, options) =>
    streamWindsurfConnect({
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
