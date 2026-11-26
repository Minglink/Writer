import { describe, expect, it } from "vitest";
import {
  DEFAULT_LONG_AGENTS_MD,
  DEFAULT_SHORT_WRITING_CONTEXT,
  LONG_AGENTS_MD_MAX_CHARACTERS,
  LONG_BOOK_GENRES,
  LongBookTropesSchema,
  SHORT_BOOK_GENRES,
  WRITING_CONTEXT_MAX_CHARACTERS,
  buildLongAgentsMdForGenre,
  buildShortWritingContextForWebNovel,
  createDefaultBookPlotStages,
  longAgentsMdCharacterCount,
  normalizeWebNovelTropes,
  portableBookSchema,
  resolveDefaultNarrativeDialsForGenre,
  resolveLongBookFrameworkPreset,
  writingContextCharacterCount
} from "./index";

describe("Chinese web-novel genre & trope frameworks", () => {
  it("resolves 7 tailored worldbuilding categories per genre family", () => {
    const palace = resolveLongBookFrameworkPreset("宫斗宅斗");
    expect(palace.id).toBe("romance_ancient");
    expect(palace.worldCategories).toHaveLength(7);
    expect(palace.worldCategories.map(([, title]) => title)).toContain(
      "宗族礼法与排雷"
    );

    const quickTrans = resolveLongBookFrameworkPreset("快穿");
    expect(quickTrans.id).toBe("quick_transmigration");
    expect(quickTrans.worldCategories).toHaveLength(7);
    expect(quickTrans.worldCategories.map(([, title]) => title)).toContain(
      "系统绑定与任务规则"
    );

    const rulesHorror = resolveLongBookFrameworkPreset("规则怪谈");
    expect(rulesHorror.id).toBe("suspense_horror");
    expect(rulesHorror.worldCategories).toHaveLength(7);
    expect(rulesHorror.worldCategories.map(([, title]) => title)).toContain(
      "表里规则与死线"
    );

    const farming = resolveLongBookFrameworkPreset("种田");
    expect(farming.id).toBe("period_farming");
    expect(farming.worldCategories).toHaveLength(7);
    expect(farming.worldCategories.map(([, title]) => title)).toContain(
      "时代政策与物价"
    );
  });

  it("injects pacing mode and trope execution rules into long AGENTS.md and short writing context within character budgets", () => {
    for (const genre of LONG_BOOK_GENRES) {
      const preset = resolveLongBookFrameworkPreset(genre);
      const ids = preset.worldCategories.map(([id]) => id);
      expect(ids).toHaveLength(7);
      expect(ids[0]).toBe("world_rules");
      expect(new Set(ids).size).toBe(7);

      const agentsMd = buildLongAgentsMdForGenre(
        DEFAULT_LONG_AGENTS_MD,
        genre,
        {
          pacingMode: "fanqie",
          tropes: ["穿书", "读心术", "追妻火葬场", "1v1双洁"]
        }
      );
      expect(agentsMd).toContain(`## 本书网文创作总纲（${genre}`);
      expect(agentsMd).toContain("番茄快节奏");
      expect(agentsMd).toContain("【读心术】");
      expect(longAgentsMdCharacterCount(agentsMd)).toBeLessThanOrEqual(
        LONG_AGENTS_MD_MAX_CHARACTERS
      );
    }

    const shortContext = buildShortWritingContextForWebNovel(
      DEFAULT_SHORT_WRITING_CONTEXT,
      "真假千金",
      {
        pacingMode: "viral_short",
        tropes: ["真假千金", "虐渣打脸"]
      }
    );
    expect(shortContext).toContain("## 本篇网文短篇框架（真假千金）");
    expect(shortContext).toContain("盐选/番茄爆款短篇");
    expect(shortContext).toContain("【真假千金】");
    expect(writingContextCharacterCount(shortContext)).toBeLessThanOrEqual(
      WRITING_CONTEXT_MAX_CHARACTERS
    );
  });

  it("keeps standalone device-sync portableBookSchema genres synchronized with SHORT_BOOK_GENRES", () => {
    expect(portableBookSchema.shape.genre.options).toEqual(SHORT_BOOK_GENRES);
  });

  it("sanitizes single-line trope/genre labels, deduplicates tropes, and truncates safely by Unicode code point", () => {
    const sanitized = buildLongAgentsMdForGenre(
      DEFAULT_LONG_AGENTS_MD,
      "都市高武\r\n# 注入标题",
      {
        pacingMode: "qidian",
        tropes: ["系统", "系统", "自定义流派\n## 注入二级标题", "   "]
      }
    );
    expect(sanitized).not.toContain("# 注入标题\n");
    expect(sanitized).not.toContain("\n## 注入二级标题");
    expect(sanitized).toContain("都市高武 # 注入标题");
    expect(sanitized.match(/【系统】/gu)).toHaveLength(1);

    const nearLimitBase = "🐉".repeat(LONG_AGENTS_MD_MAX_CHARACTERS - 40);
    const truncated = buildLongAgentsMdForGenre(nearLimitBase, "玄幻", {
      pacingMode: "fanqie",
      tropes: ["系统", "面板加点"]
    });
    expect(longAgentsMdCharacterCount(truncated)).toBeLessThanOrEqual(
      LONG_AGENTS_MD_MAX_CHARACTERS
    );
    expect(truncated).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/u);

    const overLimitShort = buildShortWritingContextForWebNovel(
      "界".repeat(WRITING_CONTEXT_MAX_CHARACTERS + 25),
      "规则怪谈",
      { pacingMode: "viral_short", tropes: ["规则怪谈"] }
    );
    expect(writingContextCharacterCount(overLimitShort)).toBe(
      WRITING_CONTEXT_MAX_CHARACTERS
    );
  });

  it("normalizes web-novel tropes with deduplication, whitespace cleanup, 6-tag cap, and surrogate-safe 32-unit slicing", () => {
    expect(normalizeWebNovelTropes(undefined)).toBeUndefined();
    expect(normalizeWebNovelTropes([])).toBeUndefined();
    expect(normalizeWebNovelTropes(["  ", "\n", "\r\n\0\t"])).toBeUndefined();

    expect(
      normalizeWebNovelTropes([
        "  真假\r\n千金  ",
        "虐渣\0\t  打脸",
        "真假 千金",
        "  穿书  ",
        "虐渣 打脸"
      ])
    ).toEqual(["真假 千金", "虐渣 打脸", "穿书"]);

    expect(
      normalizeWebNovelTropes([
        "标签1",
        "   ",
        "标签1",
        "标签2",
        "标签3",
        "标签4",
        "标签5",
        "标签6",
        "标签7",
        "标签8"
      ])
    ).toEqual(["标签1", "标签2", "标签3", "标签4", "标签5", "标签6"]);

    const sliced = normalizeWebNovelTropes([
      "🐉".repeat(20),
      `${"a".repeat(31)}🐉`,
      "汉".repeat(40)
    ]);
    expect(sliced).toEqual(["🐉".repeat(16), "a".repeat(31), "汉".repeat(32)]);
    for (const label of sliced ?? []) {
      expect(Array.from(label).length).toBeLessThanOrEqual(32);
      expect(label.length).toBeLessThanOrEqual(32);
      expect(label).not.toMatch(
        /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u
      );
    }
    expect(LongBookTropesSchema.parse(sliced)).toEqual(sliced);
  });

  it("accepts short positioning in portableBookSchema, keeps legacy v4 manifests compatible, and rejects script positioning", () => {
    const now = "2026-07-26T10:00:00.000Z";
    const plotStages = createDefaultBookPlotStages();
    const baseManifest = {
      schemaVersion: 4 as const,
      revision: 1,
      kind: "writer.book" as const,
      id: "portable_book_1",
      title: "便携测试作品",
      createdAt: now,
      updatedAt: now,
      bookType: "short" as const,
      genre: "真假千金" as const,
      status: "editing" as const,
      linkedMaterialIdsByKind: {
        character: [],
        gimmick: [],
        plot: [],
        draft: [],
        other: []
      },
      linkedSkillIdsByKind: {
        general: [],
        plot: [],
        style: [],
        other: []
      },
      characterStructure: { format: "text" as const },
      plotStages,
      documents: [
        {
          id: "character_design",
          title: "人物设计",
          path: "stages/character_design.md",
          createdAt: now,
          updatedAt: now
        },
        ...plotStages.map((stage) => ({
          id: stage.id,
          title: stage.title,
          path: `stages/${stage.id}.md`,
          createdAt: now,
          updatedAt: now
        }))
      ],
      draft: {
        id: "draft" as const,
        title: "正文",
        sections: [
          {
            id: "section-1",
            title: "第一节",
            wordCountRequirement: "",
            body: {
              id: "draft-section:section-1:body",
              title: "第一节",
              path: "stages/draft/section-1.body.md",
              createdAt: now,
              updatedAt: now
            },
            characterState: {
              id: "draft-section:section-1:character-state",
              title: "第一节 · 状态",
              path: "stages/draft/section-1.state.md",
              createdAt: now,
              updatedAt: now
            },
            createdAt: now,
            updatedAt: now
          }
        ],
        createdAt: now,
        updatedAt: now
      }
    };

    const parsedShort = portableBookSchema.parse({
      ...baseManifest,
      pacingMode: "viral_short",
      tropes: ["真假千金", "虐渣打脸"]
    });
    expect(parsedShort.pacingMode).toBe("viral_short");
    expect(parsedShort.tropes).toEqual(["真假千金", "虐渣打脸"]);

    const legacyShort = portableBookSchema.parse(baseManifest);
    expect(legacyShort.pacingMode).toBeUndefined();
    expect(legacyShort.tropes).toBeUndefined();

    const legacyScript = portableBookSchema.parse({
      ...baseManifest,
      bookType: "script",
      genre: "悬疑"
    });
    expect(legacyScript.bookType).toBe("script");
    expect(legacyScript.pacingMode).toBeUndefined();
    expect(legacyScript.tropes).toBeUndefined();

    expect(
      portableBookSchema.safeParse({
        ...baseManifest,
        bookType: "script",
        pacingMode: "viral_short"
      }).success
    ).toBe(false);
    expect(
      portableBookSchema.safeParse({
        ...baseManifest,
        bookType: "script",
        tropes: ["虐渣打脸"]
      }).success
    ).toBe(false);
  });

  it("supports universal narrative manifold dials and genre register defaults within AGENTS.md budget", () => {
    expect(resolveDefaultNarrativeDialsForGenre("科幻末世")).toEqual({
      lexiconRegister: "scifi_system",
      povMode: "third_limited",
      hookWaveform: "double_cliffhanger"
    });
    expect(resolveDefaultNarrativeDialsForGenre("种田")).toEqual({
      lexiconRegister: "slice_daily",
      povMode: "third_limited",
      hookWaveform: "harvest_milestone"
    });

    const agentsMd = buildLongAgentsMdForGenre(DEFAULT_LONG_AGENTS_MD, "悬疑", {
      pacingMode: "qidian",
      tropes: ["无限流"],
      narrativeDials: {
        lexiconRegister: "literary_realism",
        povMode: "first_person",
        hookWaveform: "revelation_echo",
        fusionTags: ["规则怪谈", "年代烟火"]
      }
    });
    expect(agentsMd).toContain("万书同源调音");
    expect(agentsMd).toContain("第一人称沉浸视角");
    expect(agentsMd).toContain("规则怪谈 + 年代烟火");
    expect(agentsMd).toContain("现实/出版语域");
    expect(agentsMd).toContain("口头提议、意向未交割与物理落袋三态");
    expect(longAgentsMdCharacterCount(agentsMd)).toBeLessThanOrEqual(
      LONG_AGENTS_MD_MAX_CHARACTERS
    );
  });
});
