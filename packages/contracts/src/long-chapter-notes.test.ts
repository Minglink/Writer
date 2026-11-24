import { describe, expect, it } from "vitest";
import {
  LONG_CHAPTER_NOTE_MAX_CHARS,
  LONG_CHAPTER_NOTES_MAX_PER_BOOK,
  LONG_CHAPTER_NOTES_SCHEMA_VERSION,
  LongChapterNoteSchema,
  LongChapterNotesFileSchema,
  LongWriteChapterNotesInputSchema
} from "./long-chapter-notes";

function makeNote(index: number) {
  return {
    id: `note_${index}`,
    chapterCardId: "chapter_12",
    content: "拆信时间待定，保留悬念。",
    createdAt: "2026-11-25T00:00:00.000Z",
    updatedAt: "2026-11-25T00:00:00.000Z"
  };
}

describe("long-chapter-notes contracts", () => {
  it("accepts a free note and a quote-anchored note within limits", () => {
    const valid = LongChapterNoteSchema.parse({
      ...makeNote(1),
      content: "a".repeat(LONG_CHAPTER_NOTE_MAX_CHARS),
      quote: {
        fileId: "file_ch12_body",
        excerpt: "信封上的蓝印已经有些褪色",
        prefixContext: "雨声敲打着玻璃窗。",
        suffixContext: "，但仍能辨认。",
        offset: 9,
        sourceUpdatedAt: "2026-11-25T00:00:00.000Z"
      }
    });
    expect(valid.id).toBe("note_1");
    expect(valid.quote?.offset).toBe(9);
  });

  it("rejects empty content, invalid id, and over-limit note content", () => {
    expect(() =>
      LongChapterNoteSchema.parse({ ...makeNote(1), content: "   " })
    ).toThrow();
    expect(() =>
      LongChapterNoteSchema.parse({ ...makeNote(1), id: "../bad" })
    ).toThrow();
    expect(() =>
      LongChapterNoteSchema.parse({
        ...makeNote(1),
        content: "a".repeat(LONG_CHAPTER_NOTE_MAX_CHARS + 1)
      })
    ).toThrow();
  });

  it("enforces exact book-level note count limit and rejects one over limit", () => {
    const exactNotes = Array.from(
      { length: LONG_CHAPTER_NOTES_MAX_PER_BOOK },
      (_, idx) => makeNote(idx)
    );
    expect(
      LongWriteChapterNotesInputSchema.parse({
        bookId: "longbook_1",
        notes: exactNotes
      }).notes
    ).toHaveLength(LONG_CHAPTER_NOTES_MAX_PER_BOOK);

    expect(() =>
      LongWriteChapterNotesInputSchema.parse({
        bookId: "longbook_1",
        notes: [...exactNotes, makeNote(LONG_CHAPTER_NOTES_MAX_PER_BOOK)]
      })
    ).toThrow();
  });

  it("accepts stored chapter-notes.json with unknown extra top-level keys for forward compatibility", () => {
    const parsed = LongChapterNotesFileSchema.parse({
      version: LONG_CHAPTER_NOTES_SCHEMA_VERSION,
      notes: [makeNote(1)],
      futureMetadata: { syncedAt: "2026-11-25T00:00:00.000Z" }
    });
    expect(parsed.notes).toHaveLength(1);
  });
});
