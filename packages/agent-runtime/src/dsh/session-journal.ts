export type HarnessSessionJournalEntry =
  | {
      readonly kind: "turn_started";
      readonly sessionId: string | undefined;
      readonly turnIndex: number;
      readonly messageCount: number;
      readonly timestamp: number;
    }
  | {
      readonly kind: "assistant_completed";
      readonly sessionId: string | undefined;
      readonly turnIndex: number;
      readonly stopReason: string | undefined;
      readonly toolCallCount: number;
      readonly timestamp: number;
    }
  | {
      readonly kind: "tool_settled";
      readonly sessionId: string | undefined;
      readonly turnIndex: number;
      readonly toolCallId: string;
      readonly toolName: string;
      readonly isError: boolean;
      readonly timestamp: number;
    }
  | {
      readonly kind: "compaction_applied";
      readonly sessionId: string | undefined;
      readonly beforeMessages: number;
      readonly afterMessages: number;
      readonly timestamp: number;
    }
  | {
      readonly kind: "turn_finished";
      readonly sessionId: string | undefined;
      readonly turnIndex: number;
      readonly timestamp: number;
    };

export type HarnessSessionJournalSink = (
  entry: HarnessSessionJournalEntry
) => void;

export interface HarnessSessionJournal {
  record(entry: HarnessSessionJournalEntry): void;
  entries(): readonly HarnessSessionJournalEntry[];
  clear(): void;
}

/**
 * In-memory structured session journal aligned with the planned dsh-session
 * bridge. Records turn, tool, and compaction milestones without freezing or
 * owning `AgentState.messages`, preserving `AgentSurface` mutability.
 */
export function createHarnessSessionJournal(
  sink?: HarnessSessionJournalSink
): HarnessSessionJournal {
  const buffer: HarnessSessionJournalEntry[] = [];
  return {
    record(entry) {
      buffer.push(entry);
      sink?.(entry);
    },
    entries() {
      return buffer.slice();
    },
    clear() {
      buffer.length = 0;
    }
  };
}
