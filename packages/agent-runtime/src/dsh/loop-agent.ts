import {
  normalizeContext,
  type Api,
  type AssistantMessage,
  type Message,
  type Model,
  type SimpleStreamOptions,
  type ToolResultMessage,
  type Tool,
  type TSchema,
  type Usage
} from "@earendil-works/pi-ai";
import {
  runToolCall,
  type AgentEvent,
  type AgentMessage,
  type AgentState,
  type AgentTool,
  type AgentToolCall,
  type AgentToolCallOutcome,
  type AgentToolResult,
  type BeforeToolCallResult,
  type AfterToolCallResult,
  type AgentLoopTurnUpdate,
  type AgentTurnContext,
  type AgentTurnDecision,
  type QueueMode,
  type AfterToolCallContext,
  type BeforeToolCallContext,
  type StreamFn
} from "@earendil-works/pi-agent-core";
import {
  createHarnessSessionJournal,
  type HarnessSessionJournal
} from "./session-journal";

type Listener = (
  event: AgentEvent,
  signal: AbortSignal
) => Promise<void> | void;

type BeforeHook = (
  context: BeforeToolCallContext,
  signal?: AbortSignal
) => Promise<BeforeToolCallResult | undefined>;

type AfterHook = (
  context: AfterToolCallContext,
  signal?: AbortSignal
) => Promise<AfterToolCallResult | undefined>;

interface MutableState {
  messages: AgentMessage[];
  systemPrompt: string;
  tools: AgentTool[];
  model: Model<Api>;
  thinkingLevel: AgentState["thinkingLevel"];
  isStreaming: boolean;
  pendingToolCalls: Set<string>;
  errorMessage: string | undefined;
}

export interface LoopAgentOptions {
  initialState?: Partial<AgentState>;
  streamFn: StreamFn;
  beforeToolCall?: BeforeHook | undefined;
  afterToolCall?: AfterHook | undefined;
  sessionId?: string | undefined;
  steeringMode?: QueueMode;
  followUpMode?: QueueMode;
  journal?: HarnessSessionJournal | undefined;
}

class PendingQueue {
  private items: AgentMessage[] = [];
  constructor(public mode: QueueMode) {}
  enqueue(message: AgentMessage): void {
    this.items.push(message);
  }
  hasItems(): boolean {
    return this.items.length > 0;
  }
  drain(): AgentMessage[] {
    const drained =
      this.mode === "all" ? this.items.slice() : this.items.slice(0, 1);
    this.items = this.items.slice(drained.length);
    return drained;
  }
  clear(): void {
    this.items = [];
  }
}

/**
 * Turn scheduler over the harness: the model call goes through `streamFn`
 * (which is the harness LLM seam) and every tool call through the harness
 * tool pipeline behind `runToolCall`. This replaces the pi agent class while
 * keeping the identical transcript, event vocabulary and queue semantics, so
 * the kernel, retry coordinator and event mapping stay unchanged.
 */
export class LoopAgent {
  private readonly listeners = new Set<Listener>();
  private readonly steeringQueue: PendingQueue;
  private readonly followUpQueue: PendingQueue;
  private readonly stateValue: MutableState;
  private activeRun:
    | {
        readonly promise: Promise<void>;
        readonly resolve: () => void;
        readonly abortController: AbortController;
      }
    | undefined;

  streamFunction: StreamFn;
  beforeToolCall?: BeforeHook | undefined;
  afterToolCall?: AfterHook | undefined;
  finishTurn?:
    | ((
        turn: AgentTurnContext,
        signal?: AbortSignal
      ) =>
        | AgentTurnDecision
        | void
        | Promise<AgentTurnDecision | undefined>
        | Promise<void>)
    | undefined;
  prepareNextTurnWithContext?:
    | ((
        turn: AgentTurnContext,
        signal?: AbortSignal
      ) =>
        | Promise<AgentLoopTurnUpdate | undefined>
        | AgentLoopTurnUpdate
        | undefined)
    | undefined;
  sessionId?: string | undefined;
  toolExecution = "sequential" as const;
  readonly journal: HarnessSessionJournal;
  private turnSequence = 0;

  constructor(options: LoopAgentOptions) {
    const initial = options.initialState ?? {};
    const systemPrompt = initial.systemPrompt ?? "";
    const tools = [...(initial.tools ?? [])];
    this.stateValue = {
      // The transcript owns its leading system message, so a request is the
      // transcript and nothing else.
      messages: normalizeContext({
        systemPrompt,
        tools: tools.map(toToolDeclaration),
        messages: [...(initial.messages ?? [])].filter(
          (message) => message.role !== "system"
        )
      }).messages,
      systemPrompt,
      tools,
      model: initial.model as Model<Api>,
      thinkingLevel:
        initial.thinkingLevel ?? ("off" as AgentState["thinkingLevel"]),
      isStreaming: false,
      pendingToolCalls: new Set(),
      errorMessage: undefined
    };
    Object.defineProperty(this.stateValue, "systemPrompt", {
      enumerable: true,
      configurable: true,
      get: () => this.readSystemPrompt(),
      set: (value: string) => this.writeSystemPrompt(value)
    });
    this.streamFunction = options.streamFn;
    this.beforeToolCall = options.beforeToolCall;
    this.afterToolCall = options.afterToolCall;
    this.sessionId = options.sessionId;
    this.journal = options.journal ?? createHarnessSessionJournal();
    this.steeringQueue = new PendingQueue(
      options.steeringMode ?? "one-at-a-time"
    );
    this.followUpQueue = new PendingQueue(
      options.followUpMode ?? "one-at-a-time"
    );
  }

  private readSystemPrompt(): string {
    const head = this.stateValue.messages[0];
    if (head === undefined || head.role !== "system") return "";
    return typeof head.content === "string"
      ? head.content
      : head.content.map((block) => block.text).join("\n\n");
  }

  private writeSystemPrompt(value: string): void {
    const head = this.stateValue.messages[0];
    if (head !== undefined && head.role === "system") {
      this.stateValue.messages[0] = { ...head, content: value };
      return;
    }
    this.stateValue.messages.unshift({
      role: "system",
      content: value,
      timestamp: Date.now()
    });
  }

  get state(): AgentState {
    return this.stateValue as unknown as AgentState;
  }

  set steeringMode(mode: QueueMode) {
    this.steeringQueue.mode = mode;
  }

  get steeringMode(): QueueMode {
    return this.steeringQueue.mode;
  }

  get signal(): AbortSignal | undefined {
    return this.activeRun?.abortController.signal;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  steer(message: AgentMessage): void {
    this.steeringQueue.enqueue(message);
  }

  followUp(message: AgentMessage): void {
    this.followUpQueue.enqueue(message);
  }

  clearSteeringQueue(): void {
    this.steeringQueue.clear();
  }

  abort(): void {
    this.activeRun?.abortController.abort();
  }

  waitForIdle(): Promise<void> {
    return this.activeRun?.promise ?? Promise.resolve();
  }

  async prompt(input: AgentMessage | AgentMessage[] | string): Promise<void> {
    if (this.activeRun) {
      throw new Error(
        "The agent is already processing. Use steer() or followUp() to queue messages."
      );
    }
    const prompts =
      typeof input === "string"
        ? [
            {
              role: "user" as const,
              content: [{ type: "text" as const, text: input }],
              timestamp: Date.now()
            }
          ]
        : Array.isArray(input)
          ? input
          : [input];
    await this.run(prompts);
  }

  /** Resume from the transcript without adding input (retry and compaction). */
  async continue(): Promise<void> {
    if (this.activeRun) {
      throw new Error("The agent is already processing.");
    }
    const messages = this.stateValue.messages;
    const last = messages[messages.length - 1];
    if (!last || messages.every((message) => message.role === "system")) {
      throw new Error("No messages to continue from");
    }
    if (last.role === "assistant") {
      const steering = this.steeringQueue.drain();
      if (steering.length > 0) {
        await this.run(steering);
        return;
      }
      const followUps = this.followUpQueue.drain();
      if (followUps.length > 0) {
        await this.run(followUps);
        return;
      }
      throw new Error("Cannot continue from message role: assistant");
    }
    await this.run(undefined);
  }

  private async run(prompts: AgentMessage[] | undefined): Promise<void> {
    const abortController = new AbortController();
    let resolve = (): void => {};
    const promise = new Promise<void>((settle) => {
      resolve = settle;
    });
    this.activeRun = { promise, resolve, abortController };
    this.stateValue.isStreaming = true;
    try {
      await this.loop(prompts, abortController.signal);
    } catch (error: unknown) {
      await this.emitFailure(error, abortController.signal.aborted);
    } finally {
      this.stateValue.isStreaming = false;
      this.stateValue.pendingToolCalls = new Set();
      this.activeRun = undefined;
      resolve();
    }
  }

  private async loop(
    prompts: AgentMessage[] | undefined,
    signal: AbortSignal
  ): Promise<void> {
    const newMessages: AgentMessage[] = [];
    const push = async (message: AgentMessage): Promise<void> => {
      this.stateValue.messages.push(message);
      newMessages.push(message);
      await this.emit({ type: "message_start", message });
      await this.emit({ type: "message_end", message });
    };

    await this.emit({ type: "agent_start" });
    let currentTurn = ++this.turnSequence;
    this.journal.record({
      kind: "turn_started",
      sessionId: this.sessionId,
      turnIndex: currentTurn,
      messageCount: this.stateValue.messages.length,
      timestamp: Date.now()
    });
    await this.emit({ type: "turn_start" });
    for (const prompt of prompts ?? []) {
      // Prompt messages are declared before the first assistant step, matching
      // the transcript order the request assembly expects.
      const declared = prompt;
      this.stateValue.messages.push(declared);
      newMessages.push(declared);
      await this.emit({ type: "message_start", message: declared });
      await this.emit({ type: "message_end", message: declared });
    }

    let pendingSteering = this.steeringQueue.drain();
    let lastTurn: AgentTurnContext | undefined;
    let continuation = false;

    while (true) {
      let moreToolCalls = true;
      while (moreToolCalls || pendingSteering.length > 0) {
        if (lastTurn) {
          const prepared = await this.prepareNextTurnWithContext?.(
            lastTurn,
            signal
          );
          if (prepared) {
            if (prepared.context) {
              const beforeMessages = this.stateValue.messages.length;
              this.stateValue.messages = prepared.context.messages;
              if (prepared.context.messages.length < beforeMessages) {
                this.journal.record({
                  kind: "compaction_applied",
                  sessionId: this.sessionId,
                  beforeMessages,
                  afterMessages: prepared.context.messages.length,
                  timestamp: Date.now()
                });
              }
              this.stateValue.tools =
                prepared.context.tools ?? this.stateValue.tools;
            }
            if (prepared.model) this.stateValue.model = prepared.model;
            if (prepared.thinkingLevel) {
              this.stateValue.thinkingLevel =
                prepared.thinkingLevel as AgentState["thinkingLevel"];
            }
            for (const message of prepared.messages ?? []) await push(message);
          }
          if (pendingSteering.length === 0) {
            pendingSteering = this.steeringQueue.drain();
          }
          currentTurn = ++this.turnSequence;
          this.journal.record({
            kind: "turn_started",
            sessionId: this.sessionId,
            turnIndex: currentTurn,
            messageCount: this.stateValue.messages.length,
            timestamp: Date.now()
          });
          await this.emit({ type: "turn_start" });
        }

        for (const message of pendingSteering) await push(message);
        pendingSteering.length = 0;
        if (signal.aborted) throw abortError();

        const assistant = await this.streamAssistant(signal);
        if (
          assistant.stopReason === "error" ||
          assistant.stopReason === "aborted"
        ) {
          await this.finishTurn?.({
            message: assistant,
            toolResults: [],
            context: this.context(),
            newMessages
          });
          await this.emit({
            type: "turn_end",
            message: assistant,
            toolResults: []
          });
          await this.emit({ type: "agent_end", messages: newMessages });
          return;
        }

        const toolCalls = assistant.content.filter(
          (block): block is AgentToolCall => block.type === "toolCall"
        );
        const toolResults: ToolResultMessage[] = [];
        moreToolCalls = false;
        if (toolCalls.length > 0) {
          const outcomes =
            assistant.stopReason === "length"
              ? await this.failTruncatedToolCalls(toolCalls)
              : await this.executeToolCalls(assistant, toolCalls, signal);
          for (const outcome of outcomes) {
            const resultMessage = toolResultMessage(outcome);
            toolResults.push(resultMessage);
            this.journal.record({
              kind: "tool_settled",
              sessionId: this.sessionId,
              turnIndex: currentTurn,
              toolCallId: resultMessage.toolCallId,
              toolName: resultMessage.toolName,
              isError: resultMessage.isError,
              timestamp: Date.now()
            });
            await push(resultMessage);
          }
          moreToolCalls = !outcomes.every(
            (outcome) => (outcome as { terminate?: boolean }).terminate === true
          );
        }

        lastTurn = {
          message: assistant,
          toolResults,
          context: this.context(),
          newMessages
        };
        if (process.env.DSH_TRACE)
          console.log(
            "[dsh] after tools",
            this.stateValue.messages.map((m) => m.role).join(",")
          );
        this.journal.record({
          kind: "assistant_completed",
          sessionId: this.sessionId,
          turnIndex: currentTurn,
          stopReason: assistant.stopReason,
          toolCallCount: toolCalls.length,
          timestamp: Date.now()
        });
        const decision = await this.finishTurn?.(lastTurn, signal);
        this.journal.record({
          kind: "turn_finished",
          sessionId: this.sessionId,
          turnIndex: currentTurn,
          timestamp: Date.now()
        });
        await this.emit({
          type: "turn_end",
          message: assistant,
          toolResults
        });
        if (decision?.action === "end") {
          await this.emit({ type: "agent_end", messages: newMessages });
          return;
        }
        continuation = decision?.action === "continue";
        pendingSteering = this.steeringQueue.drain();
        if (moreToolCalls || pendingSteering.length > 0) continuation = false;
      }

      const followUps = this.followUpQueue.drain();
      if (followUps.length > 0) {
        continuation = false;
        pendingSteering = followUps;
        continue;
      }
      if (continuation) {
        continuation = false;
        continue;
      }
      break;
    }
    await this.emit({ type: "agent_end", messages: newMessages });
  }

  private context(): AgentState {
    return {
      messages: this.stateValue.messages.slice(),
      tools: this.stateValue.tools.slice(),
      systemPrompt: this.stateValue.systemPrompt,
      model: this.stateValue.model,
      thinkingLevel: this.stateValue.thinkingLevel,
      isStreaming: this.stateValue.isStreaming,
      pendingToolCalls: this.stateValue.pendingToolCalls,
      errorMessage: this.stateValue.errorMessage
    } as unknown as AgentState;
  }

  /** One model step, appended to the transcript with its live events. */
  private async streamAssistant(
    signal: AbortSignal
  ): Promise<AssistantMessage> {
    const request: Message[] = this.stateValue.messages;
    // The transcript's leading system message is authoritative: a reused agent
    // refreshes the prompt by replacing the transcript, not the field.
    const systemMessage = request.find((message) => message.role === "system");
    const systemPrompt =
      systemMessage === undefined
        ? this.stateValue.systemPrompt
        : typeof systemMessage.content === "string"
          ? systemMessage.content
          : systemMessage.content.map((block) => block.text).join("\n\n");
    const normalized = normalizeContext({
      systemPrompt,
      tools: this.stateValue.tools.map(toToolDeclaration),
      messages: request.filter((message) => message.role !== "system")
    });
    const response = await this.streamFunction(
      this.stateValue.model,
      normalized,
      {
        reasoning:
          this.stateValue.thinkingLevel === "off"
            ? undefined
            : this.stateValue.thinkingLevel,
        sessionId: this.sessionId,
        transport: "auto",
        signal
      } as SimpleStreamOptions
    );

    let partial: AssistantMessage | undefined;
    let opened = false;
    for await (const event of response) {
      if (event.type === "start") {
        partial = event.partial;
        this.stateValue.messages.push(partial);
        opened = true;
        await this.emit({ type: "message_start", message: { ...partial } });
        continue;
      }
      if (event.type === "done" || event.type === "error") continue;
      if (!partial) continue;
      partial = event.partial;
      this.stateValue.messages[this.stateValue.messages.length - 1] = partial;
      await this.emit({
        type: "message_update",
        assistantMessageEvent: event,
        message: { ...partial }
      });
    }

    const final = {
      ...(await response.result()),
      thinkingLevel: this.stateValue.thinkingLevel
    } as AssistantMessage;
    if (opened) {
      this.stateValue.messages[this.stateValue.messages.length - 1] = final;
    } else {
      this.stateValue.messages.push(final);
      await this.emit({ type: "message_start", message: { ...final } });
    }
    await this.emit({ type: "message_end", message: final });
    return final;
  }

  private async executeToolCalls(
    assistant: AssistantMessage,
    toolCalls: AgentToolCall[],
    signal: AbortSignal
  ): Promise<(AgentToolCallOutcome & { terminate?: boolean })[]> {
    const outcomes: (AgentToolCallOutcome & { terminate?: boolean })[] = [];
    for (const toolCall of toolCalls) {
      await this.emit({
        type: "tool_execution_start",
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        args: toolCall.arguments
      });
      this.markPending(toolCall.id, true);
      const outcome = (await runToolCall(toolCall, {
        tools: this.stateValue.tools,
        assistantMessage: assistant,
        context: this.context(),
        signal,
        ...(this.beforeToolCall ? { beforeToolCall: this.beforeToolCall } : {}),
        ...(this.afterToolCall ? { afterToolCall: this.afterToolCall } : {}),
        onUpdate: (partial: AgentToolResult<unknown>) => {
          void this.emit({
            type: "tool_execution_update",
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            args: toolCall.arguments,
            partialResult: partial
          });
        }
      })) as AgentToolCallOutcome & { terminate?: boolean };
      this.markPending(toolCall.id, false);
      await this.emit({
        type: "tool_execution_end",
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        result: outcome.result,
        isError: outcome.isError
      });
      outcomes.push(outcome);
      if (signal.aborted) break;
    }
    return outcomes;
  }

  private async failTruncatedToolCalls(
    toolCalls: AgentToolCall[]
  ): Promise<AgentToolCallOutcome[]> {
    const outcomes: AgentToolCallOutcome[] = [];
    for (const toolCall of toolCalls) {
      await this.emit({
        type: "tool_execution_start",
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        args: toolCall.arguments
      });
      const outcome: AgentToolCallOutcome = {
        toolCall,
        isError: true,
        result: {
          content: [
            {
              type: "text",
              text: `工具调用「${toolCall.name}」没有执行：回复因输出上限被截断，参数可能不完整。请补全参数后重新发起。`
            }
          ],
          details: {}
        }
      };
      await this.emit({
        type: "tool_execution_end",
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        result: outcome.result,
        isError: true
      });
      outcomes.push(outcome);
    }
    return outcomes;
  }

  private markPending(toolCallId: string, add: boolean): void {
    const pending = new Set(this.stateValue.pendingToolCalls);
    if (add) pending.add(toolCallId);
    else pending.delete(toolCallId);
    this.stateValue.pendingToolCalls = pending;
  }

  private async emitFailure(error: unknown, aborted: boolean): Promise<void> {
    const message: AssistantMessage = {
      role: "assistant",
      content: [{ type: "text", text: "" }],
      api: this.stateValue.model.api,
      provider: this.stateValue.model.provider,
      model: this.stateValue.model.id,
      usage: EMPTY_USAGE,
      stopReason: aborted ? "aborted" : "error",
      errorMessage: error instanceof Error ? error.message : String(error),
      timestamp: Date.now()
    };
    await this.emit({ type: "message_start", message });
    await this.emit({ type: "message_end", message });
    await this.emit({ type: "turn_end", message, toolResults: [] });
    await this.emit({ type: "agent_end", messages: [message] });
  }

  private async emit(event: AgentEvent): Promise<void> {
    const signal = this.activeRun?.abortController.signal;
    if (!signal) throw new Error("Agent listener invoked outside active run");
    for (const listener of this.listeners) await listener(event, signal);
  }
}

const EMPTY_USAGE: Usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
};

function abortError(): Error {
  const error = new Error("The agent run was aborted.");
  error.name = "AbortError";
  return error;
}

function toolResultMessage(outcome: AgentToolCallOutcome): ToolResultMessage {
  return {
    role: "toolResult",
    toolCallId: outcome.toolCall.id,
    toolName: outcome.toolCall.name,
    content: outcome.result.content,
    details: outcome.result.details as never,
    isError: outcome.isError,
    timestamp: Date.now()
  };
}

function toToolDeclaration(tool: AgentTool): Tool<TSchema> {
  return {
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters as TSchema
  };
}
