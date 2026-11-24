import type {
  AgentEvent,
  AgentLoopTurnUpdate,
  AgentMessage,
  AgentState,
  AgentTurnContext,
  AgentTurnDecision,
  QueueMode,
  StreamFn
} from "@earendil-works/pi-agent-core";

/** Loose hook shape: both implementations differ only in param types. */
type LoopHook = (...args: never[]) => unknown;

/**
 * The agent surface the kernel, retry coordinator, steering and guards drive.
 * Both the pi agent class and the harness-backed {@link LoopAgent} satisfy it,
 * which keeps tests on either implementation valid.
 */
export interface AgentSurface {
  readonly state: AgentState;
  readonly signal: AbortSignal | undefined;
  sessionId?: string | undefined;
  steeringMode?: QueueMode;
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
  streamFunction: StreamFn;
  toolExecution: string;
  beforeToolCall?: LoopHook | undefined;
  afterToolCall?: LoopHook | undefined;
  followUp(message: AgentMessage): void;
  subscribe(
    listener: (event: AgentEvent, signal: AbortSignal) => Promise<void> | void
  ): () => void;
  steer(message: AgentMessage): void;
  clearSteeringQueue(): void;
  abort(): void;
  prompt(input: AgentMessage | AgentMessage[] | string): Promise<void>;
  continue(): Promise<void>;
}
