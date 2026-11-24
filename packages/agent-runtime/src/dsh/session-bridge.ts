import { Context } from "@deepseek-ai/cordis";
import SessionStore, {
  SessionId,
  type Session,
  type SessionEvent
} from "@deepseek-ai/dsh-session";
import {
  createHarnessSessionJournal,
  type HarnessSessionJournal,
  type HarnessSessionJournalEntry
} from "./session-journal";

export interface HarnessSessionBridge {
  readonly session: Session;
  readonly journal: HarnessSessionJournal;
  readonly events: readonly SessionEvent[];
  flush(): Promise<boolean>;
  dispose(): Promise<void>;
}

/**
 * Mirrors {@link LoopAgent} turn and step lifecycle milestones into a live
 * Cordis `@deepseek-ai/dsh-session` {@link SessionStore} without freezing or
 * taking ownership of `AgentSurface.state.messages`.
 */
export async function createHarnessSessionBridge(
  sessionId?: string
): Promise<HarnessSessionBridge> {
  const ctx = new Context();
  await ctx.plugin(SessionStore);
  const published: SessionEvent[] = [];
  ctx.on("session/event", (_session, event) => {
    published.push(event);
  });

  const session = ctx.sessions.create(
    sessionId ? SessionId(sessionId) : undefined
  );
  let activeTurn: number | undefined;
  let stepCounter = 0;

  const sink = (entry: HarnessSessionJournalEntry): void => {
    if (entry.kind === "turn_started") {
      activeTurn = entry.turnIndex;
      stepCounter += 1;
      session.append([
        ["turn/start", { turn: entry.turnIndex }],
        ["step/start", { turn: entry.turnIndex, step: stepCounter }]
      ]);
      return;
    }
    if (entry.kind === "turn_finished") {
      const turn = activeTurn ?? entry.turnIndex;
      session.append([
        ["step/end", { turn, step: Math.max(1, stepCounter) }],
        ["turn/end", { turn, reason: { kind: "completed" } }]
      ]);
      activeTurn = undefined;
    }
  };

  const journal = createHarnessSessionJournal(sink);

  return {
    session,
    journal,
    get events() {
      return published.slice();
    },
    flush: () => ctx.sessions.flush(session),
    dispose: async () => {
      await ctx.fiber.dispose();
    }
  };
}
