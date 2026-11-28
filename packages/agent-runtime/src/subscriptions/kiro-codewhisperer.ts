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

export const KIRO_CODEWHISPERER_DEFAULT_BASE_URL =
  "https://q.us-east-1.amazonaws.com";

export const KIRO_PROFILE_ARN_INTERNAL_HEADER =
  "x-writer-subscription-profile-arn";

export type KiroCodeWhispererFetcher = (
  input: string,
  init?: RequestInit
) => Promise<Response>;

const KIRO_DEFAULT_HEADERS: Record<string, string> = {
  "x-amzn-codewhisperer-optout": "true",
  "x-amzn-kiro-agent-mode": "vibe",
  "User-Agent": "aws-sdk-js/1.0.0 KiroIDE/0.7.0",
  "x-amz-user-agent": "aws-sdk-js/1.0.0 KiroIDE/0.7.0"
};

interface KiroToolAccumulator {
  index: number;
  toolCall: ToolCall;
  rawInput: string;
  closed: boolean;
}

export interface AwsEventStreamFrame {
  headers: Record<string, string>;
  payload: string;
}

function skipEventStreamHeaderValue(
  view: DataView,
  offset: number,
  valueType: number
): { nextOffset: number; stringValue?: string } {
  switch (valueType) {
    case 0:
    case 1:
      return { nextOffset: offset };
    case 2:
      return { nextOffset: offset + 1 };
    case 3:
      return { nextOffset: offset + 2 };
    case 4:
      return { nextOffset: offset + 4 };
    case 5:
    case 8:
      return { nextOffset: offset + 8 };
    case 9:
      return { nextOffset: offset + 16 };
    case 6: {
      if (offset + 2 > view.byteLength) {
        throw new Error("AWS EventStream 字节头长度截断。");
      }
      const len = view.getUint16(offset, false);
      return { nextOffset: offset + 2 + len };
    }
    case 7: {
      if (offset + 2 > view.byteLength) {
        throw new Error("AWS EventStream 字符串头长度截断。");
      }
      const len = view.getUint16(offset, false);
      const start = offset + 2;
      const end = start + len;
      if (end > view.byteLength) {
        throw new Error("AWS EventStream 字符串头内容截断。");
      }
      const bytes = new Uint8Array(view.buffer, view.byteOffset + start, len);
      return {
        nextOffset: end,
        stringValue: new TextDecoder().decode(bytes)
      };
    }
    default:
      throw new Error(`未知的 AWS EventStream 头类型：${valueType}`);
  }
}

export function decodeAwsEventStreamFrames(buffer: Uint8Array): {
  frames: AwsEventStreamFrame[];
  remainder: Uint8Array;
} {
  const frames: AwsEventStreamFrame[] = [];
  const decoder = new TextDecoder();
  let offset = 0;

  while (offset + 12 <= buffer.byteLength) {
    const view = new DataView(
      buffer.buffer,
      buffer.byteOffset + offset,
      buffer.byteLength - offset
    );
    const totalLength = view.getUint32(0, false);
    const headersLength = view.getUint32(4, false);
    if (totalLength < 16 || headersLength > totalLength - 16) {
      throw new Error("AWS EventStream 帧头格式无效。");
    }
    if (offset + totalLength > buffer.byteLength) {
      break;
    }

    const headers: Record<string, string> = {};
    let headerOffset = 12;
    const headersEnd = 12 + headersLength;
    while (headerOffset < headersEnd) {
      const nameLen = view.getUint8(headerOffset);
      headerOffset += 1;
      const nameBytes = new Uint8Array(
        buffer.buffer,
        buffer.byteOffset + offset + headerOffset,
        nameLen
      );
      const name = decoder.decode(nameBytes);
      headerOffset += nameLen;
      const valueType = view.getUint8(headerOffset);
      headerOffset += 1;
      const parsed = skipEventStreamHeaderValue(view, headerOffset, valueType);
      headerOffset = parsed.nextOffset;
      if (parsed.stringValue !== undefined) {
        headers[name] = parsed.stringValue;
      }
    }

    const payloadLength = totalLength - headersEnd - 4;
    const payloadBytes = new Uint8Array(
      buffer.buffer,
      buffer.byteOffset + offset + headersEnd,
      Math.max(0, payloadLength)
    );
    frames.push({
      headers,
      payload: decoder.decode(payloadBytes)
    });
    offset += totalLength;
  }

  return {
    frames,
    remainder: offset === 0 ? buffer : buffer.slice(offset)
  };
}

function resolveEndpointUrl(baseUrl: string, defaultBaseUrl: string): string {
  const root = (baseUrl || defaultBaseUrl).replace(/\/+$/u, "");
  if (root.endsWith("/generateAssistantResponse")) {
    return root;
  }
  return `${root}/generateAssistantResponse`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function extractTextFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const item of content) {
    if (!isRecord(item)) continue;
    if (item.type === "text" && typeof item.text === "string") {
      parts.push(item.text);
    }
  }
  return parts.join("\n");
}

function convertToolsForKiro(
  tools: Context["tools"]
): Array<Record<string, unknown>> {
  if (!tools || tools.length === 0) return [];
  return tools.map((tool) => ({
    toolSpecification: {
      name: tool.name,
      description: tool.description || tool.name,
      inputSchema: {
        json: tool.parameters ?? { type: "object", properties: {} }
      }
    }
  }));
}

export function buildKiroCodeWhispererRequest(
  model: Model<Api>,
  context: Context,
  options: SimpleStreamOptions | undefined,
  profileArn?: string
): Record<string, unknown> {
  const normalized = normalizeContext(context);
  const kiroTools = convertToolsForKiro(getCurrentTools(normalized.messages));
  const systemPrompt = getCurrentSystemPrompt(normalized.messages).trim();
  const thinkingHint =
    model.reasoning && options?.reasoning
      ? `<thinking_mode>enabled</thinking_mode><thinking_effort>${options.reasoning}</thinking_effort>`
      : "";

  const history: Array<Record<string, unknown>> = [];
  let pendingToolResults: Array<Record<string, unknown>> = [];
  let currentUserText = "";
  let currentToolResults: Array<Record<string, unknown>> = [];

  const flushPendingToolResultsAsHistory = () => {
    if (pendingToolResults.length === 0) return;
    history.push({
      userInputMessage: {
        content: "",
        modelId: model.id,
        origin: "AI_EDITOR",
        userInputMessageContext: {
          toolResults: pendingToolResults
        }
      }
    });
    pendingToolResults = [];
  };

  for (let i = 0; i < normalized.messages.length; i += 1) {
    const message = normalized.messages[i]!;
    const isLast = i === normalized.messages.length - 1;

    if (message.role === "user") {
      flushPendingToolResultsAsHistory();
      const text = extractTextFromContent(message.content);
      if (isLast) {
        currentUserText = text;
      } else {
        history.push({
          userInputMessage: {
            content: text || "Continue.",
            modelId: model.id,
            origin: "AI_EDITOR"
          }
        });
      }
      continue;
    }

    if (message.role === "assistant") {
      flushPendingToolResultsAsHistory();
      const textParts: string[] = [];
      const toolUses: Array<Record<string, unknown>> = [];
      for (const block of message.content) {
        if (block.type === "text" && block.text) {
          textParts.push(block.text);
        } else if (block.type === "toolCall") {
          toolUses.push({
            toolUseId: block.id,
            name: block.name,
            input: block.arguments ?? {}
          });
        }
      }
      history.push({
        assistantResponseMessage: {
          content: textParts.join("\n"),
          ...(toolUses.length > 0 ? { toolUses } : {})
        }
      });
      continue;
    }

    if (message.role === "toolResult") {
      const resultText = extractTextFromContent(message.content);
      const entry = {
        toolUseId: message.toolCallId,
        content: [{ text: resultText || "(empty)" }],
        status: message.isError ? "error" : "success"
      };
      if (isLast) {
        currentToolResults = [...pendingToolResults, entry];
        pendingToolResults = [];
      } else {
        pendingToolResults.push(entry);
      }
    }
  }

  if (pendingToolResults.length > 0) {
    currentToolResults = [...pendingToolResults, ...currentToolResults];
    pendingToolResults = [];
  }

  if (systemPrompt || thinkingHint) {
    const prefix = [systemPrompt, thinkingHint].filter(Boolean).join("\n\n");
    if (history.length > 0 && isRecord(history[0]?.userInputMessage)) {
      const firstUser = history[0]!.userInputMessage as Record<string, unknown>;
      const existing =
        typeof firstUser.content === "string" ? firstUser.content : "";
      firstUser.content = existing ? `${prefix}\n\n${existing}` : prefix;
    } else {
      currentUserText = currentUserText
        ? `${prefix}\n\n${currentUserText}`
        : prefix;
    }
  }

  const userInputMessageContext: Record<string, unknown> = {};
  if (kiroTools.length > 0) {
    userInputMessageContext.tools = kiroTools;
  }
  if (currentToolResults.length > 0) {
    userInputMessageContext.toolResults = currentToolResults;
  }

  const conversationState: Record<string, unknown> = {
    conversationId: options?.sessionId || randomUUID(),
    chatTriggerType: "MANUAL",
    currentMessage: {
      userInputMessage: {
        content:
          currentUserText || (currentToolResults.length > 0 ? "" : "Continue."),
        modelId: model.id,
        origin: "AI_EDITOR",
        ...(Object.keys(userInputMessageContext).length > 0
          ? { userInputMessageContext }
          : {})
      }
    },
    ...(history.length > 0 ? { history } : {})
  };

  return {
    ...(profileArn ? { profileArn } : {}),
    conversationState
  };
}

function buildHttpErrorMessage(
  status: number,
  bodyText: string,
  retryAfterHeader: string | null
): string {
  let detail: string;
  try {
    const parsed = JSON.parse(bodyText) as Record<string, unknown>;
    detail =
      (typeof parsed.message === "string" && parsed.message) ||
      (typeof parsed.Message === "string" && parsed.Message) ||
      (isRecord(parsed.error) && typeof parsed.error.message === "string"
        ? parsed.error.message
        : "") ||
      "";
  } catch {
    detail = bodyText.trim().slice(0, 240);
  }
  const retryHint = retryAfterHeader
    ? ` (Retry-After: ${retryAfterHeader})`
    : "";
  return `[HTTP ${status}]${retryHint} ${detail || "Kiro CodeWhisperer 接口请求失败。"}`.trim();
}

function mapExceptionStatus(exceptionType: string | undefined): number {
  const lower = (exceptionType ?? "").toLowerCase();
  if (lower.includes("throttl") || lower.includes("ratelimit")) return 429;
  if (lower.includes("quota") || lower.includes("limit")) return 429;
  if (lower.includes("unauthorized") || lower.includes("expiredtoken")) {
    return 401;
  }
  if (lower.includes("accessdenied") || lower.includes("forbidden")) return 403;
  if (lower.includes("validation")) return 400;
  return 500;
}

function parseToolArguments(raw: string): ToolCall["arguments"] {
  if (!raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return isRecord(parsed) ? (parsed as ToolCall["arguments"]) : {};
  } catch {
    return {};
  }
}

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  if (a.byteLength === 0) return b;
  if (b.byteLength === 0) return a;
  const merged = new Uint8Array(a.byteLength + b.byteLength);
  merged.set(a, 0);
  merged.set(b, a.byteLength);
  return merged;
}

function createThinkingTagSplitter(
  onText: (chunk: string) => void,
  onThinking: (chunk: string) => void
) {
  const OPEN_TAG = "<thinking>";
  const CLOSE_TAG = "</thinking>";
  let insideThinking = false;
  let pending = "";

  const push = (chunk: string, flush = false) => {
    pending += chunk;
    while (pending.length > 0) {
      const targetTag = insideThinking ? CLOSE_TAG : OPEN_TAG;
      const emit = insideThinking ? onThinking : onText;
      const tagIndex = pending.indexOf(targetTag);
      if (tagIndex !== -1) {
        if (tagIndex > 0) {
          emit(pending.slice(0, tagIndex));
        }
        pending = pending.slice(tagIndex + targetTag.length);
        insideThinking = !insideThinking;
        continue;
      }
      if (flush) {
        emit(pending);
        pending = "";
        break;
      }
      const keepLen = Math.min(pending.length, targetTag.length - 1);
      const safeLen = pending.length - keepLen;
      if (safeLen > 0) {
        emit(pending.slice(0, safeLen));
        pending = pending.slice(safeLen);
      }
      break;
    }
  };

  return {
    push: (chunk: string) => push(chunk, false),
    flush: () => push("", true)
  };
}

export interface StreamKiroCodeWhispererParams {
  model: Model<Api>;
  context: Context;
  options?: SimpleStreamOptions;
  defaultBaseUrl?: string;
  fetcher?: KiroCodeWhispererFetcher;
}

export function streamKiroCodeWhisperer({
  model,
  context,
  options,
  defaultBaseUrl = KIRO_CODEWHISPERER_DEFAULT_BASE_URL,
  fetcher = fetch
}: StreamKiroCodeWhispererParams) {
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
        throw new Error("[HTTP 401] 缺少有效 Kiro 订阅访问令牌。");
      }

      const combinedHeaders: Record<string, string> = {};
      for (const source of [
        KIRO_DEFAULT_HEADERS,
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
      const profileArn = combinedHeaders[KIRO_PROFILE_ARN_INTERNAL_HEADER];
      delete combinedHeaders[KIRO_PROFILE_ARN_INTERNAL_HEADER];
      delete combinedHeaders["x-writer-subscription-project-id"];

      let payload: unknown = buildKiroCodeWhispererRequest(
        model,
        context,
        options,
        profileArn
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
          Accept:
            "application/vnd.amazon.eventstream, text/event-stream, application/json",
          Authorization: `Bearer ${apiKey}`,
          "amz-sdk-invocation-id": randomUUID(),
          "amz-sdk-request": "attempt=1; max=1",
          ...combinedHeaders
        },
        body: JSON.stringify(payload),
        ...(options?.signal ? { signal: options.signal } : {})
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        throw new Error(
          buildHttpErrorMessage(
            response.status,
            errorText,
            response.headers.get("retry-after")
          )
        );
      }
      if (!response.body) {
        throw new Error("Kiro CodeWhisperer 未返回响应流。");
      }

      stream.push({ type: "start", partial: output });

      let activeBlock:
        | { kind: "text"; index: number; block: TextContent }
        | { kind: "thinking"; index: number; block: ThinkingContent }
        | undefined;
      const openTools = new Map<string, KiroToolAccumulator>();
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

      const emitTextDelta = (delta: string) => {
        if (!delta) return;
        if (activeBlock && activeBlock.kind !== "text") {
          closeActiveBlock();
        }
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

      const emitThinkingDelta = (delta: string, signature?: string) => {
        if (!delta && !signature) return;
        if (activeBlock && activeBlock.kind !== "thinking") {
          closeActiveBlock();
        }
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
        if (signature) {
          state.block.thinkingSignature = signature;
        }
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

      const thinkingSplitter = createThinkingTagSplitter(
        emitTextDelta,
        (chunk) => emitThinkingDelta(chunk)
      );

      const finalizeTool = (acc: KiroToolAccumulator) => {
        if (acc.closed) return;
        acc.closed = true;
        if (acc.rawInput) {
          acc.toolCall.arguments = parseToolArguments(acc.rawInput);
        }
        stream.push({
          type: "toolcall_end",
          contentIndex: acc.index,
          toolCall: acc.toolCall,
          partial: output
        });
      };

      const applyUsage = (usageObj: Record<string, unknown>) => {
        const input =
          typeof usageObj.inputTokens === "number"
            ? usageObj.inputTokens
            : typeof usageObj.promptTokens === "number"
              ? usageObj.promptTokens
              : undefined;
        const out =
          typeof usageObj.outputTokens === "number"
            ? usageObj.outputTokens
            : typeof usageObj.completionTokens === "number"
              ? usageObj.completionTokens
              : undefined;
        const cacheRead =
          typeof usageObj.cacheReadInputTokens === "number"
            ? usageObj.cacheReadInputTokens
            : typeof usageObj.cacheReadTokens === "number"
              ? usageObj.cacheReadTokens
              : undefined;
        const cacheWrite =
          typeof usageObj.cacheWriteInputTokens === "number"
            ? usageObj.cacheWriteInputTokens
            : typeof usageObj.cacheWriteTokens === "number"
              ? usageObj.cacheWriteTokens
              : undefined;
        if (input !== undefined) output.usage.input = input;
        if (out !== undefined) output.usage.output = out;
        if (cacheRead !== undefined) output.usage.cacheRead = cacheRead;
        if (cacheWrite !== undefined) output.usage.cacheWrite = cacheWrite;
        const total =
          typeof usageObj.totalTokens === "number"
            ? usageObj.totalTokens
            : output.usage.input + output.usage.output;
        if (total > 0) {
          output.usage.totalTokens = total;
        }
      };

      const processEvent = (
        eventType: string | undefined,
        messageType: string | undefined,
        exceptionType: string | undefined,
        rawPayload: string
      ) => {
        if (messageType === "exception" || exceptionType) {
          const status = mapExceptionStatus(exceptionType);
          let detail = rawPayload.trim();
          try {
            const parsed = JSON.parse(rawPayload) as Record<string, unknown>;
            detail =
              (typeof parsed.message === "string" && parsed.message) ||
              (typeof parsed.Message === "string" && parsed.Message) ||
              exceptionType ||
              detail;
          } catch {
            // Keep raw message.
          }
          throw new Error(
            `[HTTP ${status}] ${exceptionType ? `${exceptionType}: ` : ""}${detail || "Kiro 上游流异常"}`
          );
        }

        if (!rawPayload.trim()) return;
        const parsed = JSON.parse(rawPayload) as unknown;
        if (!isRecord(parsed)) return;

        if (isRecord(parsed.error)) {
          const code =
            typeof parsed.error.code === "number" ? parsed.error.code : 500;
          const msg =
            typeof parsed.error.message === "string"
              ? parsed.error.message
              : "Kiro 上游流返回错误";
          throw new Error(`[HTTP ${code}] ${msg}`);
        }

        const assistantEvent = isRecord(parsed.assistantResponseEvent)
          ? parsed.assistantResponseEvent
          : eventType === "assistantResponseEvent"
            ? parsed
            : undefined;
        if (assistantEvent && typeof assistantEvent.content === "string") {
          thinkingSplitter.push(assistantEvent.content);
        }

        const reasoningEvent = isRecord(parsed.reasoningContentEvent)
          ? parsed.reasoningContentEvent
          : eventType === "reasoningContentEvent"
            ? parsed
            : undefined;
        if (reasoningEvent) {
          const text =
            typeof reasoningEvent.text === "string"
              ? reasoningEvent.text
              : typeof reasoningEvent.thinking === "string"
                ? reasoningEvent.thinking
                : "";
          const sig =
            typeof reasoningEvent.signature === "string"
              ? reasoningEvent.signature
              : undefined;
          if (text || sig) {
            thinkingSplitter.flush();
            emitThinkingDelta(text, sig);
          }
        }

        const toolEvent = isRecord(parsed.toolUseEvent)
          ? parsed.toolUseEvent
          : eventType === "toolUseEvent"
            ? parsed
            : undefined;
        if (toolEvent) {
          thinkingSplitter.flush();
          closeActiveBlock();
          sawToolCall = true;
          const toolUseId =
            typeof toolEvent.toolUseId === "string" && toolEvent.toolUseId
              ? toolEvent.toolUseId
              : `kiro_tool_${++toolSequence}`;
          let acc = openTools.get(toolUseId);
          if (!acc) {
            const name =
              typeof toolEvent.name === "string" && toolEvent.name
                ? toolEvent.name
                : "tool";
            const toolCall: ToolCall = {
              type: "toolCall",
              id: toolUseId,
              name,
              arguments: {}
            };
            const index = output.content.push(toolCall) - 1;
            acc = { index, toolCall, rawInput: "", closed: false };
            openTools.set(toolUseId, acc);
            stream.push({
              type: "toolcall_start",
              contentIndex: index,
              partial: output
            });
          } else if (typeof toolEvent.name === "string" && toolEvent.name) {
            acc.toolCall.name = toolEvent.name;
          }

          if (
            typeof toolEvent.input === "string" &&
            toolEvent.input.length > 0
          ) {
            acc.rawInput += toolEvent.input;
            stream.push({
              type: "toolcall_delta",
              contentIndex: acc.index,
              delta: toolEvent.input,
              partial: output
            });
          } else if (isRecord(toolEvent.input)) {
            acc.toolCall.arguments = toolEvent.input as ToolCall["arguments"];
            const serialized = JSON.stringify(toolEvent.input);
            stream.push({
              type: "toolcall_delta",
              contentIndex: acc.index,
              delta: serialized,
              partial: output
            });
          }

          if (toolEvent.stop === true) {
            finalizeTool(acc);
          }
        }

        const usageCandidate = isRecord(parsed.usage)
          ? parsed.usage
          : isRecord(parsed.metadataEvent) &&
              isRecord(parsed.metadataEvent.usage)
            ? parsed.metadataEvent.usage
            : isRecord(parsed.meteringEvent)
              ? parsed.meteringEvent
              : eventType === "metadataEvent" || eventType === "meteringEvent"
                ? parsed
                : undefined;
        if (usageCandidate) {
          applyUsage(usageCandidate);
        }
      };

      const contentType = (
        response.headers.get("content-type") ?? ""
      ).toLowerCase();
      const isTextStream =
        contentType.includes("text/event-stream") ||
        contentType.includes("application/json") ||
        contentType.includes("application/x-ndjson");

      const reader = response.body.getReader();
      try {
        if (isTextStream) {
          const decoder = new TextDecoder();
          let buffer = "";
          const drainText = (flushAll: boolean) => {
            const normalized = buffer.replace(/\r\n/gu, "\n");
            const lines = normalized.split("\n");
            buffer = flushAll ? "" : (lines.pop() ?? "");
            let currentEventType: string | undefined;
            for (const rawLine of lines) {
              const line = rawLine.trim();
              if (!line) {
                currentEventType = undefined;
                continue;
              }
              if (line.startsWith("event:")) {
                currentEventType = line.slice(6).trim();
                continue;
              }
              const payload = line.startsWith("data:")
                ? line.slice(5).trim()
                : line;
              if (!payload || payload === "[DONE]") continue;
              processEvent(currentEventType, undefined, undefined, payload);
            }
          };
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            drainText(false);
          }
          buffer += decoder.decode();
          drainText(true);
        } else {
          let pendingBytes: Uint8Array = new Uint8Array(0);
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            pendingBytes = concatBytes(pendingBytes, value);
            const { frames, remainder } =
              decodeAwsEventStreamFrames(pendingBytes);
            pendingBytes = remainder;
            for (const frame of frames) {
              processEvent(
                frame.headers[":event-type"],
                frame.headers[":message-type"],
                frame.headers[":exception-type"],
                frame.payload
              );
            }
          }
        }
      } finally {
        reader.releaseLock();
      }

      thinkingSplitter.flush();
      closeActiveBlock();
      for (const acc of openTools.values()) {
        finalizeTool(acc);
      }
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

export function kiroCodeWhispererApi(
  fetcher?: KiroCodeWhispererFetcher
): ProviderStreams {
  const invoke: ProviderStreams["streamSimple"] = (model, context, options) =>
    streamKiroCodeWhisperer({
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
