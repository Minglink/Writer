import type { LongWorkspaceIndexSnapshot } from "@writer/contracts";
import { i18n, registerFeatureMessages } from "../i18n";

export const longCraftT = registerFeatureMessages("longWebNovelCraft", {
  "zh-CN": {
    eyebrow: "WRITER 长篇工作台",
    workflowTitle: "开书与连载进度",
    workflowHint: "点击后将提示词填入下方输入框（不会直接发送）",
    toolkitTitle: "可选网文技法模板",
    toolkitHint: "点击将内置技法提示词填入输入框，可修改后再发送",
    startWriting: "写第一章",
    continueWriting: "继续写正文",
    planBook: "整理开书计划",
    expandGuide: "展开开书进度与网文技法",
    collapseGuide: "收起开书进度与网文技法",
    progressSummary: "已完成 {done}/{total}",
    targetScope: "当前目标：{target}",
    blueprintTitle: "题材开书蓝图",
    blueprintHookLabel: "核心卖点",
    blueprintSettingLabel: "关键设定",
    blueprintOpeningLabel: "黄金三章",
    statusPending: "待起草",
    statusReady: "已建立",
    statusNext: "建议下一步",
    step1Title: "核心卖点与书线",
    step1Summary: "定核心梗、金手指与全书主线目标",
    step2Title: "世界观与规则体系",
    step2Summary: "境界阶梯、战力上限、代价与势力格局",
    step3Title: "人物弧光与群像",
    step3Summary: "主角缺陷反差、反派压迫感与配角功能位",
    step4Title: "卷纲与黄金三章",
    step4Summary: "首卷大纲、开篇三章钩子与情绪曲线",
    step5Title: "正文与连续性审计",
    step5Summary: "按章卡写正文、章末卡点与防吃书核验",
    countWorld: "{count} 条设定",
    countCharacters: "{count} 位角色",
    countPlot: "{volumes} 卷 · {cards} 章卡",
    countDraft: "{chapters} 章正文 · {commits} 次账本",
    skillGoldenTitle: "黄金三章打磨",
    skillGoldenDesc: "500字入局、卖点兑现与第三章强卡点",
    skillPowerTitle: "防战力崩坏设定",
    skillPowerDesc: "阶梯上限、硬约束代价与资源闭环",
    skillCharTitle: "群像与防 OOC",
    skillCharDesc: "主角弧光、反派动机与角色语言指纹",
    skillPacingTitle: "章节质感与爽点",
    skillPacingDesc: "去AI味画面感、情绪四拍与章末钩子",
    skillContinuityTitle: "连续性与伏笔审计",
    skillContinuityDesc: "交叉核验状态、时间线、物品与未收伏笔"
  },
  "en-US": {
    eyebrow: "WRITER LONG-FORM",
    workflowTitle: "Launch & Serialization Progress",
    workflowHint:
      "Clicks fill the prompt into the input box below (no auto-send)",
    toolkitTitle: "Optional Web-Novel Craft Templates",
    toolkitHint:
      "Clicks insert a built-in craft prompt for review before sending",
    startWriting: "Write Chapter 1",
    continueWriting: "Continue Writing",
    planBook: "Plan Book Outline",
    expandGuide: "Show launch progress & craft templates",
    collapseGuide: "Hide launch progress & craft templates",
    progressSummary: "{done}/{total} ready",
    targetScope: "Target: {target}",
    blueprintTitle: "Genre Launch Blueprint",
    blueprintHookLabel: "Core Hook",
    blueprintSettingLabel: "Key Pillars",
    blueprintOpeningLabel: "First 3 Chapters",
    statusPending: "To draft",
    statusReady: "Ready",
    statusNext: "Next step",
    step1Title: "Core Hook & Book Line",
    step1Summary: "Premise, golden finger, and series arc",
    step2Title: "World & Power Rules",
    step2Summary: "Tiers, power ceiling, costs, and factions",
    step3Title: "Character Arcs & Cast",
    step3Summary: "Protagonist flaw, antagonist pressure, ensemble roles",
    step4Title: "Volume & First 3 Chapters",
    step4Summary: "Volume outline, opening hooks, and tension curve",
    step5Title: "Draft & Continuity Audit",
    step5Summary: "Chapter prose, cliffhangers, and ledger checks",
    countWorld: "{count} entries",
    countCharacters: "{count} characters",
    countPlot: "{volumes} vol · {cards} cards",
    countDraft: "{chapters} chapters · {commits} ledger",
    skillGoldenTitle: "Golden 3 Chapters",
    skillGoldenDesc: "Immediate hook, core payoff, and Ch.3 cliffhanger",
    skillPowerTitle: "Power System Balance",
    skillPowerDesc: "Tier ceilings, hard costs, and resource loop",
    skillCharTitle: "Ensemble & Anti-OOC",
    skillCharDesc: "Character arcs, antagonist logic, voice anchors",
    skillPacingTitle: "Prose & Pacing Polish",
    skillPacingDesc: "Vivid scenes, emotional beats, strong endings",
    skillContinuityTitle: "Continuity & Ledger",
    skillContinuityDesc: "Cross-check states, timeline, items, open loops"
  }
});

export interface WebNovelGenreBlueprint {
  readonly genre: string;
  readonly hookFocus: string;
  readonly settingPillars: string;
  readonly openingRhythm: string;
}

const ZH_GENRE_BLUEPRINTS: Record<string, WebNovelGenreBlueprint> = {
  玄幻: {
    genre: "玄幻",
    hookFocus: "强反差金手指 / 废柴退婚或底层逆袭 / 越级破局爽感",
    settingPillars: "境界阶梯与战力天花板、核心修炼资源、宗门/王朝势力格局",
    openingRhythm: "第1章立危机与反差，第2章显性兑现金手指，第3章首战反杀留大钩"
  },
  仙侠: {
    genre: "仙侠",
    hookFocus: "长生问道执念 / 因果气运 / 凡人逆天或苟道发育",
    settingPillars: "炼气至飞升境界体系、灵根功法代价、仙门与散修利益链",
    openingRhythm: "开篇切入生死因果或入门考验，三章内建立道心与立身筹码"
  },
  都市: {
    genre: "都市",
    hookFocus: "高概念异能/系统/重生信息差 + 现实阶层跃迁与情绪爽点",
    settingPillars: "现实锚点与规则边界、核心财富/人脉资源闭环、行业对抗生态",
    openingRhythm: "第1章抛现实困局与奇遇触发，第2-3章快速打脸破局并抬高目标"
  },
  悬疑: {
    genre: "悬疑",
    hookFocus: "强诡计谜面 / 密闭规则怪谈 / 信息差博弈与层层反转",
    settingPillars: "核心规则与禁区红线、时间线与线索账本、多方隐瞒动机",
    openingRhythm: "开篇300字抛异常事件，三章内立住核心谜题与第一个红鲱鱼反转"
  },
  历史: {
    genre: "历史",
    hookFocus: "时代大势与个人破局 / 现代认知降维打击 / 权谋与实业双线",
    settingPillars: "朝代官制与兵制、财政粮草硬约束、核心派系与历史节点时间线",
    openingRhythm:
      "开篇落在具体生死/生计危机，三章内靠实操手段站稳脚跟并引出大人物"
  },
  科幻: {
    genre: "科幻",
    hookFocus: "硬核高概念设定 / 文明存亡博弈 / 科技树跃迁与规则利用",
    settingPillars: "核心物理/科技公理、能源与算力硬约束、星际/赛博阵营矛盾",
    openingRhythm:
      "以具体异常现象或任务危机入局，用行动带出世界规则而非大段科普"
  },
  言情: {
    genre: "言情",
    hookFocus: "强拉扯情感张力 / 身份反差与双向救赎 / 宿命感冲突",
    settingPillars:
      "男女主核心执念与心理防线、现实阻碍与利益纠葛、情感升温节点",
    openingRhythm: "开篇直接切入高张力对手戏，三章内确立双向关系钩子与核心矛盾"
  },
  武侠: {
    genre: "武侠",
    hookFocus: "快意恩仇与侠义底线 / 绝学传承 / 江湖阴谋与门派纷争",
    settingPillars: "内功招式与破绽克制、门派江湖规矩、恩怨旧案时间线",
    openingRhythm: "开篇以一场利落交锋或灭门旧案切入，三章内立住侠气与宿敌阴影"
  },
  奇幻: {
    genre: "奇幻",
    hookFocus: "异世界法则探索 / 职业序列晋升 / 史诗阵营冲突",
    settingPillars: "魔法/超凡代价机制、种族与教会势力版图、古神/禁忌秘密",
    openingRhythm:
      "以具体超凡事件切入日常破裂，三章内展示核心序列能力与潜藏威胁"
  },
  军事: {
    genre: "军事",
    hookFocus: "极限战术博弈 / 小队羁绊 / 装备与情报劣势下的绝境翻盘",
    settingPillars: "编制与指挥链、弹药补给与地形硬约束、敌我战术风格",
    openingRhythm:
      "开篇直接进入演习或实战突发状况，三章内展现主角战术判断与核心矛盾"
  },
  现实: {
    genre: "现实",
    hookFocus: "真实时代切面 / 职场或家庭困局突围 / 细腻人性弧光",
    settingPillars: "行业生态与真实利益规则、人物社会关系网、阶段性现实困境",
    openingRhythm:
      "开篇聚焦具体两难抉择，三章内立住人物底色与不可回避的现实压力"
  }
};

const DEFAULT_ZH_BLUEPRINT: WebNovelGenreBlueprint = {
  genre: "其他",
  hookFocus: "清晰核心卖点 + 强冲突目标 + 持续追读悬念",
  settingPillars: "底层规则与硬约束、核心资源/利益格局、人物关系张力",
  openingRhythm: "第1章即时入局抛冲突，第2章兑现核心卖点，第3章小高潮留强钩子"
};

const DEFAULT_EN_BLUEPRINT: WebNovelGenreBlueprint = {
  genre: "General",
  hookFocus:
    "Clear premise hook, distinct protagonist edge, and escalating stakes",
  settingPillars:
    "Rule boundaries & hard costs, resource loop, and faction tensions",
  openingRhythm:
    "Ch.1 immediate conflict, Ch.2 core hook payoff, Ch.3 payoff + cliffhanger"
};

export function resolveWebNovelGenreBlueprint(
  genre: string
): WebNovelGenreBlueprint {
  const isEn = i18n.global.locale.value === "en-US";
  if (isEn) {
    return { ...DEFAULT_EN_BLUEPRINT, genre };
  }
  return ZH_GENRE_BLUEPRINTS[genre] ?? { ...DEFAULT_ZH_BLUEPRINT, genre };
}

export interface LongWorkflowStep {
  readonly id: string;
  readonly order: number;
  readonly title: string;
  readonly summary: string;
  readonly statusLabel: string;
  readonly done: boolean;
  readonly active: boolean;
  readonly prompt: string;
}

export interface WebNovelCraftSkillCard {
  readonly id: string;
  readonly skillName: string;
  readonly title: string;
  readonly description: string;
  readonly prompt: string;
}

function countWorldbuildingEntries(
  index: LongWorkspaceIndexSnapshot | null
): number {
  if (!index) return 0;
  return index.worldbuilding.reduce((total, category) => {
    if (category.format === "list") return total + category.items.length;
    return total;
  }, 0);
}

export function computeLongWorkflowSteps(
  bookTitle: string,
  genre: string,
  index: LongWorkspaceIndexSnapshot | null
): LongWorkflowStep[] {
  const worldCount = countWorldbuildingEntries(index);
  const characterCount = index?.characters.length ?? 0;
  const volumeCount = index?.plot.volumes.length ?? 0;
  const cardCount = index?.plot.chapterCards.length ?? 0;
  const writtenChapters =
    index?.chapters.filter((entry) => entry.bodyStatus !== "empty").length ?? 0;
  const commitCount = index?.ledger.commits.length ?? 0;

  // A brand-new book ships with 1 empty default volume and 1 empty chapter card;
  // do not mark book-line or plot steps as established from those placeholders.
  const hasUserPlotProgress =
    volumeCount > 1 || cardCount > 1 || writtenChapters > 0;
  const stepDone = [
    worldCount > 0 || characterCount > 0 || hasUserPlotProgress,
    worldCount > 0,
    characterCount > 0,
    hasUserPlotProgress,
    writtenChapters > 0
  ];
  const firstPendingIndex = stepDone.findIndex((done) => !done);
  const activeIndex = firstPendingIndex === -1 ? 4 : firstPendingIndex;
  const blueprint = resolveWebNovelGenreBlueprint(genre);

  const rawSteps = [
    {
      id: "book-line",
      order: 1,
      title: longCraftT("step1Title"),
      summary: longCraftT("step1Summary"),
      statusLabel: stepDone[0]
        ? longCraftT("statusReady")
        : longCraftT("statusPending"),
      prompt: `请先读取当前《${bookTitle}》（题材：${genre}）的书线，并结合网文开书标准（核心卖点：${blueprint.hookFocus}），帮我梳理并起草全书书线：明确核心梗、主角金手指/核心优势、主线目标、三卷级大阶段走向与读者核心爽点预期。`
    },
    {
      id: "worldbuilding",
      order: 2,
      title: longCraftT("step2Title"),
      summary: longCraftT("step2Summary"),
      statusLabel:
        worldCount > 0
          ? longCraftT("countWorld", { count: worldCount })
          : longCraftT("statusPending"),
      prompt: `请先调用 load_skill 加载「世界观与防战力崩坏设定」，再结合《${bookTitle}》（${genre}，重点设定：${blueprint.settingPillars}）已有书线，为本书设计境界/规则阶梯、战力上限锚点、硬约束代价、资源闭环与核心势力格局，并整理为可落盘的世界观条目。`
    },
    {
      id: "characters",
      order: 3,
      title: longCraftT("step3Title"),
      summary: longCraftT("step3Summary"),
      statusLabel:
        characterCount > 0
          ? longCraftT("countCharacters", { count: characterCount })
          : longCraftT("statusPending"),
      prompt: `请先调用 load_skill 加载「人物弧光与网文群像设计」，结合《${bookTitle}》的书线与世界观，为主角、核心反派与 2–3 位关键配角建立人物档案（含明面目标、底层执念与缺陷、语言指纹、防 OOC 红线与双向关系张力）。`
    },
    {
      id: "plot-golden",
      order: 4,
      title: longCraftT("step4Title"),
      summary: longCraftT("step4Summary"),
      statusLabel: hasUserPlotProgress
        ? longCraftT("countPlot", { volumes: volumeCount, cards: cardCount })
        : longCraftT("statusPending"),
      prompt: `请先调用 load_skill 加载「黄金三章与开篇钩子」，结合《${bookTitle}》（${genre}，开篇节奏：${blueprint.openingRhythm}）的设定与角色，规划第一卷卷纲、核心剧情点以及第 1–3 章黄金三章章卡（标明每章冲突、卖点兑现、情绪节拍与章末卡点）。`
    },
    {
      id: "draft-continuity",
      order: 5,
      title: longCraftT("step5Title"),
      summary: longCraftT("step5Summary"),
      statusLabel:
        writtenChapters > 0 || commitCount > 0
          ? longCraftT("countDraft", {
              chapters: writtenChapters,
              commits: commitCount
            })
          : longCraftT("statusPending"),
      prompt: `请先调用 load_skill 加载「章节质感与爽点节奏精修」，读取《${bookTitle}》当前选中的章卡与前文状态，按网文连载标准起草或精修本章正文（强化镜头画面、对话潜台词、爽点兑现与章末钩子），完成后提示需要同步的连续性状态变更。`
    }
  ];

  return rawSteps.map((step, idx) => ({
    ...step,
    done: stepDone[idx] ?? false,
    active: idx === activeIndex
  }));
}

export function resolveWebNovelCraftSkills(
  bookTitle: string,
  genre: string
): WebNovelCraftSkillCard[] {
  return [
    {
      id: "golden-three-chapters",
      skillName: "黄金三章与开篇钩子",
      title: longCraftT("skillGoldenTitle"),
      description: longCraftT("skillGoldenDesc"),
      prompt: `请调用 load_skill 加载「黄金三章与开篇钩子」，对照《${bookTitle}》（${genre}）当前书线与前三章章卡/正文，逐章诊断开篇 500 字入局速度、金手指兑现与第三章卡点力度，并给出可直接落盘的改写方案。`
    },
    {
      id: "world-power-system",
      skillName: "世界观与防战力崩坏设定",
      title: longCraftT("skillPowerTitle"),
      description: longCraftT("skillPowerDesc"),
      prompt: `请调用 load_skill 加载「世界观与防战力崩坏设定」，审计或补全《${bookTitle}》的力量/规则阶梯、战力天花板、硬约束代价与资源闭环，排查后期数值通胀隐患。`
    },
    {
      id: "character-arc-ensemble",
      skillName: "人物弧光与网文群像设计",
      title: longCraftT("skillCharTitle"),
      description: longCraftT("skillCharDesc"),
      prompt: `请调用 load_skill 加载「人物弧光与网文群像设计」，检视《${bookTitle}》现有主要角色的目标动机、反派压迫感、配角功能位与语言指纹，补齐防 OOC 红线。`
    },
    {
      id: "chapter-craft-pacing",
      skillName: "章节质感与爽点节奏精修",
      title: longCraftT("skillPacingTitle"),
      description: longCraftT("skillPacingDesc"),
      prompt: `请调用 load_skill 加载「章节质感与爽点节奏精修」，读取《${bookTitle}》当前章节正文，按「情绪曲线四拍 / 去AI味与画面感 / 信息密度控水 / 章末卡点」逐项精修并给出具体改动提案。`
    },
    {
      id: "continuity-foreshadowing-audit",
      skillName: "全书连续性与伏笔账本审计",
      title: longCraftT("skillContinuityTitle"),
      description: longCraftT("skillContinuityDesc"),
      prompt: `请调用 load_skill 加载「全书连续性与伏笔账本审计」，交叉核查《${bookTitle}》的角色当前状态、世界观硬规则、时间线与未回收伏笔账本，按硬冲突、软隐患与伏笔回收建议分级列出。`
    }
  ];
}
