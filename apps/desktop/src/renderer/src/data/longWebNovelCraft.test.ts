import { describe, expect, it } from "vitest";
import { LONG_BOOK_GENRES } from "@writer/contracts/renderer";
import { locale } from "../i18n";
import {
  computeLongWorkflowSteps,
  resolveWebNovelCraftSkills,
  resolveWebNovelGenreBlueprint
} from "./longWebNovelCraft";

describe("long-form web-novel craft workflow & blueprints", () => {
  it("provides genre-specific launch blueprints for web-novel categories", () => {
    const xuanhuan = resolveWebNovelGenreBlueprint("玄幻");
    expect(xuanhuan.hookFocus).toContain("金手指");
    expect(xuanhuan.settingPillars).toContain("境界");

    const suspense = resolveWebNovelGenreBlueprint("悬疑");
    expect(suspense.hookFocus).toContain("谜面");

    const fallback = resolveWebNovelGenreBlueprint("自定义题材");
    expect(fallback.genre).toBe("自定义题材");
    expect(fallback.openingRhythm.length).toBeGreaterThan(0);

    for (const genre of LONG_BOOK_GENRES) {
      if (genre === "其他") continue;
      const blueprint = resolveWebNovelGenreBlueprint(genre);
      expect(blueprint.genre).toBe(genre);
      expect(blueprint.hookFocus).not.toBe(fallback.hookFocus);
    }
  });

  it("computes five sequential workflow steps and does not count default empty placeholders as ready", () => {
    const emptySteps = computeLongWorkflowSteps("测试长篇", "仙侠", null);
    expect(emptySteps).toHaveLength(5);
    expect(emptySteps[0]?.active).toBe(true);
    expect(emptySteps.every((step) => !step.done)).toBe(true);
    expect(emptySteps.filter((step) => step.active)).toHaveLength(1);
    expect(emptySteps[1]?.prompt).toContain("load_skill");
    expect(emptySteps[3]?.prompt).toContain("黄金三章与开篇钩子");
    expect(emptySteps[4]?.prompt).toContain("已有正文时先读本章");

    // A newly created book has 1 pre-seeded empty volume and 1 empty chapter card.
    const freshBookSteps = computeLongWorkflowSteps("回潮时刻", "悬疑", {
      worldbuilding: [],
      characters: [],
      plot: {
        volumes: [{ id: "v1" }],
        chapterCards: [{ id: "c1" }]
      },
      chapters: [{ chapterCardId: "c1", bodyStatus: "empty" }],
      ledger: { commits: [] }
    } as never);
    expect(freshBookSteps.every((step) => !step.done)).toBe(true);
    expect(freshBookSteps[0]?.active).toBe(true);
  });

  it("makes chapter-card review available alongside the opening plan", () => {
    const skills = resolveWebNovelCraftSkills("测试长篇", "都市");
    expect(
      skills.find((skill) => skill.id === "volume-chapter-review")?.prompt
    ).toContain("暂时跳过");
    for (const skill of skills) {
      expect(skill.prompt).toContain("load_skill");
      expect(skill.prompt).toContain(skill.skillName);
    }
  });

  it("targets the selected volume or chapter and asks for scope when several volumes are possible", () => {
    const volumes = [
      { id: "volume_first", order: 1, title: "涨水" },
      { id: "volume_second", order: 2, title: "渡口" }
    ];
    const plot = {
      volumes,
      chapterCards: [{ id: "chapter_two", volumeId: "volume_second" }]
    };
    const review = (
      selection: Parameters<typeof resolveWebNovelCraftSkills>[3],
      available = volumes
    ) =>
      resolveWebNovelCraftSkills(
        "渡船",
        "现实",
        { plot: { ...plot, volumes: available } } as never,
        selection
      ).find((skill) => skill.id === "volume-chapter-review")?.prompt;
    expect(review({ chapterCardId: "chapter_two" })).toContain(
      "第 2 卷《渡口》"
    );
    expect(review({ plotPointVolumeId: "volume_first" })).toContain(
      "第 1 卷《涨水》"
    );
    expect(review(null, [volumes[0]!])).toContain("第 1 卷《涨水》");
    expect(review(null)).toContain("先让我选卷");
  });

  it("fills the English workflow and review drafts in the current book", () => {
    const originalLocale = locale.value;
    try {
      locale.value = "en-US";
      const steps = computeLongWorkflowSteps(
        "When the Tide Turns",
        "Mystery",
        null
      );
      const review = resolveWebNovelCraftSkills(
        "When the Tide Turns",
        "Mystery"
      ).find((skill) => skill.id === "volume-chapter-review");
      expect(steps[0]?.prompt).toContain("a harder choice in the middle");
      expect(steps[3]?.prompt).toContain("golden-three-chapters");
      for (const prompt of [
        ...steps.map((step) => step.prompt),
        review?.prompt
      ]) {
        expect(prompt).toContain("When the Tide Turns");
        expect(prompt).not.toMatch(/[\u3400-\u9fff]|\{\w+\}/u);
      }
      expect(review?.prompt).toContain("volume-chapter-review");
    } finally {
      locale.value = originalLocale;
    }
  });
});
