import { z } from "zod";
import {
  LongBookIdSchema,
  LongChapterCardIdSchema,
  LongFileIdSchema
} from "./long-workspace";

export const LONG_CHAPTER_NOTES_PATH = "long/chapter-notes.json";
export const LONG_CHAPTER_NOTES_SCHEMA_VERSION = 1 as const;
export const LONG_CHAPTER_NOTES_MAX_PER_BOOK = 500;
export const LONG_CHAPTER_NOTE_MAX_CHARS = 2_000;
export const LONG_CHAPTER_NOTE_QUOTE_MAX_CHARS = 240;
export const LONG_CHAPTER_NOTE_CONTEXT_MAX_CHARS = 80;

export const LongChapterNoteIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-zA-Z0-9_-]+$/u, "笔记 ID 只能包含字母、数字、下划线或短横线。");
export type LongChapterNoteId = z.infer<typeof LongChapterNoteIdSchema>;

export const LongChapterNoteQuoteSchema = z
  .object({
    fileId: LongFileIdSchema,
    excerpt: z.string().trim().min(1).max(LONG_CHAPTER_NOTE_QUOTE_MAX_CHARS),
    prefixContext: z
      .string()
      .max(LONG_CHAPTER_NOTE_CONTEXT_MAX_CHARS)
      .default(""),
    suffixContext: z
      .string()
      .max(LONG_CHAPTER_NOTE_CONTEXT_MAX_CHARS)
      .default(""),
    offset: z.number().int().min(0),
    sourceUpdatedAt: z.string().min(1).max(64).optional()
  })
  .strict();
export type LongChapterNoteQuote = z.infer<typeof LongChapterNoteQuoteSchema>;

export const LongChapterNoteSchema = z
  .object({
    id: LongChapterNoteIdSchema,
    chapterCardId: LongChapterCardIdSchema,
    content: z.string().trim().min(1).max(LONG_CHAPTER_NOTE_MAX_CHARS),
    quote: LongChapterNoteQuoteSchema.optional(),
    createdAt: z.string().min(1).max(64),
    updatedAt: z.string().min(1).max(64)
  })
  .strict();
export type LongChapterNote = z.infer<typeof LongChapterNoteSchema>;

export const LongChapterNotesFileSchema = z.object({
  version: z.literal(LONG_CHAPTER_NOTES_SCHEMA_VERSION),
  notes: z.array(LongChapterNoteSchema).max(LONG_CHAPTER_NOTES_MAX_PER_BOOK)
});
export type LongChapterNotesFile = z.infer<typeof LongChapterNotesFileSchema>;

export const LongReadChapterNotesInputSchema = z
  .object({
    bookId: LongBookIdSchema
  })
  .strict();
export type LongReadChapterNotesInput = z.infer<
  typeof LongReadChapterNotesInputSchema
>;

export const LongReadChapterNotesResultSchema = z
  .object({
    bookId: LongBookIdSchema,
    notes: z.array(LongChapterNoteSchema).max(LONG_CHAPTER_NOTES_MAX_PER_BOOK),
    revision: z.string().max(128)
  })
  .strict();
export type LongReadChapterNotesResult = z.infer<
  typeof LongReadChapterNotesResultSchema
>;

export const LongWriteChapterNotesInputSchema = z
  .object({
    bookId: LongBookIdSchema,
    notes: z.array(LongChapterNoteSchema).max(LONG_CHAPTER_NOTES_MAX_PER_BOOK),
    expectedRevision: z.string().max(128).optional()
  })
  .strict();
export type LongWriteChapterNotesInput = z.infer<
  typeof LongWriteChapterNotesInputSchema
>;

export const LongWriteChapterNotesResultSchema = z
  .object({
    bookId: LongBookIdSchema,
    notes: z.array(LongChapterNoteSchema).max(LONG_CHAPTER_NOTES_MAX_PER_BOOK),
    revision: z.string().max(128)
  })
  .strict();
export type LongWriteChapterNotesResult = z.infer<
  typeof LongWriteChapterNotesResultSchema
>;
