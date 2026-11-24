import type { LongWorkspaceIndexSnapshot } from "@writer/contracts";
import type { AgentRunInput } from "./runtime-types";

export type LongChapterWriteIntent =
  "blank_draft" | "same_chapter_continue" | "in_chapter_revision";

export type LongChapterEvidenceTargetResult =
  | {
      kind: "resolved";
      chapterCardId: string;
      chapterTitle: string;
      intent: LongChapterWriteIntent;
      source: "explicit" | "focus";
    }
  | {
      kind: "conflict";
      explicitChapterId: string;
      focusChapterId: string;
      reason: string;
    }
  | {
      kind: "none";
      reason: string;
    };

const NON_SINGLE_CHAPTER_RE =
  /(对比|比较|全书|整本|大纲|规划|梳理|审计|检查连续性|连续性归档|提交账本|盘点|汇总|人物设定|世界观设定|\b(?:compare|outline|whole book|entire book|audit|continuity)\b)/iu;

const MULTI_CHAPTER_LIST_RE =
  /(?:(?:chapter_[a-zA-Z0-9_-]+|第\s*[0-9一二三四五六七八九十百零两]+\s*章|\b(?:chapter|ch\.?)\s*\d+\b)\s*(?:和|与|及|、|到|至|-|–|~|\band\b|&|\bto\b)\s*(?:chapter_[a-zA-Z0-9_-]+|第\s*[0-9一二三四五六七八九十百零两]+\s*章|\b(?:chapter|ch\.?)\s*\d+\b|\d+)|\bchapters\s+\d+\s*(?:and|&|-|to)\s*\d+\b)/iu;

const REVISION_INTENT_RE =
  /(回改|修改|润色|精修|重写|试改|调整|改写|补强|补一段|倒叙|删改|改动|顺一下|替换|\b(?:revise|rewrite|edit|polish|rework|adjust)\b)/iu;

const WRITING_INTENT_RE =
  /(起稿|续写|接着|继续写|往后写|写一|写两|写三|写这|写本|写第|写开|开头|正文|回改|修改|润色|精修|重写|试改|调整|改写|补强|补一段|倒叙|顺一下|\b(?:write|draft|continue|opening|revise|rewrite|edit|polish)\b)/iu;

const ACTION_CHAPTER_RE =
  /(?:起稿|续写|接着写?|继续写?|补写|回改|修改|润色|精修|重写|试改|调整|改写|补强|顺一下|写|\b(?:write|draft|continue|revise|rewrite|edit|polish)\b)[^，。！？；.!?\n]{0,24}?(chapter_[a-zA-Z0-9_-]+|第\s*[0-9一二三四五六七八九十百零两]+\s*章|\b(?:chapter|ch\.?)\s*\d+\b)/giu;

const CHAPTER_THEN_ACTION_RE =
  /(chapter_[a-zA-Z0-9_-]+|第\s*[0-9一二三四五六七八九十百零两]+\s*章|\b(?:chapter|ch\.?)\s*\d+\b)[^，。！？；.!?\n]{0,16}?(?:起稿|开头|续写|回改|修改|润色|精修|重写|试改|改写|正文|的开头|的对白|的对话|\b(?:opening|draft|continuation|revision|rewrite)\b)/giu;

const ANY_CHAPTER_MENTION_RE =
  /(chapter_[a-zA-Z0-9_-]+|第\s*[0-9一二三四五六七八九十百零两]+\s*章|\b(?:chapter|ch\.?)\s*\d+\b)/giu;

function parseChineseNumeral(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (/^\d+$/u.test(trimmed)) return Number(trimmed);
  const digits: Record<string, number> = {
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
  let total = 0;
  let current = 0;
  let matched = false;
  for (const ch of trimmed) {
    if (ch in digits) {
      current = digits[ch]!;
      matched = true;
    } else if (ch === "十") {
      total += (current || 1) * 10;
      current = 0;
      matched = true;
    } else if (ch === "百") {
      total += (current || 1) * 100;
      current = 0;
      matched = true;
    } else {
      return undefined;
    }
  }
  total += current;
  return matched && total > 0 ? total : undefined;
}

function matchChapterCardByToken(
  index: LongWorkspaceIndexSnapshot,
  token: string
): { id: string; title: string } | undefined {
  const cleaned = token.trim();
  if (cleaned.startsWith("chapter_")) {
    const exact = index.plot.chapterCards.find((card) => card.id === cleaned);
    return exact ? { id: exact.id, title: exact.title } : undefined;
  }
  const numMatch =
    /^第\s*([0-9一二三四五六七八九十百零两]+)\s*章$/u.exec(cleaned) ??
    /^(?:chapter|ch\.?)\s*(\d+)$/iu.exec(cleaned);
  if (!numMatch) return undefined;
  const num = parseChineseNumeral(numMatch[1]!);
  if (num === undefined) return undefined;
  const compact = cleaned.replace(/\s+/gu, "");
  const byTitle = index.plot.chapterCards.filter(
    (card) =>
      card.title.includes(`第${num}章`) ||
      card.title.includes(compact) ||
      new RegExp(`\\bchapter\\s*${num}\\b`, "iu").test(card.title)
  );
  if (byTitle.length === 1) {
    return { id: byTitle[0]!.id, title: byTitle[0]!.title };
  }
  const byIdNum = index.plot.chapterCards.find(
    (card) => card.id === `chapter_${num}`
  );
  if (byIdNum) {
    return { id: byIdNum.id, title: byIdNum.title };
  }
  const byOrder = index.plot.chapterCards.filter(
    (card) => card.narrativeOrder === num
  );
  if (byOrder.length === 1) {
    return { id: byOrder[0]!.id, title: byOrder[0]!.title };
  }
  return undefined;
}

function collectActionChapterIds(
  prompt: string,
  index: LongWorkspaceIndexSnapshot
): string[] {
  const ids = new Set<string>();
  const scan = (re: RegExp) => {
    re.lastIndex = 0;
    for (const match of prompt.matchAll(re)) {
      const token = match[1];
      if (!token) continue;
      // Ignore past-tense references like "我刚重写了第17章结尾"
      const prefix = prompt.slice(
        Math.max(0, (match.index ?? 0) - 6),
        match.index ?? 0
      );
      if (/(?:刚|已经|此前|之前|回调|承接|接续)/u.test(prefix)) continue;
      if (match[0].includes("了")) continue;
      const card = matchChapterCardByToken(index, token);
      if (card) ids.add(card.id);
    }
  };
  scan(ACTION_CHAPTER_RE);
  scan(CHAPTER_THEN_ACTION_RE);
  return [...ids];
}

function collectAllMentionedChapterIds(
  prompt: string,
  index: LongWorkspaceIndexSnapshot
): string[] {
  const ids = new Set<string>();
  ANY_CHAPTER_MENTION_RE.lastIndex = 0;
  for (const match of prompt.matchAll(ANY_CHAPTER_MENTION_RE)) {
    const token = match[1];
    if (!token) continue;
    const card = matchChapterCardByToken(index, token);
    if (card) ids.add(card.id);
  }
  return [...ids];
}

function resolveIntent(
  prompt: string,
  bodyStatus: "empty" | "written",
  coCreationMode: AgentRunInput["coCreationMode"]
): LongChapterWriteIntent {
  if (bodyStatus === "empty") return "blank_draft";
  if (coCreationMode === "try_rewrite" || REVISION_INTENT_RE.test(prompt)) {
    return "in_chapter_revision";
  }
  return "same_chapter_continue";
}

/**
 * Determines whether a long-form run targets a single unambiguous chapter for
 * drafting, continuation, or in-chapter revision. Ambiguous, multi-chapter, or
 * read-only planning requests fall back to the existing on-demand tool flow.
 */
export function resolveLongChapterEvidenceTarget(
  input: AgentRunInput,
  index: LongWorkspaceIndexSnapshot
): LongChapterEvidenceTargetResult {
  const workspace = input.workspaceContext?.longWorkspace;
  if (!workspace || !input.longAgentProfile) {
    return { kind: "none", reason: "not_long_run" };
  }
  if (
    input.coCreationMode === "brainstorm" ||
    input.coCreationMode === "critique"
  ) {
    return { kind: "none", reason: "read_only_co_creation" };
  }

  const prompt = input.prompt.trim();
  if (!prompt) return { kind: "none", reason: "empty_prompt" };

  const actionIds = collectActionChapterIds(prompt, index);
  const allMentionedIds = collectAllMentionedChapterIds(prompt, index);

  // Explicit multi-chapter operations (e.g. "续写第17章和第18章") stay on-demand.
  if (actionIds.length > 1 || MULTI_CHAPTER_LIST_RE.test(prompt)) {
    return { kind: "none", reason: "multiple_target_chapters" };
  }
  if (NON_SINGLE_CHAPTER_RE.test(prompt) && actionIds.length === 0) {
    return { kind: "none", reason: "non_writing_or_book_wide_request" };
  }

  const focusId = workspace.activeChapterCardId;
  const focusCard = focusId
    ? index.plot.chapterCards.find((c) => c.id === focusId)
    : undefined;

  let explicitId: string | undefined;
  if (actionIds.length === 1) {
    explicitId = actionIds[0];
  } else if (allMentionedIds.length === 1 && WRITING_INTENT_RE.test(prompt)) {
    explicitId = allMentionedIds[0];
  }

  // If coCreationMode is a focused rewrite on chapter A, but the prompt explicitly
  // targets chapter B, flag a conflict instead of silently picking one.
  if (
    explicitId &&
    focusCard &&
    explicitId !== focusCard.id &&
    input.coCreationMode === "try_rewrite"
  ) {
    return {
      kind: "conflict",
      explicitChapterId: explicitId,
      focusChapterId: focusCard.id,
      reason: "explicit_target_conflicts_with_rewrite_focus"
    };
  }

  const chosenId =
    explicitId ??
    (workspace.activeRoot === "draft" ? focusCard?.id : undefined);
  const source: "explicit" | "focus" = explicitId ? "explicit" : "focus";

  if (!chosenId) {
    return { kind: "none", reason: "no_clear_single_chapter_target" };
  }
  if (
    source === "focus" &&
    input.coCreationMode !== "try_rewrite" &&
    !WRITING_INTENT_RE.test(prompt)
  ) {
    return { kind: "none", reason: "focus_only_without_writing_intent" };
  }

  const card = index.plot.chapterCards.find((c) => c.id === chosenId);
  const chapterEntry = index.chapters.find((c) => c.chapterCardId === chosenId);
  if (!card || !chapterEntry) {
    return { kind: "none", reason: "chapter_not_in_index" };
  }

  return {
    kind: "resolved",
    chapterCardId: card.id,
    chapterTitle: card.title,
    intent: resolveIntent(
      prompt,
      chapterEntry.bodyStatus,
      input.coCreationMode
    ),
    source
  };
}
