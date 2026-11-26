import type { BookGenreChannel } from "./long-book-genres";

export const LONG_WEB_NOVEL_PACING_MODES = [
  "fanqie",
  "qidian",
  "jinjiang"
] as const;
export type LongWebNovelPacingMode =
  (typeof LONG_WEB_NOVEL_PACING_MODES)[number];

export const SHORT_WEB_NOVEL_PACING_MODES = [
  "viral_short",
  "refined_short"
] as const;
export type ShortWebNovelPacingMode =
  (typeof SHORT_WEB_NOVEL_PACING_MODES)[number];

export interface WebNovelTropeOption {
  readonly tag: string;
  readonly category: "flow" | "persona" | "plot";
  readonly craftRule: string;
}

export const WEB_NOVEL_CHANNEL_TROPES: Record<
  BookGenreChannel,
  readonly WebNovelTropeOption[]
> = {
  male: [
    {
      tag: "系统",
      category: "flow",
      craftRule:
        "系统面板简洁直观，奖励必须绑定主角主动破局行为，设冷却或前置条件防后期崩盘。"
    },
    {
      tag: "面板加点",
      category: "flow",
      craftRule:
        "以熟练度或属性破限制造肉眼可见的成长正反馈，每次加点突破都对应一场实战检验。"
    },
    {
      tag: "模拟器",
      category: "flow",
      craftRule:
        "利用模拟推演试错绝境死局，现实中借信息差与保留奖励精准截胡、反杀强敌。"
    },
    {
      tag: "凡人流",
      category: "flow",
      craftRule:
        "出身微末、资源匮乏，重利弊权衡、步步为营与底牌藏拙，反派智商全程在线。"
    },
    {
      tag: "苟道长生",
      category: "flow",
      craftRule:
        "稳健发育不浪不强出头，善用时间跨度熬死强敌，一旦出手必先断后路斩草除根。"
    },
    {
      tag: "迪化脑补",
      category: "flow",
      craftRule:
        "主角言行出于朴素合理目的，配角与反派基于认知差自动脑补成绝世布局，反差拉满。"
    },
    {
      tag: "无敌流",
      category: "flow",
      craftRule:
        "战力横推不憋屈，重点写身边人视角震撼、势力秩序洗牌与更高维秘密揭露。"
    },
    {
      tag: "重生",
      category: "flow",
      craftRule:
        "紧扣前世遗憾与先知时间窗口，开局先拿关键机缘、断仇人根基，蝴蝶效应逐层扩散。"
    },
    {
      tag: "灵气复苏",
      category: "flow",
      craftRule:
        "日常秩序与超凡觉醒碰撞，紧抓天地异变各阶段红利、官方序列与禁区异兽威胁。"
    },
    {
      tag: "全民转职",
      category: "flow",
      craftRule:
        "开局觉醒看似废柴或唯一的隐藏职业/词条，靠机制联动刷本破纪录、登顶天梯。"
    },
    {
      tag: "国运直播",
      category: "flow",
      craftRule:
        "副本抉择绑定现实国运具现奖励，穿插弹幕质疑到震惊反转的多视角情绪放大。"
    },
    {
      tag: "无限流",
      category: "flow",
      craftRule:
        "主世界与高危副本双线推进，每场副本独立闭环破局，结算奖励反哺主线。"
    },
    {
      tag: "杀伐果断",
      category: "persona",
      craftRule: "恩怨分明不圣母，对确认敌意者绝不留隔夜隐患，利益与底线清晰。"
    },
    {
      tag: "扮猪吃虎",
      category: "persona",
      craftRule:
        "低调敛息蓄势，待对手把筹码与退路全部押上时一击掀桌，拉满反差爽感。"
    },
    {
      tag: "智商在线",
      category: "persona",
      craftRule:
        "正反派均按自身利益与掌握信息做最优解，靠布局与阳谋破局而非对手降智。"
    },
    {
      tag: "幕后黑手",
      category: "persona",
      craftRule:
        "主角隐于幕后编织马甲、缔造组织或复苏超凡，引导天下势力在棋盘中博弈。"
    },
    {
      tag: "退婚打脸",
      category: "plot",
      craftRule:
        "开局立下三年之约或当场休妻反击，压抑不超过一章，按期兑现更高阶打脸。"
    },
    {
      tag: "群像",
      category: "plot",
      craftRule:
        "重要配角各有独立执念、高光时刻与语言指纹，绝不做复读机工具人。"
    }
  ],
  female: [
    {
      tag: "穿书",
      category: "flow",
      craftRule:
        "手握原著剧情走向却面临蝴蝶效应，改写炮灰/恶毒女配死局并反抢核心机缘。"
    },
    {
      tag: "读心术",
      category: "flow",
      craftRule:
        "表面端庄乖巧与内心吃瓜吐槽形成强反差，明确谁能听见心声的硬规则，借心声改写全员悲剧。"
    },
    {
      tag: "重生",
      category: "flow",
      craftRule:
        "前世血泪教训化为今生清醒决绝，开篇即止损断孽缘、护至亲、抢先机。"
    },
    {
      tag: "系统",
      category: "flow",
      craftRule:
        "任务奖励直接服务于虐渣、搞钱或搞事业，不让系统喧宾夺主削弱女主主观能动性。"
    },
    {
      tag: "空间囤货",
      category: "flow",
      craftRule:
        "灾变或流放前精准清空资产疯狂囤货，绝境中凭物资充沛与安全感形成强烈爽感对比。"
    },
    {
      tag: "快穿攻略",
      category: "flow",
      craftRule:
        "单世界节奏干脆利落，精准切入原主痛点完成虐渣或极限攻略，世界间暗藏主线羁绊。"
    },
    {
      tag: "大女主",
      category: "persona",
      craftRule:
        "全程以女主野心、成长与掌权为核心驱动，绝不恋爱脑让渡核心利益。"
    },
    {
      tag: "清醒独立",
      category: "persona",
      craftRule:
        "重利益边界与自我成长，面对道德绑架或廉价深情当场反击，绝不内耗。"
    },
    {
      tag: "真假千金",
      category: "persona",
      craftRule:
        "打破偏心家人PUA，凭自身满级实力或事业高光让原生家庭高攀不起、追悔莫及。"
    },
    {
      tag: "团宠萌宝",
      category: "persona",
      craftRule:
        "突出自然灵动的亲情互动与护短爽感，全员大佬花式宠爱但各有鲜明性格。"
    },
    {
      tag: "疯批忠犬",
      category: "persona",
      craftRule:
        "男主对外狠厉危险、唯独对女主克制臣服，拉满危险感与偏执独宠的张力。"
    },
    {
      tag: "强强",
      category: "persona",
      craftRule:
        "双主角智商能力均势，交锋试探与并肩破局势均力敌，拒绝单方面依附。"
    },
    {
      tag: "先婚后爱",
      category: "plot",
      craftRule:
        "从契约/联姻的礼貌疏离出发，借同居细节、外部护短与危机共渡自然升温真香。"
    },
    {
      tag: "破镜重圆",
      category: "plot",
      craftRule:
        "重逢戏张力拉满，当年分开须有沉重非儿戏的苦衷，在拉扯中逐层揭开旧伤。"
    },
    {
      tag: "追妻火葬场",
      category: "plot",
      craftRule:
        "女主心死抽身果决不回头摇摆；男主追妻必须付出剥皮抽筋的实质代价，拒绝廉价原谅。"
    },
    {
      tag: "虐渣打脸",
      category: "plot",
      craftRule:
        "有仇当场报、证据链甩在明面，让极品与渣贱身败名裂，绝不拖延喂毒。"
    },
    {
      tag: "逃荒致富",
      category: "plot",
      craftRule:
        "先保命立规矩护家人，再靠手艺、水源药材或先机从流民一路发家立业。"
    },
    {
      tag: "马甲掉马",
      category: "plot",
      craftRule: "提前铺垫多重身份细节，在众人轻视的顶点逐层掉马引爆全场震动。"
    },
    {
      tag: "双向救赎",
      category: "plot",
      craftRule:
        "两人在低谷泥沼中成为彼此唯一的光，情感转折必须落在具体守护行动上。"
    },
    {
      tag: "1v1双洁",
      category: "plot",
      craftRule:
        "严守双洁与唯一情感指向排雷红线，杜绝男女主与配角产生越界暧昧误导。"
    }
  ]
};

const AGENTS_MD_MAX_CODE_POINTS = 10_000;

const TROPE_CRAFT_RULES: Readonly<Record<string, string>> = {
  系统: "系统面板简洁直观，奖励必须绑定主角主动破局行为，设冷却或前置条件防后期崩盘。",
  面板加点:
    "以熟练度或属性破限制造肉眼可见的成长正反馈，每次加点突破都对应一场实战检验。",
  模拟器:
    "利用模拟推演试错绝境死局，现实中借信息差与保留奖励精准截胡、反杀强敌。",
  凡人流:
    "出身微末、资源匮乏，重利弊权衡、步步为营与底牌藏拙，反派智商全程在线。",
  苟道长生:
    "稳健发育不浪不强出头，善用时间跨度熬死强敌，一旦出手必先断后路斩草除根。",
  迪化脑补:
    "主角言行出于朴素合理目的，配角与反派基于认知差自动脑补成绝世布局，反差拉满。",
  无敌流:
    "战力横推不憋屈，重点写身边人视角震撼、势力秩序洗牌与更高维秘密揭露。",
  重生: "紧扣前世遗憾与先知时间窗口，开局先拿关键机缘、断仇人根基，蝴蝶效应逐层扩散。",
  灵气复苏:
    "日常秩序与超凡觉醒碰撞，紧抓天地异变各阶段红利、官方序列与禁区异兽威胁。",
  全民转职:
    "开局觉醒看似废柴或唯一的隐藏职业/词条，靠机制联动刷本破纪录、登顶天梯。",
  国运直播:
    "副本抉择绑定现实国运具现奖励，穿插弹幕质疑到震惊反转的多视角情绪放大。",
  无限流: "主世界与高危副本双线推进，每场副本独立闭环破局，结算奖励反哺主线。",
  杀伐果断: "恩怨分明不圣母，对确认敌意者绝不留隔夜隐患，利益与底线清晰。",
  扮猪吃虎:
    "低调敛息蓄势，待对手把筹码与退路全部押上时一击掀桌，拉满反差爽感。",
  智商在线:
    "正反派均按自身利益与掌握信息做最优解，靠布局与阳谋破局而非对手降智。",
  幕后黑手:
    "主角隐于幕后编织马甲、缔造组织或复苏超凡，引导天下势力在棋盘中博弈。",
  退婚打脸:
    "开局立下三年之约或当场休妻反击，压抑不超过一章，按期兑现更高阶打脸。",
  群像: "重要配角各有独立执念、高光时刻与语言指纹，绝不做复读机工具人。",
  穿书: "手握原著剧情走向却面临蝴蝶效应，改写炮灰/恶毒女配死局并反抢核心机缘。",
  读心术:
    "表面端庄乖巧与内心吃瓜吐槽形成强反差，明确谁能听见心声的硬规则，借心声改写全员悲剧。",
  空间囤货:
    "灾变或流放前精准清空资产疯狂囤货，绝境中凭物资充沛与安全感形成强烈爽感对比。",
  快穿攻略:
    "单世界节奏干脆利落，精准切入原主痛点完成虐渣或极限攻略，世界间暗藏主线羁绊。",
  大女主: "全程以女主野心、成长与掌权为核心驱动，绝不恋爱脑让渡核心利益。",
  清醒独立: "重利益边界与自我成长，面对道德绑架或廉价深情当场反击，绝不内耗。",
  真假千金:
    "打破偏心家人PUA，凭自身满级实力或事业高光让原生家庭高攀不起、追悔莫及。",
  团宠萌宝:
    "突出自然灵动的亲情互动与护短爽感，全员大佬花式宠爱但各有鲜明性格。",
  疯批忠犬:
    "男主对外狠厉危险、唯独对女主克制臣服，拉满危险感与偏执独宠的张力。",
  强强: "双主角智商能力均势，交锋试探与并肩破局势均力敌，拒绝单方面依附。",
  先婚后爱:
    "从契约/联姻的礼貌疏离出发，借同居细节、外部护短与危机共渡自然升温真香。",
  破镜重圆:
    "重逢戏张力拉满，当年分开须有沉重非儿戏的苦衷，在拉扯中逐层揭开旧伤。",
  追妻火葬场:
    "女主心死抽身果决不回头摇摆；男主追妻必须付出剥皮抽筋的实质代价，拒绝廉价原谅。",
  虐渣打脸: "有仇当场报、证据链甩在明面，让极品与渣贱身败名裂，绝不拖延喂毒。",
  逃荒致富: "先保命立规矩护家人，再靠手艺、水源药材或先机从流民一路发家立业。",
  马甲掉马: "提前铺垫多重身份细节，在众人轻视的顶点逐层掉马引爆全场震动。",
  双向救赎:
    "两人在低谷泥沼中成为彼此唯一的光，情感转折必须落在具体守护行动上。",
  "1v1双洁":
    "严守双洁与唯一情感指向排雷红线，杜绝男女主与配角产生越界暧昧误导。"
};

function sanitizeSingleLineLabel(value: string, maxCodePoints = 120): string {
  const cleaned = value
    .replace(/[\r\n\0]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const codePoints = Array.from(cleaned);
  return codePoints.length <= maxCodePoints
    ? cleaned
    : codePoints.slice(0, maxCodePoints).join("");
}

function sanitizeTropeLabel(value: string): string {
  const cleaned = value
    .replace(/[\r\n\0]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  let result = "";
  for (const ch of cleaned) {
    if (result.length + ch.length > 32) break;
    result += ch;
  }
  return result.trim();
}

export function normalizeWebNovelTropes(
  tropes: readonly string[] | undefined
): string[] | undefined {
  if (!tropes?.length) return undefined;
  const unique = new Set<string>();
  for (const item of tropes) {
    const cleaned = sanitizeTropeLabel(item);
    if (cleaned) unique.add(cleaned);
    if (unique.size >= 6) break;
  }
  return unique.size > 0 ? [...unique] : undefined;
}

function normalizeUniqueTropes(
  tropes: readonly string[] | undefined
): string[] {
  return normalizeWebNovelTropes(tropes) ?? [];
}

function appendSectionWithinBudget(
  baseText: string,
  section: string,
  maxCodePoints = AGENTS_MD_MAX_CODE_POINTS
): string {
  const trimmedBase = baseText.trimEnd();
  const combined = `${trimmedBase}\n\n${section}\n`;
  const codePoints = Array.from(combined);
  if (codePoints.length <= maxCodePoints) {
    return combined;
  }
  const baseCodePoints = Array.from(trimmedBase);
  if (baseCodePoints.length >= maxCodePoints) {
    return baseCodePoints.slice(0, maxCodePoints).join("");
  }
  return `${codePoints.slice(0, maxCodePoints - 1).join("")}\n`;
}

const LONG_PACING_GUIDES: Record<
  LongWebNovelPacingMode,
  { readonly label: string; readonly guide: string }
> = {
  fanqie: {
    label: "番茄快节奏（免费算法流）",
    guide:
      "开篇前 300 字直入强冲突或亮金手指，黄金三章内必完成首次反杀/打脸；小压小爽、憋屈绝不隔章，每章结尾留强钩子拉高 10 万字首秀完读率。"
  },
  qidian: {
    label: "起点长线精品（付费订阅流）",
    guide:
      "重世界观自洽、力量/社会阶梯硬约束与配角智商在线；铺设跨卷草灰蛇线，每 3–5 万字一场阶段高潮，换地图时做好战力锚定与人情软着陆。"
  },
  jinjiang: {
    label: "晋江人设情感（女频精品/IP流）",
    guide:
      "重极致人设反差、CP 宿命感与细腻心理推拉；名场面情绪浓度拉满，严守读者排雷红线（感情唯一性/事业线独立性），让每次关系推进都有行动支撑。"
  }
};

const SHORT_PACING_GUIDES: Record<
  ShortWebNovelPacingMode,
  { readonly label: string; readonly guide: string }
> = {
  viral_short: {
    label: "盐选/番茄爆款短篇（强钩子强反转）",
    guide:
      "全篇 8000–15000 字寸土寸金；导语前 300 字直接抛死局、极致痛点或诡异守则；按「导语钩子 → 极限施压 → 暗藏底牌 → 掀桌大反转 → 有仇当场报」推进，短句快切不注水。"
  },
  refined_short: {
    label: "精品叙事短篇（重质感与余韵）",
    guide:
      "聚焦核心两难处境与人物弧光，用精准动作、对白潜台词与意象前后呼应推进转折，收尾克制有力、留有余味。"
  }
};

export interface LongBookFrameworkPreset {
  readonly id: string;
  readonly name: string;
  readonly defaultPacing: LongWebNovelPacingMode;
  readonly worldCategories: readonly [
    readonly [id: string, title: string],
    readonly [id: string, title: string],
    readonly [id: string, title: string],
    readonly [id: string, title: string],
    readonly [id: string, title: string],
    readonly [id: string, title: string],
    readonly [id: string, title: string]
  ];
  readonly coreDrive: string;
  readonly structureRhythm: string;
  readonly guardrails: string;
}

const FANTASY_CULTIVATION_FRAMEWORK: LongBookFrameworkPreset = {
  id: "fantasy_cultivation",
  name: "玄幻仙侠升级换图框架",
  defaultPacing: "qidian",
  worldCategories: [
    ["world_rules", "核心规则与金手指"],
    ["world_factions", "宗门与各方势力"],
    ["world_geography", "三层换图版图"],
    ["world_history", "纪元与旧案秘辛"],
    ["world_terminology", "稀缺资源与货币"],
    ["world_realms", "境界与战力天花板"],
    ["world_items", "功法法宝与奇物"]
  ],
  coreDrive:
    "以境界阶梯、稀缺修炼资源争夺与金手指破局为引擎，通过「压抑蓄力 → 越级反杀 → 换地图刷新上限」驱动长线连载。",
  structureRhythm:
    "黄金三章立生死危机与金手指首秀 → 首卷垄断新手村/外门资源 → 中期大域争霸、秘境夺宝与换图升级 → 后期揭开纪元大劫登顶。",
  guardrails:
    "开书锁死最高境界天花板与跨阶代价；金手指须有冷却或资源消耗，严防后期数值通胀与换地图割裂。"
};

const WUXIA_JIANGHU_FRAMEWORK: LongBookFrameworkPreset = {
  id: "wuxia_jianghu",
  name: "武侠江湖恩怨框架",
  defaultPacing: "qidian",
  worldCategories: [
    ["world_rules", "江湖规矩与底线"],
    ["world_factions", "正邪门派与世家"],
    ["world_geography", "州府水道与秘境"],
    ["world_history", "灭门旧案与恩怨谱"],
    ["world_terminology", "内功门径与克制"],
    ["world_realms", "武学境界与高手榜"],
    ["world_items", "神兵秘籍与奇毒"]
  ],
  coreDrive:
    "以快意恩仇、侠义底线与武学招式克制为核心，在门派暗流与旧案追查中立住人物风骨。",
  structureRhythm:
    "开篇以雨夜交锋或旧案信物入局 → 卷内逐层剥开名门伪善与幕后黑手 → 宿敌论剑与道义抉择 → 终局了结江湖因果。",
  guardrails:
    "重招式破绽、地形暗器与内力消耗，不写无代价法术轰炸；高手与反派皆有成名理由与门派立场。"
};

const URBAN_MODERN_FRAMEWORK: LongBookFrameworkPreset = {
  id: "urban_modern",
  name: "都市脑洞与现实逆袭框架",
  defaultPacing: "fanqie",
  worldCategories: [
    ["world_rules", "核心机制与金手指"],
    ["world_factions", "家族企业与圈层"],
    ["world_geography", "城市与行业舞台"],
    ["world_history", "主角过往与伏线"],
    ["world_terminology", "财富资产与筹码"],
    ["world_realms", "身份阶梯与段位"],
    ["world_items", "关键底牌与人脉"]
  ],
  coreDrive:
    "用接地气的现实痛点叠加脑洞系统、高武觉醒或顶级身份底牌，持续输出打脸逆袭、暴富跃迁或守护热血爽感。",
  structureRhythm:
    "第1章抛现实憋屈困局并激活外挂/底牌 → 第2–3章当场反击立威 → 卷内从身边小圈子逐级打穿市省、行业巨头乃至全球舞台。",
  guardrails:
    "社会常识与商业利益逻辑要稳；压抑绝不过夜，反派挑衅要有合理利益驱动而非纯工具人送脸。"
};

const ROMANCE_MODERN_FRAMEWORK: LongBookFrameworkPreset = {
  id: "romance_modern",
  name: "现代言情甜虐拉扯框架",
  defaultPacing: "jinjiang",
  worldCategories: [
    ["world_rules", "感情红线与排雷"],
    ["world_factions", "豪门家族与职场"],
    ["world_geography", "同居与对手戏舞台"],
    ["world_history", "前尘心结与旧伤"],
    ["world_terminology", "利益筹码与阻碍"],
    ["world_realms", "关系升温里程碑"],
    ["world_items", "信物与掉马契机"]
  ],
  coreDrive:
    "围绕双主角人设张力、心理防线与现实利益捆绑，高频制造暧昧试探、护短打脸、酸涩拉扯与双向救赎。",
  structureRhythm:
    "开篇直切契约联姻、重逢修罗场或决裂现场 → 前期同框推拉与打脸极品配角 → 中段旧伤揭开与核心抉择 → 后期追妻兑现或巅峰并肩。",
  guardrails:
    "严守 1v1/双洁/无CP 等开书承诺不踩雷；心动与和解必须靠具体行动和代价证明，拒绝嘴炮深情与降智误会。"
};

const ROMANCE_ANCIENT_FRAMEWORK: LongBookFrameworkPreset = {
  id: "romance_ancient",
  name: "古言宅斗宫斗与权谋框架",
  defaultPacing: "jinjiang",
  worldCategories: [
    ["world_rules", "宗族礼法与排雷"],
    ["world_factions", "后宅与朝堂派系"],
    ["world_geography", "府邸宫闱与地域"],
    ["world_history", "前世今生与旧案"],
    ["world_terminology", "嫁妆账目与产业"],
    ["world_realms", "嫡庶位份与品级"],
    ["world_items", "信物医毒与底牌"]
  ],
  coreDrive:
    "以古代宗法嫡庶、后宫位份与朝堂联姻为棋盘，靠重生先知、读心吃瓜或清醒心计完成虐渣立身与宿命拉扯。",
  structureRhythm:
    "开篇落入退婚、下药、抄家或选秀死局 → 三章内反将一军立住掌家/立足筹码 → 中段内宅与前朝联动破局 → 终局大仇得报、权柄在握。",
  guardrails:
    "礼法尊卑与时代规矩不能崩；主角反杀靠账本物证、人心分化与借势打力，杜绝现代口号式降智碾压。"
};

const QUICK_TRANSMIGRATION_FRAMEWORK: LongBookFrameworkPreset = {
  id: "quick_transmigration",
  name: "快穿穿书与异世任务框架",
  defaultPacing: "fanqie",
  worldCategories: [
    ["world_rules", "系统绑定与任务规则"],
    ["world_factions", "原书主角团与反派"],
    ["world_geography", "小世界与副本舞台"],
    ["world_history", "原剧情线与崩坏点"],
    ["world_terminology", "积分气运与结算"],
    ["world_realms", "攻略与逆袭进度"],
    ["world_items", "金手指插件与道具"]
  ],
  coreDrive:
    "自带原剧情剧透或快穿系统切入炮灰绝境，快节奏改命虐渣、攻略高危反派，单元爽感密集且串联主世界悬念。",
  structureRhythm:
    "入局即卡在原主最惨节点 → 三章内撕毁原剧情完成首波反击 → 单元世界起承转合干脆结算 → 跨世界伏笔指向主神或切片男主真相。",
  guardrails:
    "每个小世界核心痛点与人设玩法必须差异化，绝不套同一模板水字数；原书男女主失势须有逻辑链。"
};

const PERIOD_FARMING_FRAMEWORK: LongBookFrameworkPreset = {
  id: "period_farming",
  name: "年代种田与逃荒致富框架",
  defaultPacing: "fanqie",
  worldCategories: [
    ["world_rules", "时代政策与物价"],
    ["world_factions", "家庭极品与邻里"],
    ["world_geography", "村镇县城与地图"],
    ["world_history", "重生节点与大事记"],
    ["world_terminology", "手艺营生与渠道"],
    ["world_realms", "家业升级阶梯"],
    ["world_items", "空间票证与物资"]
  ],
  coreDrive:
    "紧扣年代红利、开荒手艺或囤货空间，一边快意分家虐极品，一边从温饱奔小康、办厂经商，烟火气与赚钱爽感并重。",
  structureRhythm:
    "开篇直面偏心压榨、退亲或灾荒断粮 → 三章内分家止损并赚到首笔救命钱/粮 → 分卷按村、镇、省城逐级做大家业与温馨日常。",
  guardrails:
    "粮票工分、物价政策与农时地理严合年代常识；赚钱升级一步一脚印，保留鲜活邻里烟火气。"
};

const HISTORY_MILITARY_FRAMEWORK: LongBookFrameworkPreset = {
  id: "history_military",
  name: "历史争霸与铁血谍战框架",
  defaultPacing: "qidian",
  worldCategories: [
    ["world_rules", "朝纲官制与纪律"],
    ["world_factions", "皇权党争与各方势力"],
    ["world_geography", "州郡关隘与战略图"],
    ["world_history", "真实历史与改命点"],
    ["world_terminology", "钱粮税赋与后勤"],
    ["world_realms", "爵位军功与编制"],
    ["world_items", "军械技术与情报网"]
  ],
  coreDrive:
    "在钱粮、兵制、门阀与情报死线的硬约束下，凭现代视野或权谋手腕破死局、攀科技、掌兵权、改写山河走向。",
  structureRhythm:
    "开篇切入必死军情、流放边关或朝堂死局 → 首卷借一仗或一策立身入局 → 中期攒班底、革税兵、拓根据地 → 后期问鼎天下。",
  guardrails:
    "严守生产力、行军补给与通信时效；任何手搓工业或奇谋都须交代原料、工匠、资金与各方政治反应。"
};

const SCIFI_APOCALYPSE_FRAMEWORK: LongBookFrameworkPreset = {
  id: "scifi_apocalypse",
  name: "科幻星际与末日囤货求生框架",
  defaultPacing: "fanqie",
  worldCategories: [
    ["world_rules", "灾变法则与物理公理"],
    ["world_factions", "庇护所与各大阵营"],
    ["world_geography", "废土禁区与星域图"],
    ["world_history", "天灾演化时间线"],
    ["world_terminology", "物资能源与生态链"],
    ["world_realms", "异能序列与科技树"],
    ["world_items", "安全屋载具与装备"]
  ],
  coreDrive:
    "在极寒高温丧尸天灾或星际法则压迫下，靠提前囤货建安全屋、异能进化或硬核科技树在绝境中建立秩序。",
  structureRhythm:
    "开篇天灾倒计时囤货或废土绝境苏醒 → 三章内加固基地顶住首波冲击并与前世仇人形成强烈处境对比 → 分卷随天灾升级扩张势力。",
  guardrails:
    "物资消耗、能源维护与人性防线全程算清细账；不写圣母散财害己，用生存危机带出设定而非百科说教。"
};

const SUSPENSE_HORROR_FRAMEWORK: LongBookFrameworkPreset = {
  id: "suspense_horror",
  name: "悬疑脑洞与规则怪谈框架",
  defaultPacing: "fanqie",
  worldCategories: [
    ["world_rules", "表里规则与死线"],
    ["world_factions", "调查局与幕后组织"],
    ["world_geography", "怪谈副本与封闭舞台"],
    ["world_history", "案件与污染时间线"],
    ["world_terminology", "线索账本与红鲱鱼"],
    ["world_realms", "污染度与序列阶梯"],
    ["world_items", "诡物底牌与通关生路"]
  ],
  coreDrive:
    "以高压迫感诡异守则、中式民俗诡案与真假规则博弈抓人，靠细节推理与卡规则漏洞完成绝境反杀。",
  structureRhythm:
    "开篇300字亮出诡异纸条或反常命案 → 前三章配角违禁立威、主角勘破首条假规则 → 单元副本/案件层层反转并拼出世界真相。",
  guardrails:
    "明面守则必须混有假规则与隐藏生路，关键线索提前公平埋设；严禁靠机械降神或临时改规则强行通关。"
};

const GAME_SPORTS_FRAMEWORK: LongBookFrameworkPreset = {
  id: "game_sports",
  name: "游戏电竞与热血体育框架",
  defaultPacing: "qidian",
  worldCategories: [
    ["world_rules", "赛制规则与版本机制"],
    ["world_factions", "俱乐部战队与公会"],
    ["world_geography", "联赛赛场与副本地图"],
    ["world_history", "赛季赛程与荣辱史"],
    ["world_terminology", "战术体系与经济数值"],
    ["world_realms", "职业段位与荣誉榜"],
    ["world_items", "招牌绝活与核心装备"]
  ],
  coreDrive:
    "以版本先知、机制拆解、极限操作与团队群像为核心，在首杀竞速或职业联赛逆袭中点燃高燃竞技爽感。",
  structureRhythm:
    "开篇落入替补背锅、开服抢首杀或选拔赛绝境 → 三章内靠神级理解打出成名战 → 按选拔、常规赛、世界赛或大版本逐级冲冠。",
  guardrails:
    "赛制、数值与伤病体能真实可信；比赛重博弈心理与战术拆招，配合解说与观众席反应放大名场面。"
};

const GENERAL_FRAMEWORK: LongBookFrameworkPreset = {
  id: "general",
  name: "通用商业网文连载框架",
  defaultPacing: "fanqie",
  worldCategories: [
    ["world_rules", "核心规则与底线"],
    ["world_factions", "各方势力与阵营"],
    ["world_geography", "核心地图与舞台"],
    ["world_history", "前史与关键时间线"],
    ["world_terminology", "资源筹码与术语"],
    ["world_realms", "成长与关系阶梯"],
    ["world_items", "关键道具与底牌"]
  ],
  coreDrive:
    "以鲜明人设反差、高辨识度核心梗与环环相扣的期待感为主轴，持续通过「压抑—蓄力—释放」输出情绪价值。",
  structureRhythm:
    "黄金三章立冲突兑现核心卖点 → 每卷围绕明确地图/阶段目标打出小高潮 → 终局回收核心伏笔。",
  guardrails:
    "只维护会进入冲突与选择的硬设定；杜绝慢热铺垫、工具人降智与前后吃书。"
};

const GENRE_TO_FRAMEWORK: Readonly<Record<string, LongBookFrameworkPreset>> = {
  玄幻: FANTASY_CULTIVATION_FRAMEWORK,
  传统玄幻: FANTASY_CULTIVATION_FRAMEWORK,
  玄幻脑洞: FANTASY_CULTIVATION_FRAMEWORK,
  奇幻: FANTASY_CULTIVATION_FRAMEWORK,
  仙侠: FANTASY_CULTIVATION_FRAMEWORK,
  奇幻仙侠: FANTASY_CULTIVATION_FRAMEWORK,
  玄幻言情: FANTASY_CULTIVATION_FRAMEWORK,
  诸天: FANTASY_CULTIVATION_FRAMEWORK,

  武侠: WUXIA_JIANGHU_FRAMEWORK,

  都市: URBAN_MODERN_FRAMEWORK,
  都市脑洞: URBAN_MODERN_FRAMEWORK,
  都市高武: URBAN_MODERN_FRAMEWORK,
  都市修真: URBAN_MODERN_FRAMEWORK,
  战神赘婿: URBAN_MODERN_FRAMEWORK,
  都市日常: URBAN_MODERN_FRAMEWORK,
  都市生活: URBAN_MODERN_FRAMEWORK,
  现实: URBAN_MODERN_FRAMEWORK,
  职场商战: URBAN_MODERN_FRAMEWORK,
  搞笑轻松: URBAN_MODERN_FRAMEWORK,
  轻小说: URBAN_MODERN_FRAMEWORK,
  无CP: URBAN_MODERN_FRAMEWORK,

  现代言情: ROMANCE_MODERN_FRAMEWORK,
  现言甜宠: ROMANCE_MODERN_FRAMEWORK,
  豪门世家: ROMANCE_MODERN_FRAMEWORK,
  现言脑洞: ROMANCE_MODERN_FRAMEWORK,
  青春甜宠: ROMANCE_MODERN_FRAMEWORK,
  虐恋情深: ROMANCE_MODERN_FRAMEWORK,
  纯爱: ROMANCE_MODERN_FRAMEWORK,
  双男主: ROMANCE_MODERN_FRAMEWORK,
  言情: ROMANCE_MODERN_FRAMEWORK,
  现言: ROMANCE_MODERN_FRAMEWORK,

  古代言情: ROMANCE_ANCIENT_FRAMEWORK,
  古风世情: ROMANCE_ANCIENT_FRAMEWORK,
  宫斗宅斗: ROMANCE_ANCIENT_FRAMEWORK,
  古言脑洞: ROMANCE_ANCIENT_FRAMEWORK,
  民国言情: ROMANCE_ANCIENT_FRAMEWORK,
  古言: ROMANCE_ANCIENT_FRAMEWORK,

  异世穿越: QUICK_TRANSMIGRATION_FRAMEWORK,
  快穿: QUICK_TRANSMIGRATION_FRAMEWORK,

  种田: PERIOD_FARMING_FRAMEWORK,
  年代: PERIOD_FARMING_FRAMEWORK,

  历史: HISTORY_MILITARY_FRAMEWORK,
  历史脑洞: HISTORY_MILITARY_FRAMEWORK,
  军事: HISTORY_MILITARY_FRAMEWORK,
  抗战谍战: HISTORY_MILITARY_FRAMEWORK,
  古代权谋: HISTORY_MILITARY_FRAMEWORK,

  科幻: SCIFI_APOCALYPSE_FRAMEWORK,
  科幻末世: SCIFI_APOCALYPSE_FRAMEWORK,
  末日求生: SCIFI_APOCALYPSE_FRAMEWORK,
  末世: SCIFI_APOCALYPSE_FRAMEWORK,

  悬疑: SUSPENSE_HORROR_FRAMEWORK,
  悬疑脑洞: SUSPENSE_HORROR_FRAMEWORK,
  悬疑灵异: SUSPENSE_HORROR_FRAMEWORK,
  规则怪谈: SUSPENSE_HORROR_FRAMEWORK,
  悬疑恋爱: SUSPENSE_HORROR_FRAMEWORK,
  女频悬疑: SUSPENSE_HORROR_FRAMEWORK,
  灵异: SUSPENSE_HORROR_FRAMEWORK,

  游戏: GAME_SPORTS_FRAMEWORK,
  体育: GAME_SPORTS_FRAMEWORK,

  同人衍生: GENERAL_FRAMEWORK,
  其他: GENERAL_FRAMEWORK
};

export function resolveLongBookFrameworkPreset(
  genre: string
): LongBookFrameworkPreset {
  return (
    GENRE_TO_FRAMEWORK[sanitizeSingleLineLabel(genre)] ?? GENERAL_FRAMEWORK
  );
}

export interface BuildLongWebNovelAgentsMdOptions {
  readonly pacingMode?: LongWebNovelPacingMode | undefined;
  readonly tropes?: readonly string[] | undefined;
}

export function buildLongAgentsMdForGenre(
  baseAgentsMd: string,
  genre: string,
  options?: BuildLongWebNovelAgentsMdOptions
): string {
  const normalizedGenre = sanitizeSingleLineLabel(genre);
  const preset = resolveLongBookFrameworkPreset(normalizedGenre);
  const pacing =
    LONG_PACING_GUIDES[options?.pacingMode ?? preset.defaultPacing];
  const categories = preset.worldCategories
    .map(([, title]) => title)
    .join("、");
  const tropes = normalizeUniqueTropes(options?.tropes);
  const tropeLines = tropes.map((tag) => {
    const rule = TROPE_CRAFT_RULES[tag];
    return rule
      ? `  - 【${tag}】：${rule}`
      : `  - 【${tag}】：贯穿人设、冲突与爽点兑现。`;
  });

  const section = [
    `## 本书网文创作总纲（${normalizedGenre || "通用"} · ${preset.name}）`,
    "",
    `- 连载风向：${pacing.label}——${pacing.guide}`,
    `- 爽感与核心驱动：${preset.coreDrive}`,
    ...(tropeLines.length
      ? [`- 核心流派与标签兑现（${tropes.join(" + ")}）：`, ...tropeLines]
      : []),
    `- 专属世界观七维框架：${categories}。只写会制造压迫、限制选择或驱动升级/拉扯的硬设定，严禁写无冲突百科。`,
    `- 黄金三章与换图节奏：${preset.structureRhythm}`,
    `- 防崩与排雷死线：${preset.guardrails}`
  ].join("\n");
  return appendSectionWithinBudget(baseAgentsMd, section);
}

export interface BuildShortWebNovelContextOptions {
  readonly pacingMode?: ShortWebNovelPacingMode | undefined;
  readonly tropes?: readonly string[] | undefined;
}

export function buildShortWebNovelContextSection(
  genre: string,
  options?: BuildShortWebNovelContextOptions
): string {
  const normalizedGenre = sanitizeSingleLineLabel(genre) || "通用";
  const pacing = SHORT_PACING_GUIDES[options?.pacingMode ?? "viral_short"];
  const tropes = normalizeUniqueTropes(options?.tropes);
  const tropeLines = tropes.map((tag) => {
    const rule = TROPE_CRAFT_RULES[tag];
    return rule
      ? `  - 【${tag}】：${rule}`
      : `  - 【${tag}】：紧扣导语钩子与核心反转兑现。`;
  });

  return [
    `## 本篇网文短篇框架（${normalizedGenre}）`,
    "",
    `- 篇幅与节奏定位：${pacing.label}——${pacing.guide}`,
    `- 爆款五步结构：导语（前300字抛死局/极致痛点/诡异规则）→ 起（立受压处境与底线）→ 承（反派步步紧逼+暗埋底牌草蛇灰线）→ 转（身份/信息差/规则掀桌大反转）→ 合（当场清算虐渣或余韵收束）。`,
    ...(tropeLines.length
      ? [`- 核心标签兑现（${tropes.join(" + ")}）：`, ...tropeLines]
      : []),
    `- 短篇避坑红线：杜绝大段景物铺垫与慢热寒暄，多用动作、对话与短句推进；情绪压抑后必须彻底释放，不烂尾不喂毒。`
  ].join("\n");
}

export function buildShortWritingContextForWebNovel(
  baseContext: string,
  genre: string,
  options?: BuildShortWebNovelContextOptions
): string {
  const section = buildShortWebNovelContextSection(genre, options);
  return appendSectionWithinBudget(baseContext, section);
}
