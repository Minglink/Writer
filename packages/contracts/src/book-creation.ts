import { EnvelopeBaseSchema } from "./envelope";
import { z } from "zod";
/** Build creation inputs with the catalog's existing schema instances. */
export function createBookCreationSchema<
  CharacterFormat extends z.ZodType,
  StageId extends z.ZodType,
  MaterialLinks extends z.ZodType,
  SkillLinks extends z.ZodType,
  Genre extends z.ZodType
>(
  schemas: {
    title: z.ZodString;
    characterFormat: CharacterFormat;
    stageId: StageId;
    stageLimit: number;
    materialLinks: MaterialLinks;
    skillLinks: SkillLinks;
  },
  genre: Genre
) {
  const defaultPlotStageIds = z
    .array(schemas.stageId)
    .min(1)
    .max(schemas.stageLimit)
    .refine((ids) => new Set(ids).size === ids.length, "剧情阶段不能重复");
  return z.object({
    title: schemas.title,
    characterFormat: schemas.characterFormat.optional(),
    defaultPlotStageIds: defaultPlotStageIds.optional(),
    linkedMaterialIdsByKind: schemas.materialLinks.optional(),
    linkedSkillIdsByKind: schemas.skillLinks.optional(),
    genre
  });
}

export function createShortBookCreationSchema<
  CharacterFormat extends z.ZodType,
  StageId extends z.ZodType,
  MaterialLinks extends z.ZodType,
  SkillLinks extends z.ZodType,
  Genre extends z.ZodType
>(
  schemas: {
    title: z.ZodString;
    characterFormat: CharacterFormat;
    stageId: StageId;
    stageLimit: number;
    materialLinks: MaterialLinks;
    skillLinks: SkillLinks;
  },
  genre: Genre
) {
  return createBookCreationSchema(schemas, genre).extend({
    pacingMode: z.enum(["viral_short", "refined_short"]).optional(),
    tropes: z.array(z.string().trim().min(1).max(32)).max(6).optional()
  });
}

/** Keep nested command schema construction out of the Renderer startup graph. */
export function createBookCreationEnvelope<
  Type extends string,
  Payload extends z.ZodType
>(type: Type, payload: Payload) {
  return EnvelopeBaseSchema.extend({ type: z.literal(type), payload });
}
export function createBookAtPathSchema<Input extends z.ZodType>(input: Input) {
  return z.object({ parentDirectory: z.string().trim().min(1), input });
}
