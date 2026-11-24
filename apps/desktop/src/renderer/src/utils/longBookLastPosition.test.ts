import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  extractWritingAnchor,
  extractWritingAnchorExcerpt,
  loadLongWritingPosition,
  loadRememberedLongBookSelection,
  rememberLongBookSelection,
  rememberLongWritingPosition,
  resolveWritingPositionOffset
} from "./longBookLastPosition";

describe("long book last selection persistence", () => {
  const storage = new Map<string, string>();

  beforeEach(() => {
    storage.clear();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => {
          storage.set(key, value);
        }
      }
    });
  });

  it("remembers and restores the last edited chapter per book", () => {
    rememberLongBookSelection("book-1", {
      key: "chapter:ch-2",
      chapterCardId: "ch-2" as never,
      preferredRole: "body" as never
    } as never);
    rememberLongBookSelection("book-2", {
      key: "chapter:ch-9",
      chapterCardId: "ch-9" as never,
      preferredRole: "card" as never
    } as never);

    expect(loadRememberedLongBookSelection("book-1")).toEqual({
      key: "chapter:ch-2",
      chapterCardId: "ch-2",
      preferredRole: "body"
    });
    expect(loadRememberedLongBookSelection("book-2")?.chapterCardId).toBe(
      "ch-9"
    );
    expect(loadRememberedLongBookSelection("book-unknown")).toBeNull();
  });

  it("persists writing position independently of browsing selection and relocates after edits", () => {
    const docText = "雨夜里她停在廊下，盯着信封上的蓝印迟迟没有拆开。";
    const cursor = docText.indexOf("信封上的蓝印");
    rememberLongWritingPosition({
      bookId: "book-1",
      chapterCardId: "ch-12" as never,
      fileId: "file-ch12-body" as never,
      title: "第十二章",
      selectionStart: cursor,
      selectionEnd: cursor,
      scrollTop: 320,
      anchorExcerpt: extractWritingAnchorExcerpt(docText, cursor),
      updatedAt: "2026-11-25T00:00:00.000Z"
    });

    // Browsing chapter 7 does NOT overwrite the persisted writing position.
    rememberLongBookSelection("book-1", {
      key: "chapter:ch-7",
      chapterCardId: "ch-7" as never,
      preferredRole: "body" as never
    } as never);

    const savedPos = loadLongWritingPosition("book-1");
    expect(savedPos?.chapterCardId).toBe("ch-12");
    expect(savedPos?.scrollTop).toBe(320);

    // Relocate after new paragraph is inserted before the edited paragraph.
    const editedDoc = `新插入的前情段落。\n\n${docText}`;
    const relocated = resolveWritingPositionOffset(editedDoc, savedPos!);
    expect(relocated.foundAnchor).toBe(true);
    expect(relocated.relocated).toBe(true);
    expect(relocated.start).toBeGreaterThan(cursor);

    // Graceful fallback when original paragraph is deleted.
    const fallback = resolveWritingPositionOffset(
      "完全重写的新正文。",
      savedPos!
    );
    expect(fallback.foundAnchor).toBe(false);
    expect(fallback.start).toBeLessThanOrEqual("完全重写的新正文。".length);
  });

  it("restores exact cursor offset near the start of a long document without drifting to excerpt midpoint", () => {
    const longDoc = `${"第一章开头十二字内容测试。"}后面还有超过一百字的连续正文描述用来填满锚点窗口确保不会截短。`;
    const exactOffset = 12;
    const anchor = extractWritingAnchor(longDoc, exactOffset);
    const unchanged = resolveWritingPositionOffset(longDoc, {
      selectionStart: exactOffset,
      selectionEnd: exactOffset,
      anchorExcerpt: anchor.excerpt,
      anchorOffsetInExcerpt: anchor.offsetInExcerpt
    });
    expect(unchanged).toEqual({
      start: 12,
      end: 12,
      relocated: false,
      foundAnchor: true
    });

    const prefix = "前面新增了十个字的段落。";
    const moved = resolveWritingPositionOffset(`${prefix}${longDoc}`, {
      selectionStart: exactOffset,
      selectionEnd: exactOffset,
      anchorExcerpt: anchor.excerpt,
      anchorOffsetInExcerpt: anchor.offsetInExcerpt
    });
    expect(moved.foundAnchor).toBe(true);
    expect(moved.relocated).toBe(true);
    expect(moved.start).toBe(prefix.length + exactOffset);
  });
});
