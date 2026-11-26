import { resolveLongBookFrameworkPreset } from "@writer/contracts/renderer";
import type { LongWorkspaceIndexSnapshot } from "@writer/contracts";
import type { LongWorkspaceSelection } from "../types/longWorkspace";
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
    blueprintFrameworkLabel: "初始框架",
    statusPending: "待起草",
    statusReady: "已建立",
    statusNext: "建议下一步",
    step1Title: "核心卖点与书线",
    step1Summary: "从开篇和中段的选择看一个点子能写多远",
    step2Title: "世界观与规则体系",
    step2Summary: "找出规则会限制谁，以及破例的代价",
    step3Title: "人物弧光与群像",
    step3Summary: "用同一件事检验不同人物的动机和关系",
    step4Title: "卷纲与黄金三章",
    step4Summary: "首卷大纲、开篇三章钩子与情绪曲线",
    reviewVolumeTitle: "审读卷内章卡",
    reviewVolumeSummary: "用相邻章节检验人物选择和读者预期",
    step5Title: "正文与连续性审计",
    step5Summary: "按章卡写正文、章末卡点与防吃书核验",
    planPremise:
      "请读取《{bookTitle}》的书线，结合题材「{genre}」和已有构想。方向已定时，用开篇的一件事和中段一次更难的选择，展开主角贯穿全书的目标。方向还未定时，比较两种可能，把各自能写出的这两个时刻给我看，等我选定再起草书线。",
    planWorld:
      "请用 load_skill 加载「世界观与防战力崩坏设定」。从《{bookTitle}》的书线挑一个即将发生的选择，以{pillars}为参考，说明哪条规则使一个选项付出代价，谁有能力破例，破例之后谁会受到影响。把用得上的设定整理成条目。",
    planCharacters:
      "请用 load_skill 加载「人物弧光与网文群像设计」。根据《{bookTitle}》已定的书线和设定，挑一件主要人物都关心的事。写出各人会怎样行动、愿意为谁让步，以及选择会怎样改变彼此的关系，据此完善人物档案。",
    planOpening:
      "请用 load_skill 加载「黄金三章与开篇钩子」。根据《{bookTitle}》的书线、人物和设定，规划首卷和开篇三张章卡。用第一章引出的问题串起后两章，写清哪次行动改变了局面，以及读者何时能察觉。",
    reviewVolume:
      "请用 load_skill 加载「卷内章卡审读」，帮我审读《{bookTitle}》。{scope}暂时跳过其中一章，看后面哪个决定会失去依据，哪段关系或情绪会少一层铺垫。指出具体章名与影响，先把意见给我。",
    reviewSelectedVolume: "请对照第 {order} 卷《{volume}》的卷纲与相邻章卡。",
    reviewChooseVolume:
      "按我指定的卷或随消息提供的章卡来读。如果范围还不明确，先让我选卷。",
    draftChapter:
      "请用 load_skill 加载「章节质感与爽点节奏精修」。读取《{bookTitle}》当前章卡，有上章时核对末段。同场接续就接住未完的动作，换视角就核对新人物此刻能知道什么。本章尚空时按章卡起草；已有正文时先读本章，指出需要局部精修的位置。核对下一章要承接的变化。",
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
    skillContinuityDesc: "交叉核验状态、时间线、物品与未收伏笔",
    skillCatharsisTitle: "金手指与压抑释放",
    skillCatharsisDesc: "外挂边界、憋屈不过夜与四拍爽感放大",
    skillMapUpgradeTitle: "换地图与期待感",
    skillMapUpgradeDesc: "短中长三线钩子与换地图软着陆",
    skillRomanceTitle: "言情推拉与排雷",
    skillRomanceDesc: "四阶关系位移、心动名场面与排雷红线",
    skillIntrigueTitle: "宅斗宫斗与权谋",
    skillIntrigueDesc: "礼法品级红线、三方棋盘与局中局反杀",
    skillRulesHorrorTitle: "诡计与怪谈闭环",
    skillRulesHorrorDesc: "表里真假规则表、试错梯度与线索账本",
    skillPeriodBrainholeTitle: "年代致富与脑洞节奏",
    skillPeriodBrainholeDesc: "四级发家闭环与奇异机制反转爽点"
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
    blueprintFrameworkLabel: "World Framework",
    statusPending: "To draft",
    statusReady: "Ready",
    statusNext: "Next step",
    step1Title: "Core Hook & Book Line",
    step1Summary: "Test what the premise can sustain in the opening and middle",
    step2Title: "World & Power Rules",
    step2Summary: "Who a rule constrains and what an exception costs",
    step3Title: "Character Arcs & Cast",
    step3Summary: "Explore how different characters respond to the same event",
    step4Title: "Volume & First 3 Chapters",
    step4Summary: "Volume outline, opening hooks, and tension curve",
    reviewVolumeTitle: "Review chapter cards",
    reviewVolumeSummary:
      "Trace choices and reader expectations across chapters",
    step5Title: "Draft & Continuity Audit",
    step5Summary: "Chapter prose, cliffhangers, and ledger checks",
    planPremise:
      "Read the story line for “{bookTitle}” and the ideas already on hand for this {genre} book. If the direction is settled, develop the protagonist’s goal through an event in the opening and a harder choice in the middle. If it is open, show those two moments for two possible directions and let me choose before drafting the story line.",
    planWorld:
      "Use load_skill to read world-power-system. Take an upcoming choice from the story line of “{bookTitle}”. With {pillars} in mind, show which rule makes an option costly, who can make an exception, and who pays for it. Draft the relevant setting entries.",
    planCharacters:
      "Use load_skill to read character-arc-ensemble. From the established story line and setting of “{bookTitle}”, pick one event the main characters care about. Develop their profiles through what each would do, whom they would make a concession for, and how that choice changes their relationships.",
    planOpening:
      "Use load_skill to read golden-three-chapters. Plan the first volume and its opening three chapter cards from the story line, characters, and setting of “{bookTitle}”. Follow a question raised in chapter one through the next two cards, showing which action changes the situation and when the reader can tell.",
    reviewVolume:
      "Use load_skill to read volume-chapter-review for “{bookTitle}”. {scope} Try skipping one chapter. Which later decision loses its basis, or which relationship or emotional turn loses its preparation? Name the chapters and explain the effect. Give me your assessment first.",
    reviewSelectedVolume:
      "Read the outline and adjacent cards in volume {order}, “{volume}”.",
    reviewChooseVolume:
      "Use the volume I specify or the cards I supply. If the scope is unclear, ask me to choose a volume first.",
    draftChapter:
      "Use load_skill to read chapter-craft-pacing. Read the current card for “{bookTitle}” and the previous ending if available. Pick up an unfinished action in a continuing scene. On a viewpoint change, check what this person can know. Draft from the card if the chapter is empty. If it has prose, read it first and identify passages for local revision. Check what the next chapter needs in the handoff.",
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
    skillContinuityDesc: "Cross-check states, timeline, items, open loops",
    skillCatharsisTitle: "Cheat & Catharsis Loop",
    skillCatharsisDesc: "Golden-finger limits & 4-beat payoff cycle",
    skillMapUpgradeTitle: "Map Upgrade & Hooks",
    skillMapUpgradeDesc: "Short/mid/long hooks & smooth tier transitions",
    skillRomanceTitle: "Romance Tension",
    skillRomanceDesc: "4-stage relationship shifts & reader redlines",
    skillIntrigueTitle: "Household & Court Intrigue",
    skillIntrigueDesc: "Etiquette rules, multi-faction board & countertraps",
    skillRulesHorrorTitle: "Suspense & Rules Horror",
    skillRulesHorrorDesc: "True/false rules, trial stakes & fair clues",
    skillPeriodBrainholeTitle: "Period & High-Concept Loop",
    skillPeriodBrainholeDesc: "Era business milestones & high-concept twists"
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
  },
  灵异: {
    genre: "灵异",
    hookFocus: "中式民俗诡事 / 规则怪谈生路 / 信息差破局与诡物反制",
    settingPillars: "禁忌规则与触发代价、诡异源头与镇压手段、多方隐秘传承",
    openingRhythm:
      "第1章直入异常诡事，第2章借试错立住规则红线，第3章绝境反制留更深悬念"
  },
  末世: {
    genre: "末世",
    hookFocus: "极端天灾或废土求生 / 囤货基建与异能进化 / 人性秩序重构",
    settingPillars: "灾难演化阶段、物资与安全区硬约束、幸存者势力博弈",
    openingRhythm:
      "开篇倒计时或灾变突发，三章内完成首轮资源抢占并确立长期生存威胁"
  },
  游戏: {
    genre: "游戏",
    hookFocus: "机制拆解与数值越级 / 版本先知或隐藏职业 / 竞技逆转爽感",
    settingPillars: "职业技能与装备体系、副本/赛制规则边界、公会与版本生态",
    openingRhythm:
      "第1章落入关键对局或开服节点，三章内兑现机制优势并打出首场名场面"
  },
  体育: {
    genre: "体育",
    hookFocus: "极限对抗与逆境翻盘 / 天赋兑现与战术博弈 / 团队羁绊成长",
    settingPillars: "项目规则与技术门槛、体能伤病硬约束、联赛晋级与宿敌格局",
    openingRhythm:
      "开篇切入选拔或关键赛点，三章内立住主角球风/绝技与首轮劲敌目标"
  },
  轻小说: {
    genre: "轻小说",
    hookFocus: "强反差人设与高密度互动 / 日常异常化 / 吐槽喜剧或恋爱修罗场",
    settingPillars: "角色核心反差标签、日常与异能边界、校园/异界舞台规则",
    openingRhythm:
      "开篇快速抛出人设反差与核心关系契机，三章内立住轻快语感与主线钩子"
  },
  诸天: {
    genre: "诸天",
    hookFocus: "跨世界副本破局 / 能力跨界组合 / 幕后主神或万界规则博弈",
    settingPillars:
      "穿越代价与冷却限制、跨界战力换算基准、主世界与副本利益闭环",
    openingRhythm:
      "第1章切入首场副本危机，第2章兑现能力组合，第3章结算收益并抛新位面悬念"
  },
  现言: {
    genre: "现言",
    hookFocus: "强情绪拉扯与现实反差 / 职场豪门博弈 / 双向成长与破镜重圆",
    settingPillars: "人物情感创伤与底线、家庭职场现实阻碍、关系升温关键节点",
    openingRhythm:
      "开篇直接切入高张力交锋或关系变故，三章内立住情感钩子与核心阻碍"
  },
  古言: {
    genre: "古言",
    hookFocus: "宅斗宫斗智斗破局 / 身份错位与宿命拉扯 / 权谋与情感双线并进",
    settingPillars: "宗族礼法与朝堂品级、家产婚约利益网、前尘旧案时间线",
    openingRhythm:
      "开篇落入婚变、抄家或重生节点，三章内稳住局面并埋下高阶对手与情愫"
  },
  玄幻脑洞: {
    genre: "玄幻脑洞",
    hookFocus: "反套路奇异金手指 / 规则漏洞卡 BUG / 迪化误解或另类修炼爽感",
    settingPillars: "脑洞机制的硬边界、世界运转常识、反差冲突触发条件",
    openingRhythm:
      "第1章即刻抛出脑洞机制，第2章用非常规解法破局，第3章升级赌注留强钩"
  },
  都市脑洞: {
    genre: "都市脑洞",
    hookFocus: "奇异系统或规则降临现实 / 信息差降维打击 / 高频反转爽点",
    settingPillars: "脑洞规则与现实锚点、能力代价或冷却、社会连锁反应",
    openingRhythm: "开篇日常突现异常机制，三章内兑现首轮现实收益并引出更大局势"
  },
  都市高武: {
    genre: "都市高武",
    hookFocus: "气血武道觉醒 / 考学排位与凶兽战场 / 热血越级厮杀",
    settingPillars: "武道品阶与气血上限、异域战场格局、武大/军方资源分配",
    openingRhythm: "第1章立资质困局与觉醒契机，第2章实测战力跃升，第3章实战立威"
  },
  都市日常: {
    genre: "都市日常",
    hookFocus: "松弛烟火气与情绪治愈 / 细腻关系升温 / 事业与生活双丰收",
    settingPillars: "固定生活舞台、鲜活邻里/搭档人设、循序渐进的日常小目标",
    openingRhythm:
      "开篇用有画面感的生活切片入局，三章内立住人设魅力与温暖关系钩子"
  },
  都市生活: {
    genre: "都市生活",
    hookFocus: "当代情感与成长抉择 / 独立蜕变与双向奔赴 / 细腻人情冷暖",
    settingPillars: "现实职场与家庭关系网、人物情感底色、阶段性生活转折点",
    openingRhythm:
      "开篇切入生活转折或意外交集，三章内建立核心关系张力与成长目标"
  },
  历史脑洞: {
    genre: "历史脑洞",
    hookFocus: "跨时空直播/天幕/系统改命 / 历史人物视角反差 / 降维改写走向",
    settingPillars: "脑洞媒介规则、真实历史节点锚点、朝堂与民间连锁反应",
    openingRhythm:
      "第1章引爆脑洞异象，第2章借名臣帝王反应放大爽感，第3章改写首桩危局"
  },
  抗战谍战: {
    genre: "抗战谍战",
    hookFocus: "步步惊心的身份潜伏 / 情报博弈与反杀 / 家国信念与暗线牺牲",
    settingPillars: "敌我多方情报网、联络纪律与暴露红线、时代战局时间线",
    openingRhythm:
      "开篇即入接头危机或甄别考验，三章内站稳潜伏身份并埋下核心暗战"
  },
  职场商战: {
    genre: "职场商战",
    hookFocus: "利益博弈与专业破局 / 职场升迁或商业逆袭 / 高智商谈判交锋",
    settingPillars: "行业商业模式与利润链、派系权力结构、关键项目与资金硬约束",
    openingRhythm: "开篇切入背锅、裁员或竞标绝境，三章内靠专业手腕反客为主"
  },
  科幻末世: {
    genre: "科幻末世",
    hookFocus: "星际/生化/机械灾变求生 / 科技树重启与基地建设 / 文明火种博弈",
    settingPillars: "灾难演化机制、能源算力与物资约束、幸存者阵营与进化路线",
    openingRhythm: "开篇直面灾变倒计时或绝境苏醒，三章内建立生存筹码与核心悬念"
  },
  悬疑灵异: {
    genre: "悬疑灵异",
    hookFocus: "中式民俗诡案 / 抽丝剥茧查真相 / 规则试错与绝境反制",
    settingPillars: "诡异禁忌与触发条件、案件时间线与线索链、隐秘传承格局",
    openingRhythm: "开篇300字抛诡异异象，三章内立住核心谜团与首条生死规则"
  },
  规则怪谈: {
    genre: "规则怪谈",
    hookFocus: "真假规则推理拆解 / 副本生死博弈 / 卡规则漏洞绝地翻盘",
    settingPillars: "明暗规则清单、污染与违禁代价、副本隐藏真相与通关条件",
    openingRhythm:
      "第1章直接亮出首份诡异守则，第2章借他人违禁立威，第3章勘破首条假规则"
  },
  现代言情: {
    genre: "现代言情",
    hookFocus: "强情绪拉扯与现实反差 / 双向救赎或破镜重圆 / 甜虐交织",
    settingPillars: "人物情感创伤与防线、现实利益阻碍、关系升温关键节点",
    openingRhythm:
      "开篇直接切入高张力对手戏或关系变故，三章内立住情感钩子与核心矛盾"
  },
  古代言情: {
    genre: "古代言情",
    hookFocus: "身份错位与宿命拉扯 / 智斗破局与深情守护 / 权谋情感双线",
    settingPillars: "朝堂品级与宗族礼法、婚约家产利益网、前尘旧案时间线",
    openingRhythm:
      "开篇切入婚变、赐婚或重生节点，三章内立住女主底气与男主交锋张力"
  },
  古风世情: {
    genre: "古风世情",
    hookFocus: "市井烟火与家族兴衰 / 细腻人情世故 / 润物细无声的逆袭成长",
    settingPillars: "朝代衣食住行风貌、宗族邻里关系网、生计门路与礼法约束",
    openingRhythm: "开篇以具体家计或婚嫁风波入局，三章内展现人物手腕与生活质感"
  },
  宫斗宅斗: {
    genre: "宫斗宅斗",
    hookFocus: "步步为营的算计反杀 / 位份掌家权争夺 / 借势打力与隐忍翻盘",
    settingPillars: "后宅/后宫品级规矩、主仆派系站队、家产子嗣与圣宠博弈",
    openingRhythm: "第1章直面栽赃或立威下马威，三章内完成首次反杀并立住立足筹码"
  },
  豪门世家: {
    genre: "豪门世家",
    hookFocus: "强强联姻与继承权博弈 / 真假千金或隐婚反差 / 高浓度爽甜张力",
    settingPillars: "家族产业与股权格局、豪门圈层潜规则、人物隐秘过往",
    openingRhythm:
      "开篇切入退婚、认亲或契约婚姻现场，三章内打脸破局并埋下情感暗线"
  },
  现言脑洞: {
    genre: "现言脑洞",
    hookFocus: "读心/弹幕/系统/穿书等强设定 + 甜宠打脸反差爽感",
    settingPillars: "脑洞能力触发条件与局限、原剧情或现实轨迹、人物反差人设",
    openingRhythm:
      "第1章即刻激活脑洞设定，第2章制造强喜剧或反差名场面，第3章绑定CP主线"
  },
  古言脑洞: {
    genre: "古言脑洞",
    hookFocus: "空间/读心/穿书/兽语等金手指 + 古代抄家流放或宅斗逆袭",
    settingPillars: "金手指规则边界、古代生存硬环境、反派与盟友势力格局",
    openingRhythm:
      "开篇绑定绝境与金手指激活，三章内兑现首轮物资/信息优势扭转困局"
  },
  玄幻言情: {
    genre: "玄幻言情",
    hookFocus: "废柴觉醒或满级大佬重来 / 契约神兽与宗门打脸 / 强强宿命羁绊",
    settingPillars: "修炼境界与血脉体系、大陆宗门势力、男女主宿命渊源",
    openingRhythm: "开篇切入退婚/夺骨等强冲突，三章内觉醒底牌反杀并引出高阶男主"
  },
  奇幻仙侠: {
    genre: "奇幻仙侠",
    hookFocus: "三界宿命与修仙逆袭 / 师门团宠或冷面剑修 / 苍生与情劫抉择",
    settingPillars: "修真境界与天道因果、仙魔妖三界格局、法宝秘境规则",
    openingRhythm:
      "开篇切入拜师考验或重生改命节点，三章内立住道心与核心人物羁绊"
  },
  青春甜宠: {
    genre: "青春甜宠",
    hookFocus: "双向暗恋与高甜拉扯 / 校园成长与并肩追梦 / 细腻心动瞬间",
    settingPillars: "校园/成长舞台、性格互补人设、学业家庭与情感升温节点",
    openingRhythm:
      "开篇制造一眼难忘的初遇或重逢互动，三章内确立专属称呼与心动钩子"
  },
  虐恋情深: {
    genre: "虐恋情深",
    hookFocus: "爱恨交织与立场对立 / 误解隐忍与真相揭晓 / 极致情感宣泄",
    settingPillars: "核心心结与不可退让的底线、信息差来源、追悔与救赎路径",
    openingRhythm:
      "开篇直击情感决裂或生死抉择现场，三章内立住深情底色与强虐点悬念"
  },
  民国言情: {
    genre: "民国言情",
    hookFocus: "乱世浮沉与家国情怀 / 军阀世家或商海风云 / 克制深沉的宿命爱恋",
    settingPillars: "租界与军阀势力版图、家族旧怨与实业暗战、时代变局节点",
    openingRhythm:
      "开篇以一场雨夜重逢或家变风波入局，三章内立住乱世氛围与命运纠葛"
  },
  种田: {
    genre: "种田",
    hookFocus: "白手起家发家致富 / 美食基建与家长里短 / 踏实治愈的成长爽感",
    settingPillars: "地理气候与物产条件、家庭邻里关系网、手艺/经商升级路径",
    openingRhythm:
      "开篇落入家徒四壁或分家节点，三章内靠首桶金改善生计并立住盼头"
  },
  年代: {
    genre: "年代",
    hookFocus: "时代红利与命运改写 / 家庭温情与极品反击 / 扎实年代烟火气",
    settingPillars: "具体年代政策与票证制度、厂矿/乡村生态、家庭成员关系网",
    openingRhythm:
      "开篇切入回城、分家或重生改命节点，三章内抢占先机改变首轮处境"
  },
  古代权谋: {
    genre: "古代权谋",
    hookFocus: "朝堂党争与步步惊心 / 借势布局与绝境翻盘 / 智谋交锋与格局博弈",
    settingPillars: "皇权相权与兵权制衡、派系利益链、旧案密辛与关键时间点",
    openingRhythm:
      "开篇切入朝堂大案或政局危机，三章内展现主角破局手腕并引出幕后棋手"
  },
  悬疑恋爱: {
    genre: "悬疑恋爱",
    hookFocus: "双强联手破案或互相试探 / 危险处境催生信任 / 谜案与情感双线交织",
    settingPillars: "主线连环谜案与单元线索、双方秘密与试探边界、情感升温节点",
    openingRhythm:
      "开篇因异常案件被迫绑定，三章内抛出首案疑点与暧昧危险的对手戏"
  },
  搞笑轻松: {
    genre: "搞笑轻松",
    hookFocus: "高密度反差笑点 / 沙雕脑洞与神转折 / 解压下饭的轻快节奏",
    settingPillars: "角色鲜明喜剧人设、固定吐槽/误解机制、层层升级的荒诞事件",
    openingRhythm: "开篇300字出第一个包袱，三章内立住主角沙雕底色与爆笑核心主线"
  },
  纯爱: {
    genre: "纯爱",
    hookFocus: "强强拉扯与灵魂共鸣 / 极致人设张力 / 双向奔赴的情感弧光",
    settingPillars: "双主角性格反差与底线、共同目标或立场冲突、关系递进节点",
    openingRhythm:
      "开篇直接进入高张力初遇或对手戏，三章内立住双人化学反应与主线悬念"
  },
  同人衍生: {
    genre: "同人衍生",
    hookFocus: "原著意难平改写 / 新变量蝴蝶效应 / 高度还原角色魅力与名场面",
    settingPillars: "原著世界观与时间线锚点、角色 OOC 红线、新设定接入规则",
    openingRhythm:
      "开篇精准切入经典剧情节点，三章内撬动首轮蝴蝶效应并兑现读者期待"
  },
  传统玄幻: {
    genre: "传统玄幻",
    hookFocus: "少年热血逆天崛起 / 废柴退婚或血脉觉醒 / 宗门大比与秘境争锋",
    settingPillars: "严谨修炼境界阶梯、天地灵宝与功法品级、家族宗门与大域版图",
    openingRhythm:
      "第1章立受辱处境与不屈底色，第2章得传承或觉醒机缘，第3章初战扬眉立三年之约"
  },
  都市修真: {
    genre: "都市修真",
    hookFocus: "仙尊归来或传承入世 / 医武鉴宝降维打击 / 护短镇压各方豪门世家",
    settingPillars:
      "都市灵气与古武隐世格局、丹药阵法稀缺价值、主角前世/师门因果",
    openingRhythm:
      "开篇切入亲友受欺或退婚羞辱现场，三章内展露仙家手段翻手镇压并引出隐世圈层"
  },
  战神赘婿: {
    genre: "战神赘婿",
    hookFocus: "顶级统帅隐忍入赘 / 极致受辱与万众跪迎反差 / 护妻护女雷霆清算",
    settingPillars:
      "主角隐藏权柄与旧部势力、丈母娘家族现实势利网、当年隐退血案",
    openingRhythm:
      "第1章把轻视羞辱与护短危机拉到顶点，第2章暗令齐发蓄势，第3章亮冰山一角全场失声"
  },
  悬疑脑洞: {
    genre: "悬疑脑洞",
    hookFocus: "惊悚游戏/诡异直播/死亡回档 / 反套路骚操作通关 / 悬念与爽感齐飞",
    settingPillars:
      "诡异副本通关机制、主角专属脑洞底牌、积分商城与现实侵蚀危机",
    openingRhythm:
      "开篇直接拉入必死新手诡局，三章内用反常规脑洞秀翻全场并拿S级隐藏评价"
  },
  现言甜宠: {
    genre: "现言甜宠",
    hookFocus: "高糖直球偏爱 / 反差萌同居或契约恋爱 / 全程无虐姨母笑护短",
    settingPillars:
      "男女主互补反差人设、高甜互动固定场景、助攻配角与轻快事业线",
    openingRhythm:
      "开篇制造乌龙初遇或闪婚同框，三章内给出第一次越界心动与独宠偏爱信号"
  },
  异世穿越: {
    genre: "异世穿越",
    hookFocus: "现代认知或金手指降临异界 / 开荒基建或女强逆袭 / 征服异域法则",
    settingPillars:
      "异世界生存铁律与阶层、现代知识/空间变现路径、各方部族或帝国势力",
    openingRhythm:
      "开篇落地蛮荒、流放或祭祀危局，三章内凭超前手腕活下来并折服首位关键人物"
  },
  快穿: {
    genre: "快穿",
    hookFocus:
      "满级大佬穿梭小世界 / 专治恋爱脑与极品虐渣 / 一世界一新奇人设爽点",
    settingPillars:
      "快穿局任务与积分体系、各小世界原主执念清单、跨世界切片羁绊暗线",
    openingRhythm:
      "第1章卡在原主被害最惨一刻睁眼，第2章当场掀桌反杀渣贱，第3章彻底扭转死局"
  },
  女频悬疑: {
    genre: "女频悬疑",
    hookFocus: "女性视角细腻心理博弈 / 连环奇案与人性幽微 / 清醒大女主抽丝剥茧",
    settingPillars:
      "核心悬案时间线与物证链、女性处境与隐秘关系网、搭档试探与信任机制",
    openingRhythm:
      "开篇以反常细节或凶案现场切入，三章内借敏锐观察推翻表象定论并锁定新疑点"
  },
  末日求生: {
    genre: "末日求生",
    hookFocus:
      "重生天灾前疯狂囤百亿物资 / 打造固若金汤安全屋 / 绝不圣母看极品自食恶果",
    settingPillars:
      "极寒高温洪涝演化表、空间囤货清单与安防等级、小区邻里人性百态",
    openingRhythm:
      "第1章重生回末日前倒计时变卖资产，第2章扫空仓库改建安全屋，第3章天灾降临冷眼看仇人敲门"
  },
  双男主: {
    genre: "双男主",
    hookFocus: "双强宿命博弈与灵魂羁绊 / 高智商并肩破局 / 克制深沉的张力拉扯",
    settingPillars:
      "双主角对立又互补的立场身份、共同卷入的连环大局、信任破冰节点",
    openingRhythm:
      "开篇以一场高手过招或立场交锋切入，三章内立住双人极致人设反差与命运捆绑"
  },
  无CP: {
    genre: "无CP",
    hookFocus: "主角独美搞事业封神 / 无感情线拖泥带水 / 宏大世界探索与群像高光",
    settingPillars:
      "清晰的事业/晋升主线目标、多元鲜活的群像伙伴与对手、硬核世界规则",
    openingRhythm:
      "开篇直奔核心生存或立业目标，三章内展现主角杀伐清醒的行动力与长线野心"
  }
};

export interface ShortWebNovelBlueprint {
  readonly genre: string;
  readonly leadInHook: string;
  readonly conflictAndAce: string;
  readonly coreTwist: string;
}

const ZH_SHORT_BLUEPRINTS: Record<string, ShortWebNovelBlueprint> = {
  追妻: {
    genre: "追妻",
    leadInHook:
      "第一人称切入心死节点（签下离婚协议/销毁信物/倒计时离开），前300字立住极致落差",
    conflictAndAce:
      "男主与偏心亲友习以为常地轻视施压，女主平静交割、暗中备好事业退路与真相证据",
    coreTwist:
      "女主彻底人间蒸发或惊艳登顶，当年替罪/隐情曝光，男主崩溃追悔却再也追不回"
  },
  世情: {
    genre: "世情",
    leadInHook:
      "从分房、偏心养老、彩礼或职场背锅的具体冲突现场入局，细节真实扎心",
    conflictAndAce:
      "极品亲属道德绑架步步紧逼，主角不再隐忍，悄悄录音留证并切断经济输血",
    coreTwist:
      "关键场合公开掀桌算总账，让吸血者自食恶果，主角全身而退活出舒心日子"
  },
  重生复仇: {
    genre: "重生复仇",
    leadInHook:
      "惨死真相揭晓瞬间睁眼回到命运拐点，带着彻骨恨意与先知信息差立刻落子",
    conflictAndAce:
      "顺水推舟让前世仇人跳进自己挖的陷阱，提前截胡机缘、搜集铁证",
    coreTwist: "大婚/寿宴/封赏高光时刻当众反转收网，把前世之痛百倍奉还"
  },
  真假千金: {
    genre: "真假千金",
    leadInHook: "认亲宴或偏心修罗场开局，家人护着假千金逼真千金让步认错",
    conflictAndAce:
      "真千金当场断亲止损，转头回归顶级师门/科研豪门或亮出满级大佬马甲",
    coreTwist: "假千金谎言崩塌连累全家破产求救，真千金站在高处冷淡俯视绝不原谅"
  },
  规则怪谈: {
    genre: "规则怪谈",
    leadInHook:
      "前200字直接贴出染血或违背常理的《守则》，最后一条与前文自相矛盾",
    conflictAndAce:
      "旁人盲从守则接连触发死局，主角从字迹、时间差抓出认知污染漏洞",
    coreTwist:
      "看似庇护主角的规则制定者才是诡异本体，主角反用规则漏洞完成绝地反杀"
  },
  都市脑洞: {
    genre: "都市脑洞",
    leadInHook:
      "突发反常识脑洞设定（万物标价/死亡回档/弹幕剧透）直击眼前生死或穷困危局",
    conflictAndAce: "反派以为稳操胜券疯狂加注，主角卡脑洞机制BUG悄然完成布局",
    coreTwist: "结算时刻底牌揭晓引发全场震动，身份与结局双重高能反转"
  },
  战神赘婿: {
    genre: "战神赘婿",
    leadInHook: "三年隐忍期满或妻女受辱危急关头，一通绝密专线打进宴会厅",
    conflictAndAce:
      "势利亲戚与地头蛇层层羞辱逼退，主角淡定倒数计时等待人马合围",
    coreTwist: "大人物齐聚跪迎，顶级权柄揭晓，所有跳梁小丑当场悔断肠"
  }
};

const DEFAULT_ZH_SHORT_BLUEPRINT: ShortWebNovelBlueprint = {
  genre: "通用短篇",
  leadInHook: "前300字用第一人称强冲突画面或反常悬念入局，绝不铺垫寒暄",
  conflictAndAce: "反派极限施压拉满情绪张力，同步草蛇灰线埋好主角隐藏底牌",
  coreTwist: "中后段引爆身份/信息差大反转，有仇当场报，干脆利落收尾"
};

const DEFAULT_EN_SHORT_BLUEPRINT: ShortWebNovelBlueprint = {
  genre: "Short Fiction",
  leadInHook:
    "Open within 300 words on an acute crisis, anomaly, or emotional blow",
  conflictAndAce:
    "Escalate pressure fast while planting fair clues to the protagonist's hidden ace",
  coreTwist:
    "Deliver a sharp identity or information-gap reversal with immediate, clean payoff"
};

export function resolveShortWebNovelBlueprint(
  genre: string
): ShortWebNovelBlueprint {
  if (i18n.global.locale.value === "en-US") {
    return { ...DEFAULT_EN_SHORT_BLUEPRINT, genre };
  }
  return ZH_SHORT_BLUEPRINTS[genre] ?? { ...DEFAULT_ZH_SHORT_BLUEPRINT, genre };
}

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
      prompt: longCraftT("planPremise", { bookTitle, genre })
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
      prompt: longCraftT("planWorld", {
        bookTitle,
        pillars: blueprint.settingPillars
      })
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
      prompt: longCraftT("planCharacters", { bookTitle })
    },
    {
      id: "plot-golden",
      order: 4,
      title: longCraftT("step4Title"),
      summary: longCraftT("step4Summary"),
      statusLabel: hasUserPlotProgress
        ? longCraftT("countPlot", { volumes: volumeCount, cards: cardCount })
        : longCraftT("statusPending"),
      prompt: longCraftT("planOpening", { bookTitle })
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
      prompt: longCraftT("draftChapter", { bookTitle })
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
  genre: string,
  index: LongWorkspaceIndexSnapshot | null = null,
  selection: Pick<
    LongWorkspaceSelection,
    "bookLineVolumeId" | "plotPointVolumeId" | "chapterCardId"
  > | null = null
): WebNovelCraftSkillCard[] {
  const plot = index?.plot;
  const volumeId =
    selection?.bookLineVolumeId ??
    selection?.plotPointVolumeId ??
    (selection?.chapterCardId
      ? plot?.chapterCards.find((card) => card.id === selection.chapterCardId)
          ?.volumeId
      : undefined);
  const onlyVolume = plot?.volumes.length === 1 ? plot.volumes[0] : undefined;
  const volume = volumeId
    ? plot?.volumes.find((item) => item.id === volumeId)
    : onlyVolume;
  const scope = volume
    ? longCraftT("reviewSelectedVolume", {
        order: volume.order,
        volume: volume.title
      })
    : longCraftT("reviewChooseVolume");
  const preset = resolveLongBookFrameworkPreset(genre);
  const genreSkill: WebNovelCraftSkillCard =
    preset.id === "romance_modern"
      ? {
          id: "romance-tension-framework",
          skillName: "言情情感拉扯与关系推进",
          title: longCraftT("skillRomanceTitle"),
          description: longCraftT("skillRomanceDesc"),
          prompt: `请调用 load_skill 加载「言情情感拉扯与关系推进」，结合《${bookTitle}》（${genre}）当前书线与人物关系，规划本卷双主角的四阶关系位移、拉扯名场面与读者排雷红线。`
        }
      : preset.id === "romance_ancient" || preset.id === "history_military"
        ? {
            id: "intrigue-court-household",
            skillName: "宫斗宅斗与古代权谋布局",
            title: longCraftT("skillIntrigueTitle"),
            description: longCraftT("skillIntrigueDesc"),
            prompt: `请调用 load_skill 加载「宫斗宅斗与古代权谋布局」，对照《${bookTitle}》（${genre}）的礼法品级红线与各方派系，设计三方博弈棋盘与局中局反杀链条。`
          }
        : preset.id === "suspense_horror"
          ? {
              id: "suspense-rules-horror",
              skillName: "悬疑诡计与规则怪谈设计",
              title: longCraftT("skillRulesHorrorTitle"),
              description: longCraftT("skillRulesHorrorDesc"),
              prompt: `请调用 load_skill 加载「悬疑诡计与规则怪谈设计」，为《${bookTitle}》（${genre}）梳理表里真假规则表、试错代价梯度与公平线索红鲱鱼账本。`
            }
          : preset.id === "period_farming" ||
              preset.id === "quick_transmigration"
            ? {
                id: "period-farming-brainhole",
                skillName: "年代种田与脑洞系统节奏",
                title: longCraftT("skillPeriodBrainholeTitle"),
                description: longCraftT("skillPeriodBrainholeDesc"),
                prompt: `请调用 load_skill 加载「年代种田与脑洞系统节奏」，为《${bookTitle}》（${genre}）拆解阶段升级目标、信息差变现路径与高频正反馈爽点循环。`
              }
            : {
                id: "golden-finger-catharsis",
                skillName: "金手指设计与压抑释放爽点循环",
                title: longCraftT("skillCatharsisTitle"),
                description: longCraftT("skillCatharsisDesc"),
                prompt: `请调用 load_skill 加载「金手指设计与压抑释放爽点循环」，诊断《${bookTitle}》（${genre}）的金手指进化边界与「受压—蓄力—掀桌释放—多视角震惊」爽感闭环。`
              };

  return [
    {
      id: "golden-three-chapters",
      skillName: "黄金三章与开篇钩子",
      title: longCraftT("skillGoldenTitle"),
      description: longCraftT("skillGoldenDesc"),
      prompt: `请调用 load_skill 加载「黄金三章与开篇钩子」，对照《${bookTitle}》（${genre}）当前书线与前三章章卡/正文，逐章诊断开篇 500 字入局速度、核心卖点兑现与第三章卡点力度，并给出可直接落盘的改写方案。`
    },
    genreSkill,
    {
      id: "world-power-system",
      skillName: "世界观与防战力崩坏设定",
      title: longCraftT("skillPowerTitle"),
      description: longCraftT("skillPowerDesc"),
      prompt: `请调用 load_skill 加载「世界观与防战力崩坏设定」，审计或补全《${bookTitle}》的阶梯上限、硬约束代价与资源闭环，排查后期崩坏隐患。`
    },
    {
      id: "map-upgrade-anticipation",
      skillName: "换地图升级与长线期待感管理",
      title: longCraftT("skillMapUpgradeTitle"),
      description: longCraftT("skillMapUpgradeDesc"),
      prompt: `请调用 load_skill 加载「换地图升级与长线期待感管理」，检查《${bookTitle}》当前的短·中·长三层期待感钩子与分卷换地图软着陆衔接。`
    },
    {
      id: "character-arc-ensemble",
      skillName: "人物弧光与网文群像设计",
      title: longCraftT("skillCharTitle"),
      description: longCraftT("skillCharDesc"),
      prompt: `请调用 load_skill 加载「人物弧光与网文群像设计」，检视《${bookTitle}》现有主要角色的目标动机、反派压迫感、配角功能位与语言指纹，补齐防 OOC 红线。`
    },
    {
      id: "volume-chapter-review",
      skillName: "卷内章卡审读",
      title: longCraftT("reviewVolumeTitle"),
      description: longCraftT("reviewVolumeSummary"),
      prompt: longCraftT("reviewVolume", { bookTitle, scope })
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
