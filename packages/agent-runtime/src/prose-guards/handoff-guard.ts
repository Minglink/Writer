const RE_POV_GUARD_LINE =
  /^(?:[-*]\s*)?(?:视角|禁止透露|不能写破|知情边界|POV|Do not reveal|Must not spoil|Knowledge boundary)[：:]/iu;
const RE_SECRET_EXTRACT =
  /^(?:[-*]\s*)?(?:禁止透露|不能写破|Do not reveal|Must not spoil)[：:]\s*(.+)$/iu;
const RE_EMPTY_SECRET_PLACEHOLDER =
  /^(?:无|暂无|本章无.*|无特殊.*|无额外.*|无隐藏.*|none|n\/a)$/iu;

export interface PovGuardExtraction {
  readonly hasPovGuard: boolean;
  readonly guardLines: readonly string[];
  readonly derivedSecretPhrases: readonly string[];
}

export function extractPovGuardLinesFromCard(
  cardContent: string
): PovGuardExtraction {
  const guardLines: string[] = [];
  const derivedSecretPhrases: string[] = [];

  for (const rawLine of (cardContent || "").split(/\r?\n/u)) {
    const trimmed = rawLine.trim();
    if (!RE_POV_GUARD_LINE.test(trimmed)) continue;
    guardLines.push(trimmed);
    const secMatch = RE_SECRET_EXTRACT.exec(trimmed);
    if (secMatch?.[1]) {
      for (const part of secMatch[1].split(/[、，,；;｜|/]+/u)) {
        const cleaned = part.replace(
          /^[\s。！？“”"'（）()]+|[\s。！？“”"'（）()]+$/gu,
          ""
        );
        if (
          cleaned.length >= 2 &&
          cleaned.length <= 24 &&
          !RE_EMPTY_SECRET_PLACEHOLDER.test(cleaned)
        ) {
          derivedSecretPhrases.push(cleaned);
        }
      }
    }
  }

  return {
    hasPovGuard: guardLines.length > 0,
    guardLines,
    derivedSecretPhrases
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

export interface PureBareSandboxAudit {
  readonly clean: boolean;
  readonly leakedTerms: readonly string[];
  readonly sanitizedInput: string;
}

export function verifyPureBareSandboxInput(
  sandboxInput: string,
  forbiddenTerms: readonly string[]
): PureBareSandboxAudit {
  const text = sandboxInput || "";
  const leakedTerms: string[] = [];
  let sanitized = text;
  const cleanedTerms = Array.from(
    new Set(forbiddenTerms.map((t) => t.trim()).filter(Boolean))
  ).sort((a, b) => b.length - a.length);

  for (const term of cleanedTerms) {
    const pat = new RegExp(escapeRegExp(term), "giu");
    if (pat.test(sanitized)) {
      leakedTerms.push(term);
      pat.lastIndex = 0;
      sanitized = sanitized.replace(pat, "【未知底牌】");
    } else {
      pat.lastIndex = 0;
      if (pat.test(text)) {
        leakedTerms.push(term);
      }
    }
  }

  return {
    clean: leakedTerms.length === 0,
    leakedTerms,
    sanitizedInput: sanitized
  };
}

export interface InvertedPyramidHandoffSections {
  readonly chapterNum: number | string;
  readonly immediateAnchor: string | readonly string[];
  readonly hardLedger: string | readonly string[];
  readonly mustResolve?: string | readonly string[];
}

export interface CompiledHandoffResult {
  readonly handoffMarkdown: string;
  readonly charCount: number;
  readonly withinBudget: boolean;
  readonly writer1200Safe: boolean;
  readonly trimmed: boolean;
  readonly injectedHazardCount: number;
}

function toBulletLines(val: string | readonly string[] | undefined): string[] {
  if (!val) return [];
  const raw = Array.isArray(val)
    ? val.map((item) => String(item).trim()).filter(Boolean)
    : String(val)
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter(Boolean);
  return raw.map((line) => (line.startsWith("-") ? line : `- ${line}`));
}

export function compileAndGuardHandoff(
  sections: InvertedPyramidHandoffSections,
  mustResolveHazards: readonly string[] = [],
  maxChars = 1_000
): CompiledHandoffResult {
  if (maxChars < 300) {
    throw new Error("maxChars must be >= 300 for inverted-pyramid handoff.");
  }

  const sec1 = toBulletLines(sections.immediateAnchor);
  const sec2 = toBulletLines(sections.hardLedger);
  const sec3NonMandatory = toBulletLines(sections.mustResolve);

  const mergedHazards: string[] = [];
  for (const hz of mustResolveHazards) {
    const clean = hz
      .trim()
      .replace(/^[-*\s]+/u, "")
      .trim();
    if (!clean) continue;
    const alreadyPresent =
      sec3NonMandatory.some((line) => line.includes(clean)) ||
      mergedHazards.some((line) => line.includes(clean));
    if (!alreadyPresent) {
      mergedHazards.push(`- [审稿必圆锁] ${clean}`);
    }
  }

  let sec3Final =
    mergedHazards.length > 0 || sec3NonMandatory.length > 0
      ? [...mergedHazards, ...sec3NonMandatory]
      : ["- 无额外跨章隐患，按细纲推进。"];

  const render = (s1: string[], s2: string[], s3: string[]): string =>
    [
      `## 第${sections.chapterNum}章置顶状态交接单`,
      "### 【1. 即时时空与动作接续锚点】",
      s1.length > 0 ? s1.join("\n") : "- 待承接",
      "### 【2. 核心状态与因果账本（Seed+Delta）】",
      s2.length > 0 ? s2.join("\n") : "- 无变更",
      "### 【3. 跨章必圆隐患与筹码锁】",
      s3.join("\n")
    ]
      .join("\n")
      .trim();

  let rendered = render(sec1, sec2, sec3Final);
  let trimmed = false;

  if (rendered.length > maxChars) {
    trimmed = true;
    const tail = [...sec3NonMandatory];
    while (rendered.length > maxChars && tail.length > 0) {
      tail.pop();
      const cur =
        mergedHazards.length > 0 || tail.length > 0
          ? [...mergedHazards, ...tail]
          : ["- 正常推进"];
      rendered = render(sec1, sec2, cur);
      sec3Final = cur;
    }
  }

  if (rendered.length > maxChars) {
    for (const targetList of [sec2, sec1]) {
      for (let i = targetList.length - 1; i >= 0; i -= 1) {
        if (rendered.length <= maxChars) break;
        if (targetList[i]!.length > 64) {
          targetList[i] = `${targetList[i]!.slice(0, 61)}…`;
          rendered = render(sec1, sec2, sec3Final);
        }
      }
    }
  }

  while (rendered.length > maxChars && sec2.length > 4) {
    sec2.pop();
    rendered = render(sec1, sec2, sec3Final);
  }

  while (rendered.length > maxChars && sec1.length > 2) {
    sec1.pop();
    rendered = render(sec1, sec2, sec3Final);
  }

  if (rendered.length > maxChars) {
    for (const capLen of [87, 60, 42]) {
      if (rendered.length <= maxChars) break;
      for (let i = 0; i < sec3Final.length; i += 1) {
        if (rendered.length <= maxChars) break;
        if (sec3Final[i]!.length > capLen + 3) {
          sec3Final[i] = `${sec3Final[i]!.slice(0, capLen)}…`;
          rendered = render(sec1, sec2, sec3Final);
        }
      }
    }
  }

  if (rendered.length > maxChars) {
    rendered = `${rendered.slice(0, maxChars - 1).trimEnd()}…`;
  }

  return {
    handoffMarkdown: rendered,
    charCount: rendered.length,
    withinBudget: rendered.length <= maxChars,
    writer1200Safe: rendered.length <= 1_200,
    trimmed,
    injectedHazardCount: mergedHazards.length
  };
}
