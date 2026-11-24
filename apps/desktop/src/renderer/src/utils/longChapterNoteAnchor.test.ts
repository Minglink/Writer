import { describe, expect, it } from "vitest";
import {
  captureChapterNoteQuote,
  resolveChapterNoteQuote
} from "./longChapterNoteAnchor";

describe("longChapterNoteAnchor", () => {
  const fileId = "file_ch12_body";

  it("locates an unmoved quote exactly", () => {
    const text = "雨声敲打着玻璃窗。信封上的蓝印已经有些褪色，但仍能辨认。";
    const start = text.indexOf("信封上的蓝印");
    const end = start + "信封上的蓝印".length;
    const quote = captureChapterNoteQuote({
      fileId,
      documentText: text,
      selectionStart: start,
      selectionEnd: end,
      sourceUpdatedAt: "2026-11-25T00:00:00.000Z"
    });
    expect(quote).not.toBeNull();
    const res = resolveChapterNoteQuote(text, quote!);
    expect(res).toEqual({
      status: "exact",
      start,
      end,
      shifted: false
    });
  });

  it("relocates a quote accurately after paragraphs are inserted before it", () => {
    const original = "他停下脚步。信封上的蓝印已经有些褪色，窗外雷声滚过。";
    const start = original.indexOf("信封上的蓝印");
    const end = start + "信封上的蓝印".length;
    const quote = captureChapterNoteQuote({
      fileId,
      documentText: original,
      selectionStart: start,
      selectionEnd: end
    })!;

    const edited = `新插入的第一段背景描写，足足多出几十个字。\n\n${original}`;
    const res = resolveChapterNoteQuote(edited, quote);
    expect(res.status).toBe("exact");
    if (res.status === "exact") {
      expect(res.shifted).toBe(true);
      expect(edited.slice(res.start, res.end)).toBe("信封上的蓝印");
    }
  });

  it("disambiguates repeated quotes using surrounding context, and flags truly ambiguous duplicates", () => {
    const original = "走廊尽头，她低声说：「别回头。」随后推开了铁门。";
    const start = original.indexOf("别回头。");
    const end = start + "别回头。".length;
    const quote = captureChapterNoteQuote({
      fileId,
      documentText: original,
      selectionStart: start,
      selectionEnd: end
    })!;

    const withContextDistinction = `另一处完全不同的场景里，有人喊着别回头。\n\n${original}`;
    const resolved = resolveChapterNoteQuote(withContextDistinction, quote);
    expect(resolved.status).toBe("exact");
    if (resolved.status === "exact") {
      expect(resolved.start).toBe(
        withContextDistinction.lastIndexOf("别回头。")
      );
    }

    const identicalDuplicates = `${original}\n\n${original}`;
    // Shift offset away so fast-path doesn't trigger
    const shiftedQuote = { ...quote, offset: 9999 };
    const ambiguous = resolveChapterNoteQuote(
      identicalDuplicates,
      shiftedQuote
    );
    expect(ambiguous.status).toBe("ambiguous");
    if (ambiguous.status === "ambiguous") {
      expect(ambiguous.matches).toHaveLength(2);
    }
  });

  it("returns missing when the quoted sentence is deleted", () => {
    const original = "信封上的蓝印已经有些褪色。";
    const quote = captureChapterNoteQuote({
      fileId,
      documentText: original,
      selectionStart: 0,
      selectionEnd: original.length
    })!;
    const edited = "桌面上空无一物，只剩一杯冷茶。";
    expect(resolveChapterNoteQuote(edited, quote)).toEqual({
      status: "missing"
    });
  });

  it("does not mis-anchor to a duplicate sentence inserted at the old offset", () => {
    const padding = "前情铺垫内容。".repeat(30);
    const originalSentence = "走廊尽头，她低声说：「别回头。」随后推开了铁门。";
    const doc = `${padding}${originalSentence}`;
    const start = doc.indexOf("别回头。");
    const end = start + "别回头。".length;
    const quote = captureChapterNoteQuote({
      fileId,
      documentText: doc,
      selectionStart: start,
      selectionEnd: end
    })!;

    // Insert a different sentence containing "别回头。" right at the old offset,
    // pushing the real sentence further down.
    const decoyAtOldOffset = "完全不同的陌生人喊了一声别回头。然后跑开了。\n\n";
    const edited = `${doc.slice(0, start - 12)}${decoyAtOldOffset}${doc.slice(start - 12)}`;
    const res = resolveChapterNoteQuote(edited, quote);
    expect(res.status).toBe("exact");
    if (res.status === "exact") {
      expect(res.start).toBe(edited.lastIndexOf("别回头。"));
      expect(res.shifted).toBe(true);
    }
  });

  it("clips emoji-heavy selections by UTF-16 code units without splitting surrogate pairs", () => {
    const emojis = "😀".repeat(125); // 250 UTF-16 code units > 240
    const quote = captureChapterNoteQuote({
      fileId,
      documentText: emojis,
      selectionStart: 0,
      selectionEnd: emojis.length
    })!;
    expect(quote.excerpt.length).toBeLessThanOrEqual(240);
    // Ensure no unpaired surrogate at the end
    const lastCode = quote.excerpt.charCodeAt(quote.excerpt.length - 1);
    expect(lastCode < 0xd800 || lastCode > 0xdbff).toBe(true);
  });
});
