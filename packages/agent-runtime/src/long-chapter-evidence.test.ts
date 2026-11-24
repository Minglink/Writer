import { describe, expect, it } from "vitest";
import { PiAgentRuntimeAdapter } from "./adapter";
import { assembleLongChapterEvidence } from "./long-chapter-evidence-assembler";
import { selectApplicableContinuityCheckpoint } from "./long-chapter-continuity-selector";
import { resolveLongChapterEvidenceTarget } from "./long-chapter-evidence-target";
import { rehydrateWorkspaceContext } from "./workspace-context-recovery";
import {
  REWRITTEN_CH17_TS,
  createSyntheticLongBook,
  createSyntheticLongCommandExecutor,
  createSyntheticLongProfile,
  createSyntheticRuntimeContext
} from "./long-memory-eval/synthetic-book";
import type { AgentRunInput, AgentRuntimeEvent } from "./runtime-types";

function makeInput(
  overrides: Partial<AgentRunInput> = {},
  book = createSyntheticLongBook()
): { input: AgentRunInput; book: ReturnType<typeof createSyntheticLongBook> } {
  const profile = overrides.longAgentProfile ?? createSyntheticLongProfile();
  const input: AgentRunInput = {
    runId: "run_test_p1",
    sessionId: "session_test_p1",
    prompt: "请按章卡起稿第19章开头。",
    thinkingLevel: "off",
    longAgentProfile: profile,
    longCommandExecutor: createSyntheticLongCommandExecutor(book),
    workspaceContext: {
      longWorkspace: createSyntheticRuntimeContext(book, {
        activeRoot: "draft",
        activeChapterCardId: "chapter_19",
        profile
      })
    },
    ...overrides
  };
  return { input, book };
}

describe("P1 single-chapter target resolution", () => {
  it("resolves explicit chapter targets even when referencing an earlier chapter", () => {
    const book = createSyntheticLongBook({ rewriteChapter17: true });
    const { input } = makeInput(
      {
        prompt: "我刚重写了第17章结尾，请据此回改第18章开头衔接。",
        workspaceContext: {
          longWorkspace: createSyntheticRuntimeContext(book, {
            activeRoot: "draft",
            activeChapterCardId: "chapter_18"
          })
        }
      },
      book
    );
    expect(resolveLongChapterEvidenceTarget(input, book.index)).toEqual({
      kind: "resolved",
      chapterCardId: "chapter_18",
      chapterTitle: "第18章 雾中对质",
      intent: "in_chapter_revision",
      source: "explicit"
    });
  });

  it("falls back to none for multi-chapter comparisons, book-wide planning, and read-only modes", () => {
    const book = createSyntheticLongBook();
    const compare = makeInput(
      { prompt: "对比第17章和第18章的节奏差异。" },
      book
    );
    expect(
      resolveLongChapterEvidenceTarget(compare.input, book.index).kind
    ).toBe("none");

    const outline = makeInput({ prompt: "帮我梳理全书大纲和伏笔线。" }, book);
    expect(
      resolveLongChapterEvidenceTarget(outline.input, book.index).kind
    ).toBe("none");

    const brainstorm = makeInput(
      { prompt: "请起稿第19章开头", coCreationMode: "brainstorm" },
      book
    );
    expect(
      resolveLongChapterEvidenceTarget(brainstorm.input, book.index).kind
    ).toBe("none");
  });

  it("reports a conflict when rewrite co-creation focus disagrees with an explicit chapter", () => {
    const book = createSyntheticLongBook();
    const { input } = makeInput(
      {
        prompt: "回改第18章开头",
        coCreationMode: "try_rewrite",
        workspaceContext: {
          longWorkspace: createSyntheticRuntimeContext(book, {
            activeRoot: "draft",
            activeChapterCardId: "chapter_16"
          })
        }
      },
      book
    );
    expect(resolveLongChapterEvidenceTarget(input, book.index)).toMatchObject({
      kind: "conflict",
      explicitChapterId: "chapter_18",
      focusChapterId: "chapter_16"
    });
  });
});

describe("P1 batch-safe continuity checkpoint selection", () => {
  it("ignores covering batch checkpoint handoff for an intermediate chapter", () => {
    const book = createSyntheticLongBook();
    const selection = selectApplicableContinuityCheckpoint(
      book.index,
      "chapter_16"
    )!;
    expect(selection.coveringBatchCommit?.commit.id).toBe("commit_b2");
    expect(selection.coveringBatchCommit?.checkpointChapterCardId).toBe(
      "chapter_17"
    );
    expect(selection.priorCheckpoint?.commit.id).toBe("commit_b1");
    expect(selection.priorCheckpoint?.checkpoint.chapterCardId).toBe(
      "chapter_05"
    );
    expect(selection.latestWrittenPrior?.chapterCardId).toBe("chapter_15");
  });

  it("marks prior checkpoint stale when a committed chapter body was rewritten", () => {
    const book = createSyntheticLongBook({ rewriteChapter17: true });
    const selection = selectApplicableContinuityCheckpoint(
      book.index,
      "chapter_18"
    )!;
    expect(selection.priorCheckpoint?.commit.id).toBe("commit_b2");
    expect(selection.priorCheckpoint?.staleDueToBodyChanges).toBe(true);
    expect(selection.priorCheckpoint?.changedChapterIds).toEqual([
      "chapter_17"
    ]);
    expect(selection.priorCheckpoint?.handoffUsable).toBe(false);
  });

  it("records unwritten prior chapter gaps and finds the closest written chapter", () => {
    const book = createSyntheticLongBook();
    const selection = selectApplicableContinuityCheckpoint(
      book.index,
      "chapter_21"
    )!;
    expect(selection.unwrittenGapChapterIds).toEqual([
      "chapter_19",
      "chapter_20"
    ]);
    expect(selection.latestWrittenPrior?.chapterCardId).toBe("chapter_18");
  });
});

describe("P1 evidence assembler, permissions, cancellation, recovery, and snapshot replacement", () => {
  it("respects readableRoots permissions and omits unreadable sources", async () => {
    const book = createSyntheticLongBook();
    const plotOnlyProfile = createSyntheticLongProfile(["plot_design"]);
    const { input } = makeInput(
      {
        longAgentProfile: plotOnlyProfile,
        workspaceContext: {
          longWorkspace: createSyntheticRuntimeContext(book, {
            activeRoot: "draft",
            activeChapterCardId: "chapter_19",
            profile: plotOnlyProfile
          })
        }
      },
      book
    );
    const assembled = await assembleLongChapterEvidence(input);
    expect(assembled?.kind).toBe("evidence");
    expect(assembled?.sources.map((s) => s.document)).toEqual(["card"]);
    expect(assembled?.text).not.toContain("逼老船长交出缺失的页码");
  });

  it("aborts cleanly when signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort(new Error("cancelled"));
    const { input } = makeInput({ signal: controller.signal });
    await expect(
      assembleLongChapterEvidence(input, { signal: controller.signal })
    ).rejects.toThrow();
  });

  it("unifies post-compaction rehydration for blank chapters and rewritten prior chapters", async () => {
    const book = createSyntheticLongBook({ rewriteChapter17: true });
    const { input } = makeInput(
      {
        workspaceContext: {
          longWorkspace: createSyntheticRuntimeContext(book, {
            activeRoot: "draft",
            activeChapterCardId: "chapter_19"
          })
        }
      },
      book
    );
    const rehydrated = await rehydrateWorkspaceContext(
      input,
      "long",
      { read: [], proposed: [], skills: [], materials: [] },
      2_000
    );
    expect(rehydrated).toBeDefined();
    expect(rehydrated).toContain("chapter_19/card");
    expect(rehydrated).toContain("chapter_18/body");
    expect(rehydrated).toContain("逼老船长交出缺失的页码");
  });

  it("never injects a future focus chapter during compaction recovery when prompt targets an earlier chapter", async () => {
    const book = createSyntheticLongBook({ rewriteChapter17: true });
    const { input } = makeInput(
      {
        prompt: "请回改第18章雨夜对峙，不要写破周明远的幕后身份。",
        workspaceContext: {
          longWorkspace: createSyntheticRuntimeContext(book, {
            activeRoot: "draft",
            activeChapterCardId: "chapter_80"
          })
        }
      },
      book
    );
    const rehydrated = await rehydrateWorkspaceContext(
      input,
      "long",
      { read: [], proposed: [], skills: [], materials: [] },
      2_000
    );
    expect(rehydrated).toBeDefined();
    expect(rehydrated).toContain("chapter_18/body");
    expect(rehydrated).not.toContain("chapter_80/body");
    expect(rehydrated).not.toContain("周明远才是当年沉船案的真正幕后主使");
  });

  it("handles multi-chapter requests as on-demand and supports English single-chapter write prompts", () => {
    const book = createSyntheticLongBook();
    const multi = resolveLongChapterEvidenceTarget(
      makeInput({ prompt: "请续写第17章和第18章。" }, book).input,
      book.index
    );
    expect(multi.kind).toBe("none");

    const english = resolveLongChapterEvidenceTarget(
      makeInput({ prompt: "Write the opening of chapter 18." }, book).input,
      book.index
    );
    expect(english.kind).toBe("resolved");
    if (english.kind === "resolved") {
      expect(english.chapterCardId).toBe("chapter_18");
    }
  });

  it("replaces superseded chapter snapshots when switching chapters in a hot conversation", async () => {
    const book = createSyntheticLongBook({ rewriteChapter17: true });
    const profile = createSyntheticLongProfile();
    const executor = createSyntheticLongCommandExecutor(book);
    const runtime = new PiAgentRuntimeAdapter({
      evaluationMode: true,
      tokensPerSecond: 0
    });
    const sessionId = "session_hot_chapter_switch";

    // Turn 1: draft chapter 19
    for await (const _event of runtime.start({
      runId: "run_turn_1",
      sessionId,
      prompt: "请起稿第19章开头。",
      thinkingLevel: "off",
      longAgentProfile: profile,
      longCommandExecutor: executor,
      workspaceContext: {
        longWorkspace: createSyntheticRuntimeContext(book, {
          activeRoot: "draft",
          activeChapterCardId: "chapter_19",
          profile
        })
      },
      contextCompactionSettings: { enabled: true, budgetTokens: 128_000 }
    })) {
      void _event;
    }

    // Turn 2: switch to chapter 18 revision in the same hot session
    const turn2Events: AgentRuntimeEvent[] = [];
    for await (const event of runtime.start({
      runId: "run_turn_2",
      sessionId,
      prompt: "回改第18章开头，衔接第17章最新结尾。",
      thinkingLevel: "off",
      longAgentProfile: profile,
      longCommandExecutor: executor,
      workspaceContext: {
        longWorkspace: createSyntheticRuntimeContext(book, {
          activeRoot: "draft",
          activeChapterCardId: "chapter_18",
          profile
        })
      },
      contextCompactionSettings: { enabled: true, budgetTokens: 128_000 }
    })) {
      turn2Events.push(event);
    }

    const snapshots = turn2Events.filter(
      (
        e
      ): e is Extract<
        AgentRuntimeEvent,
        { type: "agent.evaluation_snapshot" }
      > => e.type === "agent.evaluation_snapshot"
    );
    const opening = snapshots[0]!.payload.snapshot;
    expect(opening.runtimeContext.text).toContain("chapter_18");
    expect(opening.runtimeContext.text).toContain("塞进锈迹斑斑的灯笼底座");
    expect(opening.runtimeContext.text).toContain(REWRITTEN_CH17_TS);
    const historyText = (opening.conversationHistory ?? [])
      .map((m) => `${m.role}:${m.text}`)
      .join("\n---\n");
    expect(historyText).toContain(
      "较早轮次的单章取证快照（chapter_19）已被本轮（chapter_18）最新快照替换"
    );
    expect(historyText).toContain("请起稿第19章开头。");
  });
});
