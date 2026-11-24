import { describe, expect, it, vi } from "vitest";
import {
  createHarnessSessionJournal,
  type HarnessSessionJournalEntry
} from "./session-journal";

describe("harness session journal seam", () => {
  it("records turn, tool, and compaction entries and forwards to sink", () => {
    const received: HarnessSessionJournalEntry[] = [];
    const sink = vi.fn((entry: HarnessSessionJournalEntry) =>
      received.push(entry)
    );
    const journal = createHarnessSessionJournal(sink);

    journal.record({
      kind: "turn_started",
      sessionId: "sess-1",
      turnIndex: 1,
      messageCount: 2,
      timestamp: 100
    });
    journal.record({
      kind: "tool_settled",
      sessionId: "sess-1",
      turnIndex: 1,
      toolCallId: "call-1",
      toolName: "load_skill",
      isError: false,
      timestamp: 120
    });
    journal.record({
      kind: "compaction_applied",
      sessionId: "sess-1",
      beforeMessages: 24,
      afterMessages: 8,
      timestamp: 150
    });

    expect(sink).toHaveBeenCalledTimes(3);
    expect(journal.entries()).toEqual(received);
    journal.clear();
    expect(journal.entries()).toEqual([]);
  });
});
