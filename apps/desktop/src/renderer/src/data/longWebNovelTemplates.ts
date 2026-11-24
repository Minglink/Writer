import { i18n, registerFeatureMessages } from "../i18n";

export const longTemplateT = registerFeatureMessages("longWebNovelTemplates", {
  "zh-CN": {
    targetButtonTitle: "点击切换网文单章目标字数（2000 / 3000 / 4000 字）",
    targetReached: "已达 {target} 字线",
    targetRemaining: "距 {target} 字还差 {remaining}",
    insertScaffold: "插入网文结构骨架",
    bookLineLabel: "网文书线骨架",
    worldbuildingLabel: "防崩坏设定骨架",
    characterLabel: "人物弧光卡骨架",
    chapterCardLabel: "黄金章卡节拍骨架"
  },
  "en-US": {
    targetButtonTitle:
      "Click to cycle chapter target (2000 / 3000 / 4000 chars)",
    targetReached: "{target} target met",
    targetRemaining: "{remaining} left to {target}",
    insertScaffold: "Insert craft scaffold",
    bookLineLabel: "Book Line Scaffold",
    worldbuildingLabel: "Power/World Rule Scaffold",
    characterLabel: "Character Arc Scaffold",
    chapterCardLabel: "Chapter Beat Card Scaffold"
  }
});

export const LONG_CHAPTER_TARGET_PRESETS = [2000, 3000, 4000] as const;
export type LongChapterTargetPreset =
  (typeof LONG_CHAPTER_TARGET_PRESETS)[number];

export function nextChapterTargetPreset(
  current: number
): LongChapterTargetPreset {
  const index = LONG_CHAPTER_TARGET_PRESETS.indexOf(
    current as LongChapterTargetPreset
  );
  return LONG_CHAPTER_TARGET_PRESETS[
    (index + 1) % LONG_CHAPTER_TARGET_PRESETS.length
  ]!;
}

export type LongCraftScaffoldKind =
  "bookLine" | "worldbuilding" | "character" | "chapterCard";

export interface LongCraftScaffold {
  readonly kind: LongCraftScaffoldKind;
  readonly label: string;
  readonly markdown: string;
}

const ZH_SCAFFOLDS: Record<LongCraftScaffoldKind, string> = {
  bookLine: `## 一句话核心卖点
- 题材与情绪定位：
- 主角金手指 / 核心信息差：
- 读者核心爽点预期：

## 全书主线与三卷大格局
- 第一卷（起手破局）：
- 第二卷（中盘升级与势力博弈）：
- 第三卷（终局真相与回收）：

## 核心禁忌与防崩坏红线
- 战力/规则天花板：
- 主角行为底线：
`,
  worldbuilding: `## 设定定位与核心规则
- 所属体系 / 作用域：
- 运转机制与标志性特征：

## 边界、代价与硬约束（防崩坏）
- 战力/权限上限锚点：
- 使用代价 / 冷却 / 暴露风险：

## 资源闭环与剧情冲突钩子
- 稀缺资源产出与垄断方：
- 对主角当前阶段的直接阻碍或机会：
`,
  character: `## 核心定位（长期不变）
- 身份与功能位（主角 / 反派 / 对照镜 / 催化剂）：
- 明面目标：
- 底层执念与性格缺陷：

## 辨识度与防 OOC 红线
- 标志性动作 / 说话节奏 / 语言指纹：
- 绝不会做的事（防 OOC 红线）：

## 关键关系张力
- 与主角的利益或情感绑定：
`,
  chapterCard: `## 本章核心目标与冲突
- 承接上章钩子：
- 本章核心冲突 / 博弈对手：

## 情绪曲线四拍
1. 蓄力 / 压抑：
2. 冲突升级：
3. 爽点 / 反转兑现：
4. 余波与章末强卡点：

## 伏笔与状态变更备忘
- 新埋 / 回收伏笔：
- 角色状态 / 物品 / 境界变动：
`
};

const EN_SCAFFOLDS: Record<LongCraftScaffoldKind, string> = {
  bookLine: `## Core Premise & Hook
- Genre & emotional promise:
- Protagonist edge / golden finger:
- Reader payoff loop:

## Series Arc
- Volume 1 (Breakout):
- Volume 2 (Escalation & factions):
- Volume 3 (Endgame & payoff):

## Hard Boundaries
- Power / rule ceiling:
- Protagonist non-negotiables:
`,
  worldbuilding: `## Core Rule & Scope
- Domain / faction scope:
- Observable mechanics:

## Ceiling & Hard Costs
- Upper limit anchor:
- Cost, cooldown, or exposure risk:

## Story Friction
- Scarce resource / bottleneck:
- How it drives immediate conflict:
`,
  character: `## Core Identity
- Narrative role (Protagonist / Antagonist / Foil / Catalyst):
- Surface goal:
- Underlying obsession & flaw:

## Voice & Anti-OOC Guardrails
- Speech rhythm & signature habits:
- Lines this character will never cross:

## Relationship Tension
- Dynamic with the protagonist:
`,
  chapterCard: `## Chapter Objective & Conflict
- Carry-over hook:
- Core conflict / opponent:

## Four-Beat Emotional Curve
1. Setup & pressure:
2. Escalation:
3. Payoff / reversal:
4. Aftermath & cliffhanger:

## Continuity & Foreshadowing Notes
- Planted / resolved clues:
- State, item, or power changes:
`
};

export function resolveLongCraftScaffold(
  kind: LongCraftScaffoldKind
): LongCraftScaffold {
  const isEn = i18n.global.locale.value === "en-US";
  const labelKey = `${kind}Label` as const;
  return {
    kind,
    label: longTemplateT(labelKey),
    markdown: isEn ? EN_SCAFFOLDS[kind] : ZH_SCAFFOLDS[kind]
  };
}
