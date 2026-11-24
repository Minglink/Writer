import { Context } from "@deepseek-ai/cordis";
import LlmRuntime, {
  LlmAdapter,
  createAssistantMessage,
  createSystemMessage,
  createToolResultMessage,
  createUserMessage,
  type ContentBlock,
  type FinishReason,
  type GenerateOptions,
  type LlmProviderInfo,
  type LlmResolvedModelInfo,
  type RequestMessage,
  type StreamChunk,
  type ToolSchema
} from "@deepseek-ai/dsh-llm";
import {
  createAssistantMessageEventStream,
  type Api,
  type AssistantMessage,
  type AssistantMessageEvent,
  type ImageContent,
  type Message,
  type Model,
  type SimpleStreamOptions,
  type TextContent,
  type ThinkingContent,
  type ToolCall,
  type Usage
} from "@earendil-works/pi-ai";
import type { StreamFn } from "@earendil-works/pi-agent-core";

const PROVIDER = "writer";

type AnyBlock =
  ContentBlock | TextContent | ThinkingContent | ImageContent | ToolCall;

interface Binding {
  readonly inner: StreamFn;
  readonly model: Model<Api>;
  readonly options: SimpleStreamOptions | undefined;
  /** Image blocks per user message, in user-message order. */
  readonly images: (ImageContent[] | undefined)[];
}

/** Provider thought signatures of tool calls, kept across calls by call id. */
const callSignatures = new Map<string, string>();

/** Provider `api` of each assistant message, so model identity survives the seam. */
const messageApis = new WeakMap<object, string>();

/** Registered pi stream functions, keyed by the synthetic model id of one call. */
const bindings = new Map<string, Binding>();
let bindingSequence = 0;
let host: Promise<LlmRuntime> | undefined;

/** Bridges the harness model protocol onto the configured pi provider stack. */
class WriterLlmAdapter extends LlmAdapter {
  override providerInfo(provider: string): LlmProviderInfo {
    return { id: provider, name: "Writer model" };
  }

  override resolveModel(
    provider: string,
    model: string
  ): Promise<LlmResolvedModelInfo> {
    const binding = bindings.get(model);
    if (!binding) return Promise.resolve({ provider, id: model, name: model });
    return Promise.resolve({
      provider,
      id: model,
      name: binding.model.id,
      context: { contextWindow: binding.model.contextWindow },
      defaultMaxTokens: binding.model.maxTokens
    });
  }

  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const binding = bindings.get(options.model);
    if (!binding) {
      throw new Error(`Writer model ${options.model} is no longer registered.`);
    }
    let userIndex = 0;
    const toolNames = toolNamesByCallId(options.messages);
    if (process.env.DSH_TRACE)
      console.log(
        "[dsh] names",
        toolNames.size,
        JSON.stringify(
          options.messages
            .filter((m) => m.role === "assistant")
            .map((m) => m.content.map((b) => b.type))
        )
      );
    const messages = options.messages.flatMap((message) =>
      toPiMessages(
        message,
        message.role === "user" ? binding.images[userIndex++] : undefined,
        toolNames
      )
    );
    const systemPrompt = messages
      .map((message) =>
        message.role === "system" ? systemTextOf([message]) : ""
      )
      .join("\n\n");
    const tools = (options.tools ?? []).map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters
    }));
    const stream = await binding.inner(
      binding.model,
      {
        systemPrompt,
        tools,
        messages: [
          {
            role: "system",
            content: systemPrompt,
            toolsAdded: tools,
            timestamp: Date.now()
          },
          ...messages.filter((message) => message.role !== "system")
        ]
      } as unknown as Parameters<StreamFn>[1],
      binding.options
    );
    const emitted = new Set<number>();
    for await (const event of stream) {
      for (const chunk of toHarnessChunks(event, emitted)) yield chunk;
    }
  }
}

/** Boots the lazily created harness LLM runtime that every call shares. */
function llm(): Promise<LlmRuntime> {
  host ??= (async () => {
    const ctx = new Context();
    await ctx.plugin(LlmRuntime);
    await ctx.plugin({
      name: "writer-llm-adapter",
      inject: ["llm"],
      apply(pluginCtx: Context) {
        pluginCtx.llm.registerAdapter([PROVIDER], new WriterLlmAdapter());
      }
    });
    return ctx.llm;
  })();
  return host;
}

/**
 * Wraps the configured pi stream function so every model request crosses the
 * harness LLM seam: the agent loop keeps owning the transcript and the tool
 * loop, while request assembly, the streaming protocol and provider-failure
 * normalization become the harness's.
 */
export function createHarnessStreamFn(
  inner: StreamFn,
  model: Model<Api>
): StreamFn {
  return (called, context, options) => {
    const stream = createAssistantMessageEventStream();
    const assembler = createAssembler(stream, called);
    const modelId = `${model.id}#${++bindingSequence}`;
    bindings.set(modelId, {
      inner,
      model: called,
      options,
      images: context.messages
        .filter((message) => message.role === "user")
        .map((message) =>
          typeof message.content === "string"
            ? undefined
            : message.content.flatMap((block) =>
                block.type === "image" ? [block] : []
              )
        )
    });
    void (async () => {
      try {
        const runtime = await llm();
        for await (const chunk of runtime.stream({
          provider: PROVIDER,
          model: modelId,
          messages: toRequestMessages(
            context.messages,
            systemTextOf(context.messages)
          ),
          tools: toToolSchemas(context.messages),
          ...(options?.temperature === undefined
            ? {}
            : { temperature: options.temperature }),
          ...(options?.maxTokens === undefined
            ? {}
            : { maxTokens: options.maxTokens }),
          ...(options?.signal === undefined ? {} : { signal: options.signal })
        })) {
          assembler.push(chunk);
        }
        assembler.finish();
      } catch (error: unknown) {
        const message = emptyAssistant(called, "error");
        message.errorMessage =
          error instanceof Error ? error.message : String(error);
        assembler.fail(message);
      } finally {
        bindings.delete(modelId);
      }
    })();
    return stream;
  };
}

interface Assembler {
  push(chunk: StreamChunk): void;
  finish(): void;
  fail(message: AssistantMessage): void;
}

/**
 * Turns the harness chunk protocol back into the loop's assistant event
 * stream, one event per chunk so the UI streams instead of receiving a batch.
 */
function createAssembler(
  stream: ReturnType<typeof createAssistantMessageEventStream>,
  model: Model<Api>
): Assembler {
  const partial = emptyAssistant(model, "pending");
  stream.push({ type: "start", partial });
  const texts = new Map<number, TextContent>();
  const calls = new Map<number, { id: string; name: string; json: string }>();
  let usage: Usage | undefined;
  let stopReason: AssistantMessage["stopReason"] = "stop";
  let ended = false;

  const end = (): void => {
    if (ended) return;
    ended = true;
    for (const [index, call] of calls) {
      const toolCall = toToolCall(call);
      partial.content[index] = toolCall;
      stream.push({
        type: "toolcall_end",
        contentIndex: index,
        toolCall,
        partial
      });
    }
    if (process.env.DSH_TRACE)
      console.log(
        "[dsh] end",
        stopReason,
        JSON.stringify(partial.content).slice(0, 200)
      );
    if (usage) partial.usage = usage;
    partial.stopReason = stopReason;
    if (stopReason === "error" || stopReason === "aborted") {
      stream.push({ type: "error", reason: stopReason, error: partial });
    } else {
      stream.push({
        type: "done",
        reason: stopReason === "length" ? "length" : "stop",
        message: partial
      });
    }
    stream.end(partial);
  };

  return {
    push(chunk) {
      switch (chunk.type) {
        case "text-delta": {
          const block = textBlock(texts, chunk.index, partial);
          block.text += chunk.text;
          stream.push({
            type: "text_delta",
            contentIndex: chunk.index,
            delta: chunk.text,
            partial
          });
          break;
        }
        case "reasoning-delta": {
          const block = thinkingBlock(partial, chunk.index);
          block.thinking += chunk.text;
          stream.push({
            type: "thinking_delta",
            contentIndex: chunk.index,
            delta: chunk.text,
            partial
          });
          break;
        }
        case "tool-call-delta": {
          const call = calls.get(chunk.index) ?? {
            id: chunk.id,
            name: chunk.name ?? "",
            json: ""
          };
          if (chunk.id) call.id = chunk.id;
          if (chunk.name) call.name = chunk.name;
          call.json += chunk.argumentsDelta;
          calls.set(chunk.index, call);
          stream.push({
            type: "toolcall_delta",
            contentIndex: chunk.index,
            delta: chunk.argumentsDelta,
            partial
          });
          break;
        }
        case "block-end": {
          if (chunk.block.type === "tool-call") {
            calls.set(chunk.index, {
              id: chunk.block.id,
              name: chunk.block.name,
              json: chunk.block.arguments
            });
          }
          break;
        }
        case "usage":
          usage = toPiUsage(chunk.usage);
          break;
        case "finish":
          stopReason = toPiStop(chunk.reason);
          if (chunk.reason.kind === "error") {
            partial.errorMessage = chunk.reason.failure.message;
          }
          end();
          break;
        default:
          break;
      }
    },
    finish() {
      end();
    },
    fail(message) {
      ended = true;
      stream.push({ type: "error", reason: "error", error: message });
      stream.end(message);
    }
  };
}

function* toHarnessChunks(
  event: AssistantMessageEvent,
  emitted: Set<number>
): Generator<StreamChunk> {
  switch (event.type) {
    case "start":
      yield { type: "block-start", index: 0, blockType: "text" };
      return;
    case "text_delta":
      emitted.add(event.contentIndex);
      yield {
        type: "text-delta",
        index: event.contentIndex,
        text: event.delta
      };
      return;
    case "thinking_delta":
      emitted.add(event.contentIndex);
      yield {
        type: "reasoning-delta",
        index: event.contentIndex,
        text: event.delta
      };
      return;
    case "toolcall_end":
      if (process.env.DSH_TRACE)
        console.log(
          "[dsh] toolCall keys",
          JSON.stringify(Object.keys(event.toolCall)),
          JSON.stringify(event.toolCall).slice(0, 400)
        );
      emitted.add(event.contentIndex);
      if (event.toolCall.thoughtSignature !== undefined) {
        callSignatures.set(event.toolCall.id, event.toolCall.thoughtSignature);
      }
      yield {
        type: "block-end",
        index: event.contentIndex,
        block: {
          type: "tool-call",
          id: event.toolCall.id as never,
          name: event.toolCall.name,
          arguments: JSON.stringify(event.toolCall.arguments ?? {})
        }
      };
      return;
    case "toolcall_delta": {
      emitted.add(event.contentIndex);
      const block = event.partial.content[event.contentIndex];
      yield {
        type: "tool-call-delta",
        index: event.contentIndex,
        id: (block?.type === "toolCall" ? block.id : "") as never,
        argumentsDelta: event.delta
      };
      return;
    }
    case "done":
      rememberSignatures(event.message);
      yield* finalContentChunks(event.message, emitted);
      yield { type: "usage", usage: toHarnessUsage(event.message.usage) };
      yield {
        type: "finish",
        reason: { kind: toHarnessStop(event.message) } as FinishReason
      };
      return;
    case "error":
      yield { type: "usage", usage: toHarnessUsage(event.error.usage) };
      yield {
        type: "finish",
        reason: {
          kind: event.error.stopReason === "aborted" ? "aborted" : "error",
          failure: {
            message: event.error.errorMessage ?? "模型请求失败。",
            code: "PI_AI_ERROR"
          }
        }
      };
      return;
    default:
      return;
  }
}

function toHarnessStop(
  message: AssistantMessage
): "stop" | "tool-calls" | "max-tokens" | "aborted" | "error" {
  switch (message.stopReason) {
    case "toolUse":
      return "tool-calls";
    case "length":
      return "max-tokens";
    case "aborted":
      return "aborted";
    case "error":
      return "error";
    default:
      return "stop";
  }
}

function toHarnessUsage(usage: Usage): {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  reasoningTokens?: number;
} {
  return {
    inputTokens: usage.input,
    outputTokens: usage.output,
    totalTokens: usage.totalTokens,
    ...(usage.cacheRead > 0 ? { cacheReadTokens: usage.cacheRead } : {}),
    ...(usage.cacheWrite > 0 ? { cacheWriteTokens: usage.cacheWrite } : {}),
    ...(usage.reasoning === undefined
      ? {}
      : { reasoningTokens: usage.reasoning })
  };
}

function textBlock(
  indexes: Map<number, TextContent>,
  index: number,
  partial: AssistantMessage
): TextContent {
  const existing = indexes.get(index) ?? { type: "text", text: "" };
  indexes.set(index, existing);
  partial.content[index] = existing;
  return existing;
}

function thinkingBlock(
  partial: AssistantMessage,
  index: number
): ThinkingContent {
  const current = partial.content[index];
  if (current?.type === "thinking") return current;
  const block: ThinkingContent = { type: "thinking", thinking: "" };
  partial.content[index] = block;
  return block;
}

function toToolCall(call: {
  id: string;
  name: string;
  json: string;
}): ToolCall {
  const signature = callSignatures.get(call.id);
  return {
    type: "toolCall",
    id: call.id,
    name: call.name,
    arguments: parseArguments(call.json) as ToolCall["arguments"],
    ...(signature === undefined ? {} : { thoughtSignature: signature })
  };
}

function emptyAssistant(
  model: Model<Api>,
  stopReason: AssistantMessage["stopReason"]
): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: emptyUsage(),
    stopReason,
    timestamp: Date.now()
  };
}

function emptyUsage(): Usage {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
  };
}

function toPiUsage(usage: {
  inputTokens: number;
  outputTokens: number;
  totalTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  reasoningTokens?: number;
}): Usage {
  const cacheRead = usage.cacheReadTokens ?? 0;
  const cacheWrite = usage.cacheWriteTokens ?? 0;
  return {
    ...emptyUsage(),
    input: usage.inputTokens,
    output: usage.outputTokens,
    cacheRead,
    cacheWrite,
    totalTokens:
      usage.totalTokens ??
      usage.inputTokens + usage.outputTokens + cacheRead + cacheWrite,
    ...(usage.reasoningTokens === undefined
      ? {}
      : { reasoning: usage.reasoningTokens })
  };
}

function toPiStop(
  reason: Extract<StreamChunk, { type: "finish" }>["reason"]
): AssistantMessage["stopReason"] {
  switch (reason.kind) {
    case "stop":
      return "stop";
    case "tool-calls":
      return "toolUse";
    case "max-tokens":
      return "length";
    case "aborted":
      return "aborted";
    default:
      return "error";
  }
}

/** Tool names keyed by call id, recovered from the assistant calls they answer. */
function toolNamesByCallId(
  messages: readonly RequestMessage[]
): Map<string, string> {
  const names = new Map<string, string>();
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    for (const block of message.content) {
      if (block.type === "tool-call") names.set(block.id, block.name);
    }
  }
  return names;
}

function piSystem(text: string): Message {
  return { role: "system", content: text, timestamp: Date.now() };
}

function piUser(text: string, images?: ImageContent[]): Message {
  return {
    role: "user",
    content:
      images && images.length > 0 ? [{ type: "text", text }, ...images] : text,
    timestamp: Date.now()
  };
}

function textOf(blocks: readonly AnyBlock[]): string {
  return blocks
    .map((block) => {
      if (block.type === "text") return block.text;
      if (block.type === "reasoning") return block.text;
      return "";
    })
    .join("");
}

function systemTextOf(messages: readonly Message[]): string {
  return messages
    .filter((message) => message.role === "system")
    .map((message) =>
      typeof message.content === "string"
        ? message.content
        : message.content.map((block) => block.text).join("")
    )
    .join("\n\n");
}

function userBlocks(
  content: Extract<Message, { role: "user" }>["content"]
): ContentBlock[] {
  if (typeof content === "string") return [{ type: "text", text: content }];
  return content.map((block) =>
    block.type === "text"
      ? { type: "text" as const, text: block.text }
      : { type: "text" as const, text: `[图片 ${block.mimeType}]` }
  );
}

function toPiMessages(
  message: RequestMessage,
  images: ImageContent[] | undefined,
  toolNames: Map<string, string>
): Message[] {
  switch (message.role) {
    case "system":
      return [piSystem(textOf(message.content))];
    case "user":
      return [piUser(textOf(message.content), images)];
    case "assistant":
      return [
        {
          role: "assistant",
          content: toPiContent(message.content),
          api: (messageApis.get(message) ?? "writer-harness") as never,
          provider: message.source.provider as never,
          model: message.source.model,
          usage: emptyUsage(),
          stopReason: "stop" as const,
          timestamp: Date.now()
        }
      ];
    case "tool":
      return [
        {
          role: "toolResult",
          toolCallId: message.source.callId,
          toolName:
            toolNames.get(message.source.callId) ?? message.source.callId,
          content: [{ type: "text" as const, text: textOf(message.content) }],
          isError: message.isError === true,
          timestamp: Date.now()
        }
      ];
    case "developer":
      return [];
  }
}

function toRequestMessages(
  messages: readonly Message[],
  systemText: string
): RequestMessage[] {
  const rest: RequestMessage[] = [];
  for (const message of messages) {
    if (process.env.DSH_TRACE)
      console.log(
        "[dsh] pi roles",
        JSON.stringify(
          messages.map((m) => [
            m.role,
            Array.isArray(m.content) ? m.content.map((b) => b.type) : "str"
          ])
        )
      );
    switch (message.role) {
      case "user":
        rest.push(
          createUserMessage({
            content: userBlocks(message.content),
            source: { kind: "user" }
          })
        );
        break;
      case "assistant": {
        const converted = createAssistantMessage({
          content: toHarnessContent(message.content),
          source: {
            provider: message.provider,
            model: message.model
          }
        });
        messageApis.set(converted, message.api);
        rest.push(converted);
        break;
      }
      case "toolResult":
        rest.push(
          createToolResultMessage({
            callId: message.toolCallId as never,
            content: [{ type: "text", text: textOf(message.content) }],
            isError: message.isError
          })
        );
        break;
      default:
        break;
    }
  }
  return [createSystemMessage(systemText), ...rest];
}

function toToolSchemas(messages: readonly Message[]): ToolSchema[] {
  return messages.flatMap((message) =>
    message.role === "system"
      ? (message.toolsAdded ?? []).map((tool) => ({
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters as Record<string, unknown>
        }))
      : []
  );
}

function toPiContent(
  blocks: readonly ContentBlock[]
): (TextContent | ThinkingContent | ToolCall)[] {
  const content: (TextContent | ThinkingContent | ToolCall)[] = [];
  for (const block of blocks) {
    if (block.type === "text") content.push({ type: "text", text: block.text });
    else if (block.type === "reasoning") {
      content.push({ type: "thinking", thinking: block.text });
    } else if (block.type === "tool-call") {
      const signature = callSignatures.get(block.id);
      content.push({
        type: "toolCall",
        id: block.id,
        name: block.name,
        arguments: block.arguments as unknown as ToolCall["arguments"],
        ...(signature === undefined ? {} : { thoughtSignature: signature })
      });
    }
  }
  return content;
}

/** Provider thought signatures carried by the transcript's tool calls. */
function toHarnessContent(blocks: readonly AnyBlock[]): ContentBlock[] {
  const content: ContentBlock[] = [];
  for (const block of blocks) {
    if (block.type === "text") content.push({ type: "text", text: block.text });
    else if (block.type === "reasoning" || block.type === "thinking") {
      content.push({
        type: "reasoning",
        text: block.type === "thinking" ? block.thinking : block.text
      });
    } else if (block.type === "tool-call" || block.type === "toolCall") {
      content.push({
        type: "tool-call",
        id: block.id as never,
        name: block.name,
        arguments:
          "arguments" in block && typeof block.arguments === "string"
            ? block.arguments
            : JSON.stringify(block.arguments ?? {})
      });
    } else if (block.type === "image") {
      content.push({ type: "text", text: "[图片]" });
    }
  }
  return content;
}

function parseArguments(argumentsText: string): Record<string, unknown> {
  try {
    const parsed: unknown = argumentsText.length
      ? JSON.parse(argumentsText)
      : {};
    if (parsed && typeof parsed === "object") {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return {};
  }
  return {};
}

/**
 * Providers that only publish the terminal message (fixtures, some gateways)
 * never stream blocks; replay their final content as deltas so nothing is lost.
 */
function* finalContentChunks(
  message: AssistantMessage,
  emitted: Set<number>
): Generator<StreamChunk> {
  for (const [index, block] of message.content.entries()) {
    if (emitted.has(index)) continue;
    if (block.type === "text" && block.text.length > 0) {
      yield { type: "text-delta", index, text: block.text };
    } else if (block.type === "thinking" && block.thinking.length > 0) {
      yield { type: "reasoning-delta", index, text: block.thinking };
    } else if (block.type === "toolCall") {
      yield {
        type: "tool-call-delta",
        index,
        id: block.id as never,
        name: block.name,
        argumentsDelta: JSON.stringify(block.arguments ?? {})
      };
    }
  }
}

/** Keep every provider thought signature the final message reports. */
function rememberSignatures(message: AssistantMessage): void {
  for (const block of message.content) {
    if (block.type === "toolCall" && block.thoughtSignature !== undefined) {
      callSignatures.set(block.id, block.thoughtSignature);
    }
  }
}
