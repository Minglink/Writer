import { createHash, randomUUID } from "node:crypto";
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

export const CURSOR_CONNECT_DEFAULT_BASE_URL = "https://api2.cursor.sh";
const CURSOR_CHAT_PATH = "/aiserver.v1.ChatService/StreamUnifiedChatWithTools";
const CURSOR_DEFAULT_HEADERS: Record<string, string> = {
  "Connect-Protocol-Version": "1",
  "x-cursor-client-version": "0.49.6",
  "x-ghost-mode": "true"
};

export type CursorConnectFetcher = (
  input: string,
  init?: RequestInit
) => Promise<Response>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function resolveCursorEndpoint(baseUrl: string): string {
  const root = (baseUrl || CURSOR_CONNECT_DEFAULT_BASE_URL).replace(
    /\/+$/u,
    ""
  );
  if (root.includes("/aiserver.v1.")) {
    return root;
  }
  return `${root}${CURSOR_CHAT_PATH}`;
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

export function buildCursorConnectRequest(
  model: Model<Api>,
  context: Context,
  options?: SimpleStreamOptions
): Record<string, unknown> {
  const normalized = normalizeContext(context);
  const systemPrompt = getCurrentSystemPrompt(normalized.messages).trim();
  const currentTools = getCurrentTools(normalized.messages);
  const conversation: Array<Record<string, unknown>> = [];

  if (systemPrompt) {
    conversation.push({
      type: "MESSAGE_TYPE_SYSTEM",
      text: systemPrompt
    });
  }

  for (const message of normalized.messages) {
    if (message.role === "user") {
      conversation.push({
        type: "MESSAGE_TYPE_HUMAN",
        text: extractContentText(message.content)
      });
    } else if (message.role === "assistant") {
      const texts: string[] = [];
      const toolCalls: Array<Record<string, unknown>> = [];
      for (const block of message.content) {
        if (block.type === "text" && block.text) {
          texts.push(block.text);
        } else if (block.type === "toolCall") {
          toolCalls.push({
            toolCallId: block.id,
            name: block.name,
            rawArgs: JSON.stringify(block.arguments ?? {})
          });
        }
      }
      conversation.push({
        type: "MESSAGE_TYPE_AI",
        text: texts.join("\n"),
        ...(toolCalls.length > 0 ? { toolCalls } : {})
      });
    } else if (message.role === "toolResult") {
      conversation.push({
        type: "MESSAGE_TYPE_TOOL",
        toolCallId: message.toolCallId,
        toolName: message.toolName,
        text: extractContentText(message.content),
        isError: message.isError
      });
    }
  }

  const tools = currentTools.map((tool) => ({
    name: tool.name,
    description: tool.description || tool.name,
    parameters: tool.parameters ?? { type: "object", properties: {} }
  }));

  return {
    conversationId: options?.sessionId || randomUUID(),
    modelDetails: {
      modelName: model.id
    },
    conversation,
    ...(tools.length > 0 ? { tools } : {}),
    ...(model.reasoning && options?.reasoning
      ? { thinking: { enabled: true, effort: options.reasoning } }
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
 * Decodes Cursor Connect+Proto StreamUnifiedChatResponse payloads:
 * field 1 = text (string), field 2 = nested message (1: text, 2: thinking),
 * field 25 = thinking (1: text, 2: signature), field 3 = toolCall (1: id, 2: name, 3: rawArgs).
 */
function decodeCursorProtoPayload(
  bytes: Uint8Array
): Record<string, unknown> | undefined {
  const decoder = new TextDecoder();
  const fields = decodeProtoFields(bytes);
  const result: Record<string, unknown> = {};
  for (const field of fields) {
    if (field.wireType !== 2 || !field.bytes) continue;
    if (field.fieldNumber === 1) {
      result.text = decoder.decode(field.bytes);
    } else if (field.fieldNumber === 2) {
      const nested = decodeProtoFields(field.bytes);
      for (const inner of nested) {
        if (inner.wireType !== 2 || !inner.bytes) continue;
        if (inner.fieldNumber === 1) {
          result.text = decoder.decode(inner.bytes);
        } else if (inner.fieldNumber === 2) {
          result.thinking = { text: decoder.decode(inner.bytes) };
        }
      }
    } else if (field.fieldNumber === 25) {
      const nested = decodeProtoFields(field.bytes);
      const thinkingObj: Record<string, string> = {};
      for (const inner of nested) {
        if (inner.wireType !== 2 || !inner.bytes) continue;
        if (inner.fieldNumber === 1) {
          thinkingObj.text = decoder.decode(inner.bytes);
        } else if (inner.fieldNumber === 2) {
          thinkingObj.signature = decoder.decode(inner.bytes);
        }
      }
      if (thinkingObj.text || thinkingObj.signature) {
        result.thinking = thinkingObj;
      }
    } else if (field.fieldNumber === 3) {
      const nested = decodeProtoFields(field.bytes);
      const call: Record<string, string> = {};
      for (const inner of nested) {
        if (inner.wireType !== 2 || !inner.bytes) continue;
        if (inner.fieldNumber === 1)
          call.toolCallId = decoder.decode(inner.bytes);
        if (inner.fieldNumber === 2) call.name = decoder.decode(inner.bytes);
        if (inner.fieldNumber === 3) call.rawArgs = decoder.decode(inner.bytes);
      }
      if (call.name) {
        result.clientSideToolV2Call = call;
      }
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

export interface StreamCursorConnectParams {
  model: Model<Api>;
  context: Context;
  options?: SimpleStreamOptions;
  fetcher?: CursorConnectFetcher;
}

export function streamCursorConnect({
  model,
  context,
  options,
  fetcher = fetch
}: StreamCursorConnectParams) {
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
        throw new Error("[HTTP 401] 缺少有效 Cursor 订阅访问令牌。");
      }

      const combinedHeaders: Record<string, string> = {};
      for (const source of [
        CURSOR_DEFAULT_HEADERS,
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
      if (!combinedHeaders["x-cursor-checksum"]) {
        combinedHeaders["x-cursor-checksum"] = createHash("sha256")
          .update(`writer-cursor-${model.id}`)
          .digest("hex")
          .slice(0, 32);
      }

      let payload: unknown = buildCursorConnectRequest(model, context, options);
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
      const url = resolveCursorEndpoint(model.baseUrl);
      const response = await fetcher(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/connect+json",
          Accept:
            "application/connect+json, application/connect+proto, text/event-stream, application/json",
          Authorization: `Bearer ${apiKey}`,
          "x-request-id": randomUUID(),
          ...combinedHeaders
        },
        body: Buffer.from(encodedPayload),
        ...(options?.signal ? { signal: options.signal } : {})
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        throw formatConnectHttpError(
          "Cursor",
          response.status,
          errorText,
          response.headers.get("retry-after")
        );
      }
      if (!response.body) {
        throw new Error("Cursor 非官方接口未返回响应流，请稍后重试。");
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

      const processObject = (obj: Record<string, unknown>) => {
        if (isRecord(obj.error)) {
          const err = formatConnectEndStreamError(
            "Cursor",
            JSON.stringify({ error: obj.error })
          );
          if (err) throw err;
        }

        const thinkingObj = isRecord(obj.thinking) ? obj.thinking : undefined;
        const thinkingDelta =
          (typeof thinkingObj?.text === "string" && thinkingObj.text) ||
          (typeof obj.thinkingDelta === "string" ? obj.thinkingDelta : "");
        const thinkingSig =
          typeof thinkingObj?.signature === "string"
            ? thinkingObj.signature
            : typeof obj.thinkingSignature === "string"
              ? obj.thinkingSignature
              : undefined;
        if (thinkingDelta || thinkingSig) {
          emitThinking(thinkingDelta, thinkingSig);
        }

        const textDelta =
          typeof obj.text === "string"
            ? obj.text
            : typeof obj.delta === "string"
              ? obj.delta
              : isRecord(obj.message) && typeof obj.message.text === "string"
                ? obj.message.text
                : "";
        if (textDelta) {
          emitText(textDelta);
        }

        const rawTool = isRecord(obj.clientSideToolV2Call)
          ? obj.clientSideToolV2Call
          : isRecord(obj.toolCall)
            ? obj.toolCall
            : undefined;
        if (rawTool && typeof rawTool.name === "string" && rawTool.name) {
          closeActiveBlock();
          sawToolCall = true;
          toolSequence += 1;
          const args = parseArgsObject(
            rawTool.rawArgs ?? rawTool.arguments ?? rawTool.params
          );
          const toolCall: ToolCall = {
            type: "toolCall",
            id:
              typeof rawTool.toolCallId === "string" && rawTool.toolCallId
                ? rawTool.toolCallId
                : typeof rawTool.id === "string" && rawTool.id
                  ? rawTool.id
                  : `cursor_tool_${toolSequence}`,
            name: rawTool.name,
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
        }

        const usage = isRecord(obj.tokenUsage)
          ? obj.tokenUsage
          : isRecord(obj.usage)
            ? obj.usage
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
          if (typeof usage.cacheWriteTokens === "number") {
            output.usage.cacheWrite = usage.cacheWriteTokens;
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
                  "Cursor",
                  decoder.decode(frame.payload)
                );
                if (err) throw err;
                continue;
              }
              if (frame.payload.byteLength === 0) continue;
              if (isConnectProto) {
                const decoded = decodeCursorProtoPayload(frame.payload);
                if (decoded) processObject(decoded);
              } else {
                const text = decoder.decode(frame.payload).trim();
                if (!text) continue;
                let parsed: unknown;
                try {
                  parsed = JSON.parse(text) as unknown;
                } catch {
                  throw new Error(
                    "Cursor 非官方社区适配协议返回了非预期 JSON 帧，上游接口可能已调整；建议切换其他订阅渠道。"
                  );
                }
                if (isRecord(parsed)) processObject(parsed);
              }
            }
          }
          if (pending.byteLength > 0) {
            throw new Error(
              "Cursor Connect 响应流意外截断，上游接口可能已调整或连接中断。"
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
                  "Cursor 非官方社区适配协议响应格式已变化，暂无法解析；建议切换其他订阅渠道。"
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

export function cursorConnectApi(
  fetcher?: CursorConnectFetcher
): ProviderStreams {
  const invoke: ProviderStreams["streamSimple"] = (model, context, options) =>
    streamCursorConnect({
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
