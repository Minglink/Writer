import { describe, expect, it, vi } from "vitest";
import {
  applyTextareaJumpAnchor,
  captureTextareaJumpAnchor,
  isJumpAnchorReturnable
} from "./longReadingJumpBack";

function createFakeTextarea(
  value: string,
  selectionStart = 0,
  selectionEnd = 0,
  scrollTop = 0
): HTMLTextAreaElement {
  const fake = {
    value,
    selectionStart,
    selectionEnd,
    scrollTop,
    focus: vi.fn(),
    setSelectionRange(start: number, end: number) {
      this.selectionStart = start;
      this.selectionEnd = end;
    }
  };
  return fake as unknown as HTMLTextAreaElement;
}

describe("longReadingJumpBack", () => {
  it("captures cursor range and scroll offset from a textarea", () => {
    const textarea = createFakeTextarea(
      "林砚摸到了口袋里那枚发凉的黄铜钥匙。",
      6,
      10,
      248.4
    );

    const anchor = captureTextareaJumpAnchor({
      bookId: "book-1",
      fileId: "draft:ch-1",
      title: "第一章 回潮",
      textarea
    });

    expect(anchor).toEqual({
      bookId: "book-1",
      fileId: "draft:ch-1",
      title: "第一章 回潮",
      selectionStart: 6,
      selectionEnd: 10,
      scrollTop: 248
    });
  });

  it("restores clamped cursor range, scroll offset, and focuses the textarea", () => {
    const textarea = createFakeTextarea("短文本", 0, 0, 0);

    const applied = applyTextareaJumpAnchor(textarea, {
      selectionStart: 99,
      selectionEnd: 120,
      scrollTop: 180
    });

    expect(applied).toBe(true);
    expect(textarea.focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(textarea.selectionStart).toBe(3);
    expect(textarea.selectionEnd).toBe(3);
    expect(textarea.scrollTop).toBe(180);
  });

  it("returns false when no textarea is mounted", () => {
    expect(
      applyTextareaJumpAnchor(null, {
        selectionStart: 2,
        selectionEnd: 2,
        scrollTop: 10
      })
    ).toBe(false);
  });

  it("checks whether the anchor is returnable for the active book and file", () => {
    const anchor = {
      bookId: "book-1",
      fileId: "draft:ch-1",
      title: "第一章",
      selectionStart: 12,
      selectionEnd: 12,
      scrollTop: 40
    };
    expect(isJumpAnchorReturnable(anchor, "book-1", "world:overview")).toBe(
      true
    );
    expect(isJumpAnchorReturnable(anchor, "book-1", "draft:ch-1")).toBe(false);
    expect(isJumpAnchorReturnable(anchor, "book-2", "world:overview")).toBe(
      false
    );
    expect(isJumpAnchorReturnable(null, "book-1", "world:overview")).toBe(
      false
    );
  });
});
