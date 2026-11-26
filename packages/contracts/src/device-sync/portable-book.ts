import { z } from "zod";
import { syncPathSchema } from "./schemas";

const id = z.string().min(1).max(512);
const title = z.string().min(1).max(256);
const timestamp = z.string().datetime();
const ids = z
  .array(id)
  .refine((values) => new Set(values).size === values.length);
const document = z
  .object({
    id,
    title,
    path: syncPathSchema.refine((v) => v.endsWith(".md")),
    createdAt: timestamp,
    updatedAt: timestamp
  })
  .strict();
const section = z
  .object({
    id,
    title,
    wordCountRequirement: z.string().max(1000),
    body: document,
    characterState: document,
    createdAt: timestamp,
    updatedAt: timestamp
  })
  .strict()
  .refine(
    (value) =>
      value.body.id === `draft-section:${value.id}:body` &&
      value.characterState.id === `draft-section:${value.id}:character-state`
  );
export const portableBookSchema = z
  .object({
    schemaVersion: z.literal(4),
    revision: z.number().int().nonnegative(),
    kind: z.literal("writer.book"),
    id,
    title,
    createdAt: timestamp,
    updatedAt: timestamp,
    bookType: z.enum(["short", "script"]),
    genre: z.enum([
      "世情",
      "追妻",
      "现代言情",
      "古代言情",
      "宫斗宅斗",
      "豪门世家",
      "青春甜宠",
      "虐恋情深",
      "复仇",
      "重生复仇",
      "真假千金",
      "年代",
      "种田",
      "现言脑洞",
      "古言脑洞",
      "悬疑恋爱",
      "都市",
      "都市脑洞",
      "战神赘婿",
      "玄幻",
      "奇幻仙侠",
      "历史",
      "悬疑",
      "悬疑脑洞",
      "悬疑灵异",
      "规则怪谈",
      "科幻",
      "科幻末世",
      "职场商战",
      "现实",
      "搞笑轻松",
      "其他"
    ]),
    pacingMode: z.enum(["viral_short", "refined_short"]).optional(),
    tropes: z.array(z.string().trim().min(1).max(32)).max(6).optional(),
    status: z.enum(["editing", "completed"]),
    linkedMaterialIdsByKind: z
      .object({
        character: ids,
        gimmick: ids,
        plot: ids,
        draft: ids,
        other: ids
      })
      .strict(),
    linkedSkillIdsByKind: z
      .object({ general: ids, plot: ids, style: ids, other: ids })
      .strict(),
    documents: z.array(document).max(4096),
    characterStructure: z.discriminatedUnion("format", [
      z.object({ format: z.literal("text") }).strict(),
      z
        .object({
          format: z.literal("list"),
          items: z
            .array(
              z
                .object({ id, title, order: z.number().int().positive() })
                .strict()
            )
            .max(4096)
        })
        .strict()
    ]),
    plotStages: z
      .array(
        z
          .object({
            id: id.max(120),
            title: title.max(120),
            description: z.string().min(1).max(20000),
            enabled: z.boolean()
          })
          .strict()
      )
      .min(1)
      .max(32),
    draft: z
      .object({
        id: z.literal("draft"),
        title,
        sections: z.array(section).min(1).max(100),
        createdAt: timestamp,
        updatedAt: timestamp
      })
      .strict(),
    draftSectionCreationOperations: z
      .array(
        z
          .object({
            operationId: id,
            requestHash: z.string().regex(/^[a-f0-9]{64}$/),
            sections: z
              .array(z.object({ clientSectionId: id, sectionId: id }).strict())
              .min(1)
              .max(100),
            createdAt: timestamp
          })
          .strict()
      )
      .max(256)
      .optional()
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.bookType === "script" &&
      (value.pacingMode !== undefined || value.tropes !== undefined)
    ) {
      context.addIssue({
        code: "custom",
        path: [value.pacingMode !== undefined ? "pacingMode" : "tropes"],
        message: "剧本作品不支持短篇网文定位字段。"
      });
    }
    const references = [
      ...value.documents,
      ...value.draft.sections.flatMap((entry) => [
        entry.body,
        entry.characterState
      ])
    ];
    const characterIds =
      value.characterStructure.format === "list"
        ? value.characterStructure.items.map((entry) => entry.id)
        : [];
    const required = [
      "character_design",
      ...characterIds,
      ...value.plotStages.map((entry) => entry.id)
    ];
    if (
      required.some(
        (key) => !value.documents.some((entry) => entry.id === key)
      ) ||
      new Set(references.map((entry) => entry.id)).size !== references.length ||
      new Set(references.map((entry) => entry.path)).size !==
        references.length ||
      !value.plotStages.some((entry) => entry.enabled) ||
      new Set(value.draft.sections.map((entry) => entry.id)).size !==
        value.draft.sections.length ||
      new Set(value.plotStages.map((entry) => entry.id)).size !==
        value.plotStages.length
    ) {
      context.addIssue({
        code: "custom",
        message: "作品包含重复或缺失的结构引用。"
      });
    }
  });
export type PortableBook = z.infer<typeof portableBookSchema>;
