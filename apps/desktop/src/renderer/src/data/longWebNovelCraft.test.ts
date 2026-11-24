import { describe, expect, it } from "vitest";
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
  });

  it("computes five sequential workflow steps and does not count default empty placeholders as ready", () => {
    const emptySteps = computeLongWorkflowSteps("测试长篇", "仙侠", null);
    expect(emptySteps).toHaveLength(5);
    expect(emptySteps[0]?.active).toBe(true);
    expect(emptySteps.every((step) => !step.done)).toBe(true);
    expect(emptySteps.filter((step) => step.active)).toHaveLength(1);
    expect(emptySteps[1]?.prompt).toContain("load_skill");
    expect(emptySteps[3]?.prompt).toContain("黄金三章与开篇钩子");

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

  it("exposes five reusable web-novel craft skill cards aligned with load_skill", () => {
    const skills = resolveWebNovelCraftSkills("测试长篇", "都市");
    expect(skills).toHaveLength(5);
    for (const skill of skills) {
      expect(skill.prompt).toContain("load_skill");
      expect(skill.prompt).toContain(skill.skillName);
    }
  });
});
