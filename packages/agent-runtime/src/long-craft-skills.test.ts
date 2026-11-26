import { describe, expect, it } from "vitest";
import {
  BUILTIN_LONG_CRAFT_SKILLS,
  resolveBuiltinLongCraftSkill
} from "./long-craft-skills";
import { buildLoadSkillTool } from "./long-agent-tools/catalog-tools";
import { resultText } from "./long-agent-tools.test-support";

describe("builtin long-form web-novel craft skills", () => {
  it("resolves each craft and co-creation playbook by id and Chinese name, plus its aliases", () => {
    for (const skill of BUILTIN_LONG_CRAFT_SKILLS) {
      for (const query of [skill.id, skill.name, ...skill.aliases]) {
        expect(resolveBuiltinLongCraftSkill(query)).toBe(skill);
      }
    }
    expect(resolveBuiltinLongCraftSkill("golden-three-chapters")?.name).toBe(
      "黄金三章与开篇钩子"
    );
    expect(resolveBuiltinLongCraftSkill("防战力崩坏")?.id).toBe(
      "world-power-system"
    );
    expect(resolveBuiltinLongCraftSkill("人物群像")?.id).toBe(
      "character-arc-ensemble"
    );
    expect(resolveBuiltinLongCraftSkill("强化连载节奏")?.id).toBe(
      "chapter-craft-pacing"
    );
    expect(resolveBuiltinLongCraftSkill("防吃书")?.id).toBe(
      "continuity-foreshadowing-audit"
    );
    expect(resolveBuiltinLongCraftSkill("想下一幕")?.id).toBe(
      "story-spark-brainstorm"
    );
    expect(resolveBuiltinLongCraftSkill("去AI味")?.id).toBe(
      "reader-margin-critique"
    );
    expect(resolveBuiltinLongCraftSkill("读读这段")?.id).toBe(
      "reader-margin-critique"
    );
    expect(resolveBuiltinLongCraftSkill("言情框架")?.id).toBe(
      "romance-tension-framework"
    );
    expect(resolveBuiltinLongCraftSkill("宫斗宅斗")?.id).toBe(
      "intrigue-court-household"
    );
    expect(resolveBuiltinLongCraftSkill("规则怪谈")?.id).toBe(
      "suspense-rules-horror"
    );
    expect(resolveBuiltinLongCraftSkill("年代种田")?.id).toBe(
      "period-farming-brainhole"
    );
    expect(resolveBuiltinLongCraftSkill("压抑释放")?.id).toBe(
      "golden-finger-catharsis"
    );
    expect(resolveBuiltinLongCraftSkill("换地图")?.id).toBe(
      "map-upgrade-anticipation"
    );
  });

  it("loads builtin craft skills through load_skill while giving attached user skills priority", async () => {
    const loadSkill = buildLoadSkillTool({
      attachedSkills: [
        {
          id: "user-skill-1",
          title: "黄金三章与开篇钩子",
          kind: "writing",
          content: "用户自定义黄金三章规则"
        }
      ]
    } as never);

    const shadowed = resultText(
      await loadSkill.execute("call-1", { name: "黄金三章与开篇钩子" })
    );
    expect(shadowed).toContain("用户自定义黄金三章规则");

    const builtin = resultText(
      await loadSkill.execute("call-2", { name: "防战力崩坏" })
    );
    expect(builtin).toContain("世界观与防战力崩坏设定");
    expect(builtin).toContain("阶梯与战力上限锚定");
    expect(builtin).toContain("谁还能负担另一条路的代价");
    const review = resultText(
      await loadSkill.execute("call-3", { name: "volume-chapter-review" })
    );
    expect(review).toContain("卷内章卡审读");
    expect(review).toContain("反馈中点明章名");
    expect(review).toContain("审读只给意见");
  });
});
