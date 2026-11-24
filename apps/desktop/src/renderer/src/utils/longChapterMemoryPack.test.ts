import { describe, expect, it } from "vitest";
import type { LongWorkspaceIndexSnapshot } from "@writer/contracts";
import {
  BOOK_MEMORY_SNIPPETS,
  buildLongChapterMemorySummary
} from "./longChapterMemoryPack";

function makeSnapshot(): LongWorkspaceIndexSnapshot {
  return {
    bookId: "book-1",
    worldbuilding: [{ id: "w1" } as never],
    characters: [{ id: "c1" } as never, { id: "c2" } as never],
    plot: {
      volumes: [{ id: "v1", title: "第一卷", order: 1, summary: "" }],
      arcs: [],
      storyPlots: [],
      chapterCards: [
        {
          id: "ch1",
          volumeId: "v1",
          title: "第一章",
          narrativeOrder: 1,
          primaryArcId: null
        },
        {
          id: "ch2",
          volumeId: "v1",
          title: "第二章",
          narrativeOrder: 2,
          primaryArcId: null
        }
      ],
      foreshadowing: [
        { id: "f1", title: "黄铜钥匙的来历", status: "open" } as never,
        { id: "f2", title: "已回收的旧信", status: "resolved" } as never
      ]
    },
    chapters: [
      {
        chapterCardId: "ch1",
        bodyStatus: "written",
        commitId: "commit-1",
        card: { id: "file:ch1:card" },
        body: { id: "file:ch1:body" },
        characterState: { id: "file:ch1:state" },
        handoff: { id: "file:ch1:handoff" }
      } as never,
      {
        chapterCardId: "ch2",
        bodyStatus: "written",
        commitId: null,
        card: { id: "file:ch2:card" },
        body: { id: "file:ch2:body" },
        characterState: { id: "file:ch2:state" },
        handoff: { id: "file:ch2:handoff" }
      } as never
    ]
  } as unknown as LongWorkspaceIndexSnapshot;
}

describe("longChapterMemoryPack", () => {
  it("resolves previous handoff, current card, pending archive flag, and open foreshadowings", () => {
    const summary = buildLongChapterMemorySummary(makeSnapshot(), "ch2");
    expect(summary.currentChapterTitle).toBe("第二章");
    expect(summary.currentCardFileId).toBe("file:ch2:card");
    expect(summary.previousChapterTitle).toBe("第一章");
    expect(summary.previousHandoffFileId).toBe("file:ch1:handoff");
    expect(summary.isPendingArchive).toBe(true);
    expect(summary.isCommitted).toBe(false);
    expect(summary.openForeshadowings).toEqual([
      { id: "f1", title: "黄铜钥匙的来历", status: "open" }
    ]);
    expect(summary.characterCount).toBe(2);
    expect(summary.worldbuildingCategoryCount).toBe(1);
  });

  it("provides bilingual book memory template snippets", () => {
    expect(BOOK_MEMORY_SNIPPETS.length).toBeGreaterThanOrEqual(3);
    expect(BOOK_MEMORY_SNIPPETS[0]?.contentZh).toContain("文风与禁词");
  });
});
