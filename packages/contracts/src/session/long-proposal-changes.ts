import { z } from "zod";
import {
  LongChapterCardIdSchema,
  LongFileIdSchema,
  LongProjectRelativePathSchema
} from "../long-workspace";

export const LONG_MUTATION_REVIEW_TARGET_KINDS = [
  "worldbuilding_category",
  "worldbuilding_item",
  "character",
  "character_overview",
  "book_line",
  "volume",
  "arc",
  "story_plot",
  "chapter_card",
  "story_event",
  "event_connection",
  "narrative_placement",
  "foreshadowing",
  "foreshadowing_beat",
  "continuity_file",
  "agents_md"
] as const;
export const LongMutationReviewTargetKindSchema = z.enum(
  LONG_MUTATION_REVIEW_TARGET_KINDS
);
export type LongMutationReviewTargetKind = z.infer<
  typeof LongMutationReviewTargetKindSchema
>;

export const LongMutationContentChangeSchema = z
  .object({
    fileId: LongFileIdSchema.optional(),
    filePath: z
      .union([LongProjectRelativePathSchema, z.literal("AGENTS.md")])
      .optional(),
    operation: z.enum(["create", "write", "edit"]),
    beforeText: z.string().max(10_000_000),
    afterText: z.string().max(10_000_000),
    baseRevision: z.string().trim().min(1).max(160).optional()
  })
  .strict();
export type LongMutationContentChange = z.infer<
  typeof LongMutationContentChangeSchema
>;

export const LongMutationReviewSchema = z
  .object({
    targetKey: z.string().trim().min(1).max(320),
    targetKind: LongMutationReviewTargetKindSchema,
    targetId: z.string().trim().min(1).max(200),
    action: z.enum(["create", "edit", "meta", "delete"]),
    title: z.string().trim().min(1).max(600),
    content: LongMutationContentChangeSchema.optional()
  })
  .strict();
export type LongMutationReview = z.infer<typeof LongMutationReviewSchema>;

export const LongWorldbuildingFileChangeSchema = z
  .object({
    categoryId: z.string().trim().min(3).max(160),
    itemId: z.string().trim().min(3).max(160).optional(),
    fileId: LongFileIdSchema,
    filePath: LongProjectRelativePathSchema,
    title: z.string().trim().min(1).max(256),
    operation: z.enum(["create", "write", "edit"]),
    beforeText: z.string().max(1_000_000),
    afterText: z.string().max(1_000_000)
  })
  .strict();
export type LongWorldbuildingFileChange = z.infer<
  typeof LongWorldbuildingFileChangeSchema
>;

export const LONG_CHARACTER_DOCUMENTS = [
  "core_profile",
  "relationships"
] as const;
export const LongCharacterDocumentSchema = z.enum(LONG_CHARACTER_DOCUMENTS);
export type LongCharacterDocument = z.infer<typeof LongCharacterDocumentSchema>;

/** Stage-level overview is proposed alongside character file changes. */
export const LONG_CHARACTER_OVERVIEW_CHANGE_ID = "characters_overview" as const;
export const LONG_CHARACTER_FILE_CHANGE_DOCUMENTS = [
  ...LONG_CHARACTER_DOCUMENTS,
  "overview"
] as const;
export const LongCharacterFileChangeDocumentSchema = z.enum(
  LONG_CHARACTER_FILE_CHANGE_DOCUMENTS
);
export type LongCharacterFileChangeDocument = z.infer<
  typeof LongCharacterFileChangeDocumentSchema
>;

export const LongCharacterFileChangeSchema = z
  .object({
    characterId: z.string().trim().min(3).max(160),
    characterName: z.string().trim().min(1).max(256),
    document: LongCharacterFileChangeDocumentSchema,
    fileId: LongFileIdSchema,
    filePath: LongProjectRelativePathSchema,
    title: z.string().trim().min(1).max(256),
    operation: z.enum(["create", "write", "edit"]),
    beforeText: z.string().max(1_000_000),
    afterText: z.string().max(1_000_000)
  })
  .strict()
  .superRefine((value, context) => {
    if (value.document === "overview") {
      if (value.characterId !== LONG_CHARACTER_OVERVIEW_CHANGE_ID) {
        context.addIssue({
          code: "custom",
          path: ["characterId"],
          message:
            "Character overview changes must use the stage-level overview id."
        });
      }
      return;
    }
    if (value.characterId === LONG_CHARACTER_OVERVIEW_CHANGE_ID) {
      context.addIssue({
        code: "custom",
        path: ["characterId"],
        message:
          "Stage-level overview id is reserved for character overview changes."
      });
    }
  });
export type LongCharacterFileChange = z.infer<
  typeof LongCharacterFileChangeSchema
>;

export const LongChapterBodyChangeSchema = z
  .object({
    chapterCardId: LongChapterCardIdSchema,
    chapterTitle: z.string().trim().min(1).max(256),
    fileId: LongFileIdSchema,
    filePath: LongProjectRelativePathSchema,
    operation: z.enum(["create", "write", "edit"]),
    beforeText: z.string().max(10_000_000),
    afterText: z.string().max(10_000_000)
  })
  .strict();
export type LongChapterBodyChange = z.infer<typeof LongChapterBodyChangeSchema>;
