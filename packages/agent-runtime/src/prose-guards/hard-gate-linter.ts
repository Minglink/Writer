import type { PromptLocale } from "@writer/contracts";

const RE_CHINESE_CHAR = /[\u4e00-\u9fff]/u;
const RE_CHINESE_CHAR_GLOBAL = /[\u4e00-\u9fff]/gu;
const RE_LEADING_QUOTE_OR_PUNCT = /^[\s“”‘’「」『』（）()…—\-·]+/u;
const RE_EM_DASH_GLOBAL = /——/gu;

const QUOTE_PAIRS: readonly (readonly [string, string])[] = [
  ["“", "”"],
  ["「", "」"],
  ["『", "』"],
  ["‘", "’"]
];

const META_LEAK_PATTERNS: readonly RegExp[] = [
  /【正文续写接口/u,
  /(?:字数统计|总字数|修改说明|写作说明)[：:]/u,
  /^```/mu,
  /(?<!\S)本章完(?!\S)/u,
  /(?:旁白(?:从|在|改称|只称|此处)|从这句起改称)/u,
  /(?:本章细纲|上章细纲|下章细纲|章卡要求)/u
];

const AI_SLOP_PATTERNS: Readonly<Record<string, RegExp>> = {
  micro_expression:
    /眼中闪过(?:一丝|一抹)?|眸光微闪|嘴角勾起(?:一抹)?|唇角微扬|嘴角扬起|瞳孔微缩|瞳孔猛缩|瞳孔缩了(?:一下|一圈)?|眉头微皱|眉眼低垂|眼神闪烁|目光闪烁|眼底闪过|眼底浮现|嘴角露出一抹|嘴角泛起|脸色变了|脸色一变|眼神一冷|眼神一凛|目光一凝/gu,
  atmosphere_cliche:
    /空气仿佛凝固|死一般的寂静|死寂|鸦雀无声|四下无声|全场死寂|全场哗然|心中掀起了惊涛骇浪|惊涛骇浪|倒吸(?:一口)?(?:冷|凉)气|倒抽(?:一口)?(?:冷气|凉气|气)|心头一震|心中一震|心里一震|心里一沉|心头一沉|心中一沉|心中一动|心下了然|心中暗道|心底泛起|涌上心头|震惊不已|绝望的气息|浓郁的血腥味扑面而来|内心深处|灵魂深处|说不清道不明的情绪|深吸一口气|冰冷的(?:眼神|笑容|笑|弧度|语气|气质|声音|机械音|提示音|文字|面板)|冷冰冰的(?:眼神|笑容|语气|声音|机械音|提示音)/gu,
  structural_slop:
    /不是[^，。！？\n]{1,20}[，,]?而是|不仅[^，。！？\n]{1,20}[，,]?而且|与其说[^，。！？\n]{1,20}[，,]?不如说|(?:^|[，。！？；“「『\s])(他|她|我)[^，。！？\n]{1,12}[，,]\1[^，。！？\n]{1,12}[，,]\1[^，。！？\n]{1,12}/gu,
  copula_evasion:
    /(?<!毫无)(?<!无所)(?<!有所)(?<!大有)(?<!难有)(?<!不)作为(?:一名|一个)?|充当|堪称|标志着|象征着/gu,
  summary_ending:
    /总而言之|(?:他|她|我)终于明白|(?:他|她|我)这才意识到|从此刻起|这一刻[，,]?(?:一切|他|她|我)|人性[^，。！？\n]{0,12}比[^，。！？\n]{0,12}更可怕/gu
};

const TYPO_PATTERNS: Readonly<Record<string, RegExp>> = {
  known_lexical_typos: /以经|视乎|即然|因该|在次|候面|自已|己经|既使/gu,
  de_complement_misuse:
    /(?:跑的快)|(?:(?<![黄紫白红青黑])(?:疼|痛|冷|热|吓|抖|笑|哭|气|急|震|砸|勒|压|憋|冻|饿|渴|累|困|喘|呛|激|刺|肿|黑|干|涩|暗|亮|沉|重|紧|硬|稳|慌|闷|说|咬|放|黄|紫|白|红|青|捏|虚|撞|摸|扯|涨|滑|摔|烫|麻|酸|挤|顶|拽|踹|磨|晃)的(?:厉害|发[涩青白红黄黑紫僵紧麻软凉寒虚抖慌怵]|直[哆抽咳跳冒颤抖喘翻打晃]|眯(?:死|成)|飞快|不行|要命|要死|吓人|裂开|不得了|抽气|通红|合不上|拧不开|嘎吱响|跟[^，。！？\n]{1,8}|瘪下去|贴住[\u4e00-\u9fff]{0,2}|透熟|生疼|钻心|死紧|够呛|慌(?=[，。！？\s”]|$)|一(?:拱|晃|颤|哆嗦|抽|抖|趔趄|激灵)|一阵[\u4e00-\u9fff]{1,3}))|(?:(?:疼|痛|吓|抖|笑|哭|气|急|憋|冻|饿|渴|累|困|喘|呛|慌|闷|说|捏|摸|滑|麻|酸)的很[\u4e00-\u9fff]{1,2})|(?:(?:疼|痛|冷|热|吓|气|急|震|砸|勒|压|憋|冻|饿|渴|累|困|喘|呛|激|刺|挤|顶|拽|踹|撞|扯|摔|麻|酸|晃)的(?:他|她|我)(?:耳|脸|鼻|眼|嘴|手|脚|身|脑|心|牙|头|睁))/gu,
  de_adverbial_misuse:
    /猛的|(?:狠狠|死死|慢慢|悄悄|静静|轻轻|重重|紧紧|急急|稳稳|默默|呆呆|生生|硬生生|眼睁睁|直勾勾|恶狠狠|连滚带爬|一瘸一拐|跌跌撞撞|踉踉跄跄|小心翼翼|悄无声息|声嘶力竭|咬牙切齿)的(?=(?:冲|走|跑|爬|逃|退|躲|缩|站|蹲|跪|倒|扑|撞|闯|迈|跨|挪|凑|贴|靠|看|盯|瞅|扫|瞪|望|瞥|抓|握|攥|捏|扣|按|压|拉|拽|扯|推|踢|踹|砸|劈|砍|刺|扎|捅|勒|掐|咬|嚼|咽|吞|喝|喘|咳|哭|笑|喊|叫|吼|骂|说|道|问|答|颤|抖|晃|摇|点|抬|低|转|扭|侧|伏|趴|躺|坐|闭|睁|吸|吐|松|放|收|抽|拔|举|挥|甩|扔|丢|塞|掏|摸|擦|抹|裹|缠|绑|锁|关|开)[\u4e00-\u9fff]{0,1}(?:着|了|住|开|进|出|起|下|上|过|向|往|来|去)?)/gu
};

export interface UnbalancedQuoteHit {
  readonly line: number;
  readonly pair: string;
  readonly snippet: string;
}

export interface ProseHardBlock {
  readonly kind: "unbalanced_quotes" | "meta_leak";
  readonly detail: string;
}

export interface ProseSoftNotice {
  readonly kind: "ai_slop" | "de_typo" | "em_dash_density" | "same_lead_run";
  readonly count: number;
  readonly samples: readonly string[];
}

export interface ProseLintOptions {
  readonly firstPersonPov?: boolean;
  readonly maxEmDashPer1kCn?: number;
  readonly minConsecutiveSameLead?: number;
}

export interface ProseLintReport {
  readonly hardBlocks: readonly ProseHardBlock[];
  readonly softNotices: readonly ProseSoftNotice[];
}

export function findUnbalancedQuoteLines(text: string): UnbalancedQuoteHit[] {
  const hits: UnbalancedQuoteHit[] = [];
  const lines = text.split(/\r?\n/u);
  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = lines[i]!.trim();
    if (!trimmed) continue;
    for (const [openQ, closeQ] of QUOTE_PAIRS) {
      if (!trimmed.includes(openQ) && !trimmed.includes(closeQ)) continue;
      let depth = 0;
      let misnested = false;
      for (const ch of trimmed) {
        if (ch === openQ) {
          depth += 1;
        } else if (ch === closeQ) {
          depth -= 1;
          if (depth < 0) {
            misnested = true;
            break;
          }
        }
      }
      if (misnested || depth !== 0) {
        hits.push({
          line: i + 1,
          pair: `${openQ}…${closeQ}`,
          snippet: trimmed.length > 48 ? `${trimmed.slice(0, 48)}…` : trimmed
        });
        break;
      }
    }
  }
  return hits;
}

export function findMetaLeaks(text: string): string[] {
  const matches: string[] = [];
  for (const pattern of META_LEAK_PATTERNS) {
    const found = text.match(pattern);
    if (found?.[0]) {
      matches.push(found[0]);
    }
  }
  return matches;
}

function collectPatternMatches(
  text: string,
  patterns: Readonly<Record<string, RegExp>>,
  maxSamples = 5
): { count: number; samples: string[] } {
  let count = 0;
  const samples: string[] = [];
  const seen = new Set<string>();
  for (const regex of Object.values(patterns)) {
    regex.lastIndex = 0;
    for (const match of text.matchAll(regex)) {
      count += 1;
      const token = match[0].trim();
      if (token && !seen.has(token) && samples.length < maxSamples) {
        seen.add(token);
        samples.push(token);
      }
    }
  }
  return { count, samples };
}

function findConsecutiveSameLeadRuns(
  text: string,
  minRun: number,
  firstPersonPov: boolean
): string[] {
  const runs: string[] = [];
  let curChar = "";
  let curLen = 0;
  let startLine = 0;

  const flush = (): void => {
    const threshold =
      firstPersonPov && curChar === "我" ? Math.max(minRun, 5) : minRun;
    if (curChar && curLen >= threshold) {
      runs.push(`第 ${startLine} 段起连续 ${curLen} 段以「${curChar}」起笔`);
    }
  };

  const lines = text.split(/\r?\n/u);
  let paraIndex = 0;
  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;
    paraIndex += 1;
    if (/^[“「『"']/u.test(trimmed)) {
      flush();
      curChar = "";
      curLen = 0;
      continue;
    }
    const stripped = trimmed.replace(RE_LEADING_QUOTE_OR_PUNCT, "");
    const firstChar = Array.from(stripped)[0] ?? "";
    const lead = firstChar && RE_CHINESE_CHAR.test(firstChar) ? firstChar : "";
    if (lead && lead === curChar) {
      curLen += 1;
    } else {
      flush();
      curChar = lead;
      curLen = lead ? 1 : 0;
      startLine = paraIndex;
    }
  }
  flush();
  return runs;
}

export function lintProseBody(
  text: string,
  options: ProseLintOptions = {}
): ProseLintReport {
  const hardBlocks: ProseHardBlock[] = [];
  const softNotices: ProseSoftNotice[] = [];

  if (!text.trim()) {
    return { hardBlocks, softNotices };
  }

  for (const hit of findUnbalancedQuoteLines(text).slice(0, 3)) {
    hardBlocks.push({
      kind: "unbalanced_quotes",
      detail: `第 ${hit.line} 行引号 ${hit.pair} 未在单自然段内成对闭合：「${hit.snippet}」`
    });
  }

  const metaLeaks = findMetaLeaks(text);
  if (metaLeaks.length > 0) {
    hardBlocks.push({
      kind: "meta_leak",
      detail: `正文混入非小说元话语：${metaLeaks.slice(0, 3).join("、")}`
    });
  }

  const slop = collectPatternMatches(text, AI_SLOP_PATTERNS);
  if (slop.count > 0) {
    softNotices.push({
      kind: "ai_slop",
      count: slop.count,
      samples: slop.samples
    });
  }

  const typos = collectPatternMatches(text, TYPO_PATTERNS);
  if (typos.count > 0) {
    softNotices.push({
      kind: "de_typo",
      count: typos.count,
      samples: typos.samples
    });
  }

  const cnChars = (text.match(RE_CHINESE_CHAR_GLOBAL) ?? []).length;
  const emDashes = (text.match(RE_EM_DASH_GLOBAL) ?? []).length;
  const maxEmDash = options.maxEmDashPer1kCn ?? 3.0;
  if (cnChars >= 300 && emDashes > 0) {
    const per1k = (emDashes * 1000) / cnChars;
    if (per1k > maxEmDash) {
      softNotices.push({
        kind: "em_dash_density",
        count: emDashes,
        samples: [`${emDashes} 处（${per1k.toFixed(1)} 处/千字）`]
      });
    }
  }

  const sameLeadRuns = findConsecutiveSameLeadRuns(
    text,
    options.minConsecutiveSameLead ?? 3,
    Boolean(options.firstPersonPov)
  );
  if (sameLeadRuns.length > 0) {
    softNotices.push({
      kind: "same_lead_run",
      count: sameLeadRuns.length,
      samples: sameLeadRuns.slice(0, 3)
    });
  }

  return { hardBlocks, softNotices };
}

export function checkBodyWriteHardBlocks(
  beforeText: string,
  afterText: string,
  isPartialEdit: boolean
): ProseHardBlock[] {
  const blocks: ProseHardBlock[] = [];
  const afterQuotes = findUnbalancedQuoteLines(afterText);
  if (isPartialEdit) {
    const beforeQuotes = findUnbalancedQuoteLines(beforeText);
    if (afterQuotes.length > beforeQuotes.length) {
      for (const hit of afterQuotes.slice(0, 3)) {
        blocks.push({
          kind: "unbalanced_quotes",
          detail: `第 ${hit.line} 行引号 ${hit.pair} 未在单自然段内成对闭合：「${hit.snippet}」`
        });
      }
    }
  } else if (afterQuotes.length > 0) {
    for (const hit of afterQuotes.slice(0, 3)) {
      blocks.push({
        kind: "unbalanced_quotes",
        detail: `第 ${hit.line} 行引号 ${hit.pair} 未在单自然段内成对闭合：「${hit.snippet}」`
      });
    }
  }

  const afterLeaks = findMetaLeaks(afterText);
  if (isPartialEdit) {
    const beforeLeakSet = new Set(findMetaLeaks(beforeText));
    const addedLeaks = afterLeaks.filter((item) => !beforeLeakSet.has(item));
    if (addedLeaks.length > 0) {
      blocks.push({
        kind: "meta_leak",
        detail: `局部修改引入非小说元话语：${addedLeaks.slice(0, 3).join("、")}`
      });
    }
  } else if (afterLeaks.length > 0) {
    blocks.push({
      kind: "meta_leak",
      detail: `正文混入非小说元话语：${afterLeaks.slice(0, 3).join("、")}`
    });
  }
  return blocks;
}

export function formatHardBlockError(
  blocks: readonly ProseHardBlock[],
  locale?: PromptLocale
): string {
  const details = blocks.map((b) => b.detail).join("；");
  if (locale === "en-US") {
    return `Not changed: manuscript hard-gate check failed (${details}). Fix the unclosed quotes or meta-narration leak and retry.`;
  }
  return `未修改：正文确定性门禁拦截（${details}）。请修正单段闭合引号或清除正文中的元话语后重试。`;
}

export function formatProseSoftNotices(
  notices: readonly ProseSoftNotice[],
  locale?: PromptLocale
): string {
  if (notices.length === 0) return "";
  const parts = notices.map((notice) => {
    if (notice.kind === "ai_slop") {
      return locale === "en-US"
        ? `cliché/filler hits (${notice.count}): ${notice.samples.join(", ")}`
        : `疑似 AI 套话/微表情 ${notice.count} 处（${notice.samples.join("、")}）`;
    }
    if (notice.kind === "de_typo") {
      return locale === "en-US"
        ? `likely 的/地/得 or typo (${notice.count}): ${notice.samples.join(", ")}`
        : `疑似的/地/得或错别字 ${notice.count} 处（${notice.samples.join("、")}）`;
    }
    if (notice.kind === "em_dash_density") {
      return locale === "en-US"
        ? `em-dash density high: ${notice.samples.join(", ")}`
        : `破折号偏密（${notice.samples.join("、")}）`;
    }
    return locale === "en-US"
      ? `repeated paragraph openings: ${notice.samples.join("; ")}`
      : `连续同字起笔（${notice.samples.join("；")}）`;
  });
  return locale === "en-US"
    ? `\n[Prose quality hint (non-blocking)] ${parts.join("; ")}. Consider tightening in a local pass if unintended.`
    : `\n【正文质检提示（不阻断）】${parts.join("；")}。如非刻意风格，建议后续用局部 replacements 精修。`;
}
