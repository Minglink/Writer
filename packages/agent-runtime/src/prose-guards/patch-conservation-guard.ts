import type { PromptLocale } from "@writer/contracts";

const RE_CLOCK_TIME = /(?<![A-Za-z0-9_])\d{1,2}:\d{2}(?!\d)/gu;

const RE_CN_CLOCK_TIME =
  /(?:二十[零一二三四]|十[零一二三四五六七八九]|[零一二两三四五六七八九])点(?:整|半|一刻|三刻|零[一二三四五六七八九]分?|(?:[一二三四五]十[一二三四五六七八九]?|十[一二三四五六七八九]?)分?|[一二三四五六七八九]分)/gu;

const RE_CN_CLOCK_TIME_FULL =
  /^(?:二十[零一二三四]|十[零一二三四五六七八九]|[零一二两三四五六七八九])点(?:整|半|一刻|三刻|零[一二三四五六七八九]分?|(?:[一二三四五]十[一二三四五六七八九]?|十[一二三四五六七八九]?)分?|[一二三四五六七八九]分)$/u;

const RE_CN_COMPOUND_DURATION =
  /(?:[零一二两三四五六七八九十]+个半小时|[零一二两三四五六七八九十]+(?:个)?小时(?:半|[零一二三四五六七八九十]{1,3}分钟?)|(?:半个|[零一二两三四五六七八九十]+(?:个)?)时辰)/gu;

const RE_ARABIC_MEASURE =
  /(?:(?<![A-Za-z0-9_])-)?(?<![A-Za-z0-9_])(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?\s*(?:[%％]|ml|ML|毫升|升|cm|CM|mm|厘米|毫米|公分|米|km|公里|里(?:路|地)?|g|kg|克|公斤|斤|吨|分钟|小时|秒|刻钟|炷香|盏茶|时辰|℃|°C|G|两(?:银子|白银|纹银|银|碎银|黄金|金子)?|贯|文钱|铜钱|铜板|银元|大洋|元|亩|顷|石|斗|(?:上品|中品|下品|极品)?灵石|星币|晶核|积分|瓶|块|片|根|把|卷|箱|格|成|度|层|位|个|只|名|道|条|发|支|枚|颗|粒|株|封|页)?/gu;

const RE_CN_PERCENT_OR_FRACTION =
  /百分之[零一二三四五六七八九十百点]+|[一二两三四五六七八九十半]成(?:电|多|半|利)?|一块半|一瓶半|一个半|半瓶(?:水|矿泉水)?|半块(?:压缩饼干|饼干)?|半米|半寸|半公分|半里(?:路|地)?|两清|(?:零|[一二三四五六七八九]){4}/gu;

const RE_FIGURATIVE_NON_MEASURE =
  /一片(?:漆黑|黑暗|暗色|血色|空白|模糊|死寂|寂静|茫然|惨白|雪白|发白|冰凉|混乱|狼藉|灰白|白光|红光|苍茫)|半口气|一口(?:气|冷气|凉气|恶气|血沫|白痰|唾沫|老血)|千钧一发|百发百中|一石二鸟|一针见血|半斤八两|火冒三丈|垂涎三尺|冰冻三尺|百步穿杨|五十步笑百步|九牛一毛|一席之地|一臂之力|一己之力|一举两得|一锤定音|一帆风顺|一脉相承|一气呵成|一网打尽|一走了之|十万火急|万家灯火|千山万水|千军万马|一日千里|十万八千里|百里挑一|三更半夜|七零八落|五花八门|四面八方|九死一生|十拿九稳|八九不离十|一清二楚|一干二净|一模一样|一([步个条层道封件只把处阵滴缕幕扇间匹辆艘盏碗杯块片根卷包盒袋颗粒株页次遍声句口])\1|一把(?=[抓拉推扯拽揪按扣夺抢掀抱搂甩抹塞将把捏攥捂拍扫捞拎提撕])|(?:一[道抹丝缕股阵片层]|一个)(?:身影|目光|眼神|视线|弧度|冷笑|凉意|寒意|杀意|绝望|情绪|气息)|(?<=[他她我你])一个人/gu;

const RE_CN_QUANTIFIER_PHRASE =
  /(?:零下)?(?:[一二两三四五六七八九十百千万]+亿)?(?:零?[一二两三四五六七八九十百千]+万)?(?:零|半|一|二|两|三|四|五|六|七|八|九|十|百|千|万|亿)*(?:零|半|一|二|两|三|四|五|六|七|八|九|十|百|千|万|亿)(?:点[零一二三四五六七八九十]+)?\s*(?:毫升|升|厘米|毫米|公分|寸|尺|丈|米|公里|里(?:路|地)?|分钟|钟头|小时|秒钟|秒|刻钟|炷香|盏茶|时辰|℃|°C|度|两(?:银子|白银|纹银|银|碎银|黄金|金子)|两(?![个句步下人手脚眼声次边头面岸侧层截段种样回天年清])|贯|文钱|铜钱|铜板|银元|大洋|亩|顷|石|斗|斤|公斤|克|吨|元|(?:上品|中品|下品|极品)?灵石|星币|晶核|积分|瓶|块|片|根|卷|箱|格(?:电\S{0,1})?|包|盒|袋|桶|罐|枚|支|发|名|位|盏|壶|坛|碗|杯|滴|针|剂|贴|副|套|件|颗|粒|株|封|页|个|只|团|把|柄|杆|艘|辆|匹|头|具|间|扇|层|级|步|道|条|处)/gu;

const NON_ANCHOR_IDIOM_SET = new Set([
  "一丝",
  "一抹",
  "一沉",
  "一震",
  "一僵",
  "一紧",
  "一下",
  "一眼",
  "一会儿",
  "一点",
  "一点点",
  "一瞬间",
  "一眨眼",
  "一愣",
  "一滞",
  "一凛",
  "一挑",
  "一扬",
  "一变",
  "一软",
  "一晃",
  "一抖",
  "一颤",
  "一缩",
  "一梗",
  "一起",
  "一直",
  "一定",
  "一样",
  "一般",
  "一面",
  "一边",
  "一伙",
  "一阵",
  "一两个",
  "一两句",
  "三两句",
  "三两步",
  "三两下",
  "一口气",
  "一口冷气",
  "一口凉气",
  "一口血沫",
  "半口气"
]);

const CN_DIGIT_MAP: Readonly<Record<string, number>> = {
  零: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9
};

const UNIT_CANON_MAP: Readonly<Record<string, string>> = {
  ml: "ml",
  ML: "ml",
  毫升: "ml",
  cm: "cm",
  CM: "cm",
  厘米: "cm",
  公分: "cm",
  mm: "mm",
  毫米: "mm",
  km: "km",
  公里: "km",
  里路: "里",
  里地: "里",
  kg: "kg",
  公斤: "kg",
  g: "g",
  克: "g",
  "%": "%",
  "％": "%",
  "℃": "度",
  "°C": "度",
  秒钟: "秒",
  两银子: "两",
  两白银: "两",
  两纹银: "两",
  两银: "两",
  两碎银: "两",
  两黄金: "两金",
  两金子: "两金",
  文钱: "文钱",
  铜钱: "文钱",
  铜板: "文钱",
  银元: "银元",
  大洋: "银元"
};

function parseChineseInt(raw: string): number | null {
  const s = raw.trim();
  if (!s) return null;
  if (/^\d+$/u.test(s)) return Number.parseInt(s, 10);
  if (s in CN_DIGIT_MAP) return CN_DIGIT_MAP[s]!;

  if (s.includes("亿")) {
    const idx = s.indexOf("亿");
    const highPart = s.slice(0, idx);
    const rem = s.slice(idx + 1);
    const high = highPart ? parseChineseInt(highPart) : 1;
    if (high === null) return null;
    if (!rem) return high * 100_000_000;
    if (rem in CN_DIGIT_MAP) {
      return high * 100_000_000 + CN_DIGIT_MAP[rem]! * 10_000_000;
    }
    const sub = parseChineseInt(rem.replace(/^零+/u, ""));
    return sub !== null ? high * 100_000_000 + sub : null;
  }

  if (s.includes("万")) {
    const idx = s.indexOf("万");
    const highPart = s.slice(0, idx);
    const rem = s.slice(idx + 1);
    const high = highPart ? parseChineseInt(highPart) : 1;
    if (high === null) return null;
    if (!rem) return high * 10_000;
    if (rem in CN_DIGIT_MAP) {
      return high * 10_000 + CN_DIGIT_MAP[rem]! * 1_000;
    }
    const sub = parseChineseInt(rem.replace(/^零+/u, ""));
    return sub !== null ? high * 10_000 + sub : null;
  }

  if (s === "十") return 10;
  if (s.length === 2 && s[0] === "十" && s[1]! in CN_DIGIT_MAP) {
    return 10 + CN_DIGIT_MAP[s[1]!]!;
  }
  if (s.length === 2 && s[0]! in CN_DIGIT_MAP && s[1] === "十") {
    return CN_DIGIT_MAP[s[0]!]! * 10;
  }
  if (
    s.length === 3 &&
    s[0]! in CN_DIGIT_MAP &&
    s[1] === "十" &&
    s[2]! in CN_DIGIT_MAP
  ) {
    return CN_DIGIT_MAP[s[0]!]! * 10 + CN_DIGIT_MAP[s[2]!]!;
  }

  if (s.includes("千")) {
    const idx = s.indexOf("千");
    const th = CN_DIGIT_MAP[s.slice(0, idx)];
    if (th === undefined) return null;
    const rem = s.slice(idx + 1);
    if (!rem) return th * 1_000;
    if (rem in CN_DIGIT_MAP) return th * 1_000 + CN_DIGIT_MAP[rem]! * 100;
    const sub = parseChineseInt(rem.replace(/^零+/u, ""));
    return sub !== null ? th * 1_000 + sub : null;
  }

  if (s.includes("百")) {
    const idx = s.indexOf("百");
    const h = CN_DIGIT_MAP[s.slice(0, idx)];
    if (h === undefined) return null;
    const rem = s.slice(idx + 1);
    if (!rem) return h * 100;
    if (rem in CN_DIGIT_MAP) return h * 100 + CN_DIGIT_MAP[rem]! * 10;
    const sub = parseChineseInt(rem.replace(/^零+/u, ""));
    return sub !== null ? h * 100 + sub : null;
  }

  return null;
}

function parseClockCanonical(t: string): string | null {
  const arMatch = /^(\d{1,2}):(\d{2})$/u.exec(t);
  if (arMatch) {
    const hh = Number.parseInt(arMatch[1]!, 10);
    const mm = Number.parseInt(arMatch[2]!, 10);
    if (hh >= 0 && hh <= 24 && mm >= 0 && mm < 60) {
      return `TIME:${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
    }
  }

  if (RE_CN_CLOCK_TIME_FULL.test(t)) {
    const idx = t.indexOf("点");
    const hStr = t.slice(0, idx);
    const rest = t.slice(idx + 1);
    const hh = parseChineseInt(hStr);
    if (hh === null) return null;
    let mm: number | null;
    if (rest === "整") mm = 0;
    else if (rest === "半") mm = 30;
    else if (rest === "一刻") mm = 15;
    else if (rest === "三刻") mm = 45;
    else {
      const mClean = rest.endsWith("分") ? rest.slice(0, -1) : rest;
      mm =
        mClean.startsWith("零") && mClean.length === 2
          ? parseChineseInt(mClean.slice(1))
          : parseChineseInt(mClean);
    }
    if (mm !== null && hh >= 0 && hh <= 24 && mm >= 0 && mm < 60) {
      return `TIME:${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
    }
  }

  return null;
}

function parseDurationCanonical(t: string): string | null {
  if (t === "半个时辰" || t === "半时辰") return "DUR:60m";

  const shichenMatch = /^([零一二两三四五六七八九十\d]+)(?:个)?时辰$/u.exec(t);
  if (shichenMatch) {
    const sc = parseChineseInt(shichenMatch[1]!);
    if (sc !== null) return `DUR:${sc * 120}m`;
  }

  if (t.endsWith("个半小时")) {
    const h = parseChineseInt(t.slice(0, -4));
    if (h !== null) return `DUR:${h * 60 + 30}m`;
  }

  const compMatch =
    /^([零一二两三四五六七八九十\d]+)(?:个)?小时(半|[零一二三四五六七八九十\d]+分钟?)?$/u.exec(
      t
    );
  if (compMatch) {
    const h = parseChineseInt(compMatch[1]!);
    const tail = compMatch[2] ?? "";
    if (h !== null) {
      if (!tail) return `DUR:${h * 60}m`;
      if (tail === "半") return `DUR:${h * 60 + 30}m`;
      const mStr = tail.replace(/分钟?$/u, "").replace(/^零+/u, "") || "0";
      const mm = parseChineseInt(mStr);
      if (mm !== null) return `DUR:${h * 60 + mm}m`;
    }
  }

  const keMatch = /^([零一二两三四五六七八九十\d]+)刻钟$/u.exec(t);
  if (keMatch) {
    const ke = parseChineseInt(keMatch[1]!);
    if (ke !== null) return `DUR:${ke * 15}m`;
  }

  const minMatch = /^([零一二两三四五六七八九十百\d]+)分钟$/u.exec(t);
  if (minMatch) {
    const mm = parseChineseInt(minMatch[1]!);
    if (mm !== null) return `DUR:${mm}m`;
  }

  return null;
}

export function canonicalizeMeasureToken(token: string): string {
  const t = token.replace(/\s+/gu, "");

  if (
    t.length === 4 &&
    Array.from(t).every((ch) => ch in CN_DIGIT_MAP && ch !== "两")
  ) {
    const digits = Array.from(t)
      .map((ch) => String(CN_DIGIT_MAP[ch]!))
      .join("");
    return `CODE:${digits}`;
  }
  if (/^0\d{3}$/u.test(t)) return `CODE:${t}`;
  if (t === "零七" || t === "07") return "CODE:07";

  const clk = parseClockCanonical(t);
  if (clk !== null) return clk;

  const dur = parseDurationCanonical(t);
  if (dur !== null) return dur;

  if (t.startsWith("百分之")) {
    const val = parseChineseInt(t.slice(3));
    if (val !== null) return `${val}%`;
  }
  if (t === "十成" || t === "十成利" || t === "十成电") return "100%";
  const chengMatch = /^([一二两三四五六七八九])成(?:电|利)?$/u.exec(t);
  if (chengMatch) {
    return `${CN_DIGIT_MAP[chengMatch[1]!]! * 10}%`;
  }
  if (t === "半成" || t === "半成电" || t === "半成利") return "5%";
  if (t === "1.5块" || t === "一块半" || t === "一点五块") return "1.5块";
  if (t === "半里" || t === "半里路" || t === "半里地" || t === "0.5里") {
    return "0.5里";
  }
  if (t.startsWith("半瓶")) return "半瓶";
  if (t.startsWith("半块")) return "半块";
  if (/^(?:一|1)格电\S{0,1}$/u.test(t)) return "1格电";

  const arMatch = /^(-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)(.*)$/u.exec(t);
  if (arMatch) {
    const numS = arMatch[1]!.replaceAll(",", "");
    const unitRaw = arMatch[2]!;
    const unitS = UNIT_CANON_MAP[unitRaw] ?? unitRaw;
    return `${numS}${unitS}`;
  }

  let negPrefix = "";
  let tBody = t;
  if (tBody.startsWith("零下")) {
    negPrefix = "-";
    tBody = tBody.slice(2);
  }

  const cnTaelMatch =
    /^(两|[零一二两三四五六七八九十百千万亿]*?[零一二三四五六七八九十百千万亿])(两(?:银子|白银|纹银|银|碎银|黄金|金子)?)$/u.exec(
      tBody
    );
  if (cnTaelMatch) {
    const val = parseChineseInt(cnTaelMatch[1]!);
    const unitRaw = cnTaelMatch[2]!;
    const unitS = UNIT_CANON_MAP[unitRaw] ?? unitRaw;
    if (val !== null) return `${negPrefix}${val}${unitS}`;
  }

  const cnDecMatch =
    /^([零一二两三四五六七八九十百]+)点([零一二三四五六七八九]+)(.+)$/u.exec(
      tBody
    );
  if (cnDecMatch) {
    const intPart = parseChineseInt(cnDecMatch[1]!);
    const fracPart = Array.from(cnDecMatch[2]!)
      .map((ch) => String(CN_DIGIT_MAP[ch]!))
      .join("");
    const unitRaw = cnDecMatch[3]!;
    const unitS = UNIT_CANON_MAP[unitRaw] ?? unitRaw;
    if (intPart !== null) return `${negPrefix}${intPart}.${fracPart}${unitS}`;
  }

  const cnUnitMatch = /^([零一二两三四五六七八九十百千万亿]+)(.+)$/u.exec(
    tBody
  );
  if (cnUnitMatch) {
    const val = parseChineseInt(cnUnitMatch[1]!);
    const unitRaw = cnUnitMatch[2]!;
    const unitS = UNIT_CANON_MAP[unitRaw] ?? unitRaw;
    if (val !== null) return `${negPrefix}${val}${unitS}`;
  }

  return t;
}

function measureUnitFamily(canonTok: string): string {
  if (canonTok.startsWith("TIME:")) return "TIME";
  if (canonTok.startsWith("DUR:")) return "DUR";
  if (canonTok.startsWith("CODE:")) return "CODE";
  if (canonTok.startsWith("半")) return canonTok.slice(0, 2);
  const m = /^-?\d+(?:\.\d+)?(.*)$/u.exec(canonTok);
  if (m) return m[1] || "NUM";
  return canonTok;
}

export function extractProtectedMeasures(text: string): string[] {
  if (!text) return [];

  const figurativeSpans: Array<readonly [number, number]> = [];
  RE_FIGURATIVE_NON_MEASURE.lastIndex = 0;
  for (const m of text.matchAll(RE_FIGURATIVE_NON_MEASURE)) {
    if (m.index !== undefined) {
      figurativeSpans.push([m.index, m.index + m[0].length]);
    }
  }

  const overlapsFigurative = (s: number, e: number): boolean =>
    figurativeSpans.some(([fs, fe]) => !(e <= fs || s >= fe));

  const candidates: Array<{ start: number; end: number; token: string }> = [];
  const patterns = [
    RE_CLOCK_TIME,
    RE_CN_CLOCK_TIME,
    RE_CN_COMPOUND_DURATION,
    RE_CN_PERCENT_OR_FRACTION,
    RE_CN_QUANTIFIER_PHRASE,
    RE_ARABIC_MEASURE
  ];

  for (const pat of patterns) {
    pat.lastIndex = 0;
    for (const m of text.matchAll(pat)) {
      if (m.index === undefined) continue;
      const start = m.index;
      const end = start + m[0].length;
      if (overlapsFigurative(start, end)) continue;
      const token = m[0].trim();
      if (!token || NON_ANCHOR_IDIOM_SET.has(token)) continue;
      candidates.push({ start, end, token });
    }
  }

  candidates.sort(
    (a, b) => a.start - b.start || b.end - b.start - (a.end - a.start)
  );
  const selected: string[] = [];
  let lastEnd = -1;
  for (const cand of candidates) {
    if (cand.start < lastEnd) continue;
    selected.push(cand.token);
    lastEnd = cand.end;
  }
  return selected;
}

export interface ReplacementConservationInput {
  readonly original_text: string;
  readonly new_text: string;
  readonly allow_numeric_change?: boolean | "true" | "false" | undefined;
  readonly allowed_removed_measures?: readonly string[] | undefined;
}

export type ReplacementConservationResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason:
        "numeric_conservation_violation" | "collateral_measure_deletion";
      readonly missingMeasures: readonly string[];
      readonly wipedUnitFamilies?: readonly string[];
    };

function countTokens(tokens: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const token of tokens) {
    const canon = canonicalizeMeasureToken(token);
    counts.set(canon, (counts.get(canon) ?? 0) + 1);
  }
  return counts;
}

export function checkReplacementConservation(
  replacement: ReplacementConservationInput
): ReplacementConservationResult {
  const origMeasures = extractProtectedMeasures(replacement.original_text);
  if (origMeasures.length === 0) return { ok: true };

  const newMeasures = extractProtectedMeasures(replacement.new_text);
  const origCanon = countTokens(origMeasures);
  const newCanon = countTokens(newMeasures);

  const allowedRemoved = (replacement.allowed_removed_measures ?? [])
    .map((item) => item.trim())
    .filter(Boolean);

  for (const remItem of allowedRemoved) {
    const extracted = extractProtectedMeasures(remItem);
    const targets = extracted.length > 0 ? extracted : [remItem];
    for (const rt of targets) {
      const ck = canonicalizeMeasureToken(rt);
      const cur = origCanon.get(ck) ?? 0;
      if (cur > 0) origCanon.set(ck, cur - 1);
    }
  }

  const allowNumericChange =
    replacement.allow_numeric_change === true ||
    replacement.allow_numeric_change === "true";
  if (!allowNumericChange) {
    const missing: string[] = [];
    const tempNew = new Map(newCanon);
    for (const rawTok of origMeasures) {
      const ck = canonicalizeMeasureToken(rawTok);
      const required = origCanon.get(ck) ?? 0;
      const available = tempNew.get(ck) ?? 0;
      if (available < required) {
        missing.push(rawTok);
        tempNew.set(ck, available + 1);
      }
    }
    if (missing.length > 0) {
      return {
        ok: false,
        reason: "numeric_conservation_violation",
        missingMeasures: missing
      };
    }
    return { ok: true };
  }

  if (origMeasures.length > 1 && allowedRemoved.length === 0) {
    const origFamilies = new Set<string>();
    for (const [ck, count] of origCanon.entries()) {
      if (count > 0) origFamilies.add(measureUnitFamily(ck));
    }
    const newFamilies = new Set<string>(
      newMeasures.map((t) => measureUnitFamily(canonicalizeMeasureToken(t)))
    );
    const wiped = Array.from(origFamilies)
      .filter((fam) => !newFamilies.has(fam))
      .sort();
    if (wiped.length > 0 && origFamilies.size > 1) {
      return {
        ok: false,
        reason: "collateral_measure_deletion",
        missingMeasures: origMeasures.filter((t) =>
          wiped.includes(measureUnitFamily(canonicalizeMeasureToken(t)))
        ),
        wipedUnitFamilies: wiped
      };
    }
  }

  return { ok: true };
}

export function formatConservationFailure(
  result: Extract<ReplacementConservationResult, { ok: false }>,
  locale?: PromptLocale
): string {
  const missing = result.missingMeasures.join("、");
  if (result.reason === "collateral_measure_deletion") {
    const families = (result.wipedUnitFamilies ?? []).join("、");
    return locale === "en-US"
      ? `Not changed: local edit deleted unrelated numeric/measure anchor(s) (${missing}; unit families: ${families}) while allow_numeric_change=true. Keep unrelated anchors intact or list them explicitly in allowed_removed_measures.`
      : `未修改：局部替换在允许数值修改时附带误删了无关单位族的状态锚点（${missing}；涉及单位族：${families}）。请保留无关锚点，或缩小替换片段后重试。`;
  }
  return locale === "en-US"
    ? `Not changed: local replacement dropped protected numeric/time/measure anchor(s): ${missing}. Preserve these anchors in new_text (equivalent Chinese/Arabic forms are accepted), or set allow_numeric_change=true if intentionally correcting a ledger value.`
    : `未修改：局部替换触发数字/时间/量词守恒锁，原文中的受保护状态锚点在 new_text 中丢失：${missing}。请在 new_text 中保留这些锚点（中英文等价写法自动放行），若确需修正账本数值请显式传 allow_numeric_change=true。`;
}
