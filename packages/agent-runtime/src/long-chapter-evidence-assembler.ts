import { randomUUID } from "node:crypto";
import {
  LongReadDocumentResultSchema,
  LongWorkspaceIndexResultSchema,
  createEnvelope,
  estimateTextTokens,
  type LongWorkspaceFileReference
} from "@writer/contracts";
import type { AgentRunInput } from "./runtime-types";
import { LONG_STAGE_ROOTS } from "./long-agent-tools/entity-registry";
import {
  selectApplicableContinuityCheckpoint,
  type LongChapterContinuitySelection
} from "./long-chapter-continuity-selector";
import {
  resolveLongChapterEvidenceTarget,
  type LongChapterWriteIntent
} from "./long-chapter-evidence-target";

const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_EVIDENCE_BUDGET_TOKENS = 3_600;
const CARD_MAX_CHARS = 2_400;
const BODY_TAIL_MAX_CHARS = 1_500;
const HANDOFF_MAX_CHARS = 1_200;

export interface LongChapterEvidenceSourceMeta {
  chapterCardId: string;
  document: "card" | "body" | "handoff";
  sourceKind: "chapter_plan" | "saved_manuscript" | "continuity_handoff";
  range: "head" | "tail" | "full";
  updatedAt: string;
  characters: number;
}

export interface AssembledLongChapterEvidence {
  kind: "evidence" | "conflict";
  chapterCardId?: string;
  intent?: LongChapterWriteIntent;
  text: string;
  sources: LongChapterEvidenceSourceMeta[];
  gaps: string[];
  hasPovGuard: boolean;
}

export interface AssembleLongChapterEvidenceOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  budgetTokens?: number;
  /** Used by compaction rehydration when the active chapter is already known. */
  overrideChapterCardId?: string;
  overrideIntent?: LongChapterWriteIntent;
}

interface ReadExcerptResult {
  content: string;
  updatedAt: string;
  totalCharacters: number;
  range: "head" | "tail" | "full";
}

function extractPovGuardLines(cardContent: string): string[] {
  const lines: string[] = [];
  for (const rawLine of cardContent.split(/\r?\n/u)) {
    const trimmed = rawLine.trim();
    if (
      /^(?:[-*]\s*)?(?:视角|禁止透露|不能写破|知情边界)[：:]/u.test(trimmed)
    ) {
      lines.push(trimmed);
    }
  }
  return lines;
}

async function readBoundedExcerpt(
  input: AgentRunInput,
  bookId: string,
  file: LongWorkspaceFileReference,
  mode: "head" | "tail",
  maxChars: number,
  signal: AbortSignal
): Promise<ReadExcerptResult | undefined> {
  const execute = input.longCommandExecutor;
  if (!execute) return undefined;
  const context = {
    runId: input.runId,
    sessionId: input.sessionId,
    resourceId: bookId
  };

  const readPage = async (offset: number, maxCharacters: number) => {
    const reply = await execute(
      createEnvelope(
        "long.readDocument",
        { bookId, fileId: file.id, offset, maxCharacters },
        { id: randomUUID(), context }
      ),
      signal
    );
    if (reply.status !== "accepted") return undefined;
    const parsed = LongReadDocumentResultSchema.parse(reply.payload);
    if (
      parsed.bookId !== bookId ||
      parsed.file.id !== file.id ||
      parsed.offset !== offset
    ) {
      throw new Error("Core 返回了不匹配的长篇文档。");
    }
    return parsed;
  };

  if (mode === "head") {
    const res = await readPage(0, maxChars);
    if (!res || !res.content.trim()) return undefined;
    return {
      content: res.content.trimEnd(),
      updatedAt: res.file.updatedAt,
      totalCharacters: res.totalCharacters,
      range: res.nextOffset === null ? "full" : "head"
    };
  }

  // Tail read with one bounded retry on concurrent version change.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const probe = await readPage(0, 1);
    if (!probe || probe.totalCharacters === 0) return undefined;
    const offset = Math.max(0, probe.totalCharacters - maxChars);
    const tail = await readPage(offset, maxChars);
    if (!tail) return undefined;
    if (
      tail.file.updatedAt === probe.file.updatedAt &&
      tail.totalCharacters === probe.totalCharacters
    ) {
      if (!tail.content.trim()) return undefined;
      return {
        content: tail.content.trimEnd(),
        updatedAt: tail.file.updatedAt,
        totalCharacters: tail.totalCharacters,
        range: offset === 0 ? "full" : "tail"
      };
    }
  }
  return undefined;
}

function renderEvidenceHeader(
  label: string,
  meta: LongChapterEvidenceSourceMeta
): string {
  const kindLabel =
    meta.sourceKind === "chapter_plan"
      ? "章卡计划"
      : meta.sourceKind === "saved_manuscript"
        ? "已保存正文"
        : "连续性交接记录";
  const rangeLabel =
    meta.range === "full"
      ? "全文"
      : meta.range === "head"
        ? "开头片段"
        : "结尾片段";
  return `### ${label}（${meta.chapterCardId}/${meta.document}｜${kindLabel}｜${rangeLabel}｜Core 版本 ${meta.updatedAt}）`;
}

function buildContinuityNotes(
  selection: LongChapterContinuitySelection
): string[] {
  const notes: string[] = [];
  if (selection.unwrittenGapChapterIds.length > 0) {
    notes.push(
      `前置缺口：${selection.unwrittenGapChapterIds.join("、")} 尚未起稿。${
        selection.latestWrittenPrior
          ? `已回溯引用最近已写章节 ${selection.latestWrittenPrior.chapterCardId}（${selection.latestWrittenPrior.title}）的结尾。`
          : "此前暂无已写正文。"
      }`
    );
  }
  if (selection.coveringBatchCommit) {
    notes.push(
      `批次覆盖说明：目标章属于连续性批次 ${selection.coveringBatchCommit.commit.id}（覆盖 ${selection.coveringBatchCommit.chapterCardIds.join("、")}，检查点落在末章 ${selection.coveringBatchCommit.checkpointChapterCardId}）。因末章晚于或等于目标章，已忽略该批次末章 handoff，避免引入后续状态。`
    );
  }
  if (selection.priorCheckpoint?.staleDueToBodyChanges) {
    notes.push(
      `连贯状态待核对：最近前置检查点 ${selection.priorCheckpoint.commit.id}（截至 ${selection.priorCheckpoint.checkpoint.chapterCardId}）关联章节 ${selection.priorCheckpoint.changedChapterIds.join("、")} 在归档后已改稿，已忽略过期 handoff，改以最新已保存正文为准。`
    );
  } else if (
    selection.priorCheckpoint &&
    selection.priorCheckpoint.uncommittedIntermediateChapterIds.length > 0
  ) {
    notes.push(
      `未归档中间章提示：检查点 ${selection.priorCheckpoint.checkpoint.chapterCardId} 之后、目标章之前的 ${selection.priorCheckpoint.uncommittedIntermediateChapterIds.join("、")} 尚未归档，衔接以最新已保存正文为准。`
    );
  }
  return notes;
}

/**
 * Assembles bounded, version-tagged, permission-checked evidence for a single
 * unambiguous long-form chapter drafting or revision turn. Never grants write
 * or full-read credentials on the tool context.
 */
export async function assembleLongChapterEvidence(
  input: AgentRunInput,
  options: AssembleLongChapterEvidenceOptions = {}
): Promise<AssembledLongChapterEvidence | undefined> {
  if (input.disableLongChapterEvidencePrefetch) return undefined;
  const workspace = input.workspaceContext?.longWorkspace;
  const profile = input.longAgentProfile;
  const execute = input.longCommandExecutor;
  if (!workspace || !profile || !execute) return undefined;

  const readableRoots = new Set(profile.readAccess.workspaceRoots);
  const canReadCard = readableRoots.has(LONG_STAGE_ROOTS.plot);
  const canReadDraft = readableRoots.has(LONG_STAGE_ROOTS.draft);
  const canReadContinuity = readableRoots.has(LONG_STAGE_ROOTS.continuity);
  if (!canReadCard && !canReadDraft && !canReadContinuity) return undefined;

  const signal = AbortSignal.any([
    ...(input.signal ? [input.signal] : []),
    ...(options.signal ? [options.signal] : []),
    AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  ]);

  const indexReply = await execute(
    createEnvelope(
      "long.getWorkspaceIndex",
      { bookId: workspace.bookId },
      {
        id: randomUUID(),
        context: {
          runId: input.runId,
          sessionId: input.sessionId,
          resourceId: workspace.bookId
        }
      }
    ),
    signal
  );
  if (indexReply.status !== "accepted") return undefined;
  const parsedIndex = LongWorkspaceIndexResultSchema.parse(indexReply.payload);
  if (parsedIndex.bookId !== workspace.bookId) {
    throw new Error("取证时 Core 返回的作品索引与当前作品不匹配。");
  }
  const index = parsedIndex.workspaceIndex;

  let chapterCardId: string;
  let chapterTitle: string;
  let intent: LongChapterWriteIntent;

  if (options.overrideChapterCardId) {
    const entry = index.chapters.find(
      (c) => c.chapterCardId === options.overrideChapterCardId
    );
    const card = index.plot.chapterCards.find(
      (c) => c.id === options.overrideChapterCardId
    );
    if (!entry || !card) return undefined;
    chapterCardId = card.id;
    chapterTitle = card.title;
    intent =
      options.overrideIntent ??
      (entry.bodyStatus === "empty" ? "blank_draft" : "same_chapter_continue");
  } else {
    const target = resolveLongChapterEvidenceTarget(input, index);
    if (target.kind === "none") return undefined;
    if (target.kind === "conflict") {
      return {
        kind: "conflict",
        text: [
          "【单章取证冲突提醒】",
          `当前编辑器焦点在 ${target.focusChapterId}，但请求明确指向 ${target.explicitChapterId}。`,
          "在向正文提交修改提案前，请先向作者确认目标章节，切勿直接覆盖或写错章节。"
        ].join("\n"),
        sources: [],
        gaps: [
          `目标章冲突：focus=${target.focusChapterId}, explicit=${target.explicitChapterId}`
        ],
        hasPovGuard: false
      };
    }
    chapterCardId = target.chapterCardId;
    chapterTitle = target.chapterTitle;
    intent = target.intent;
  }

  const selection = selectApplicableContinuityCheckpoint(index, chapterCardId);
  if (!selection) return undefined;

  const needTargetBody =
    canReadDraft &&
    (intent === "same_chapter_continue" || intent === "in_chapter_revision");
  const needPriorBody =
    canReadDraft &&
    Boolean(selection.latestWrittenPrior) &&
    (intent === "blank_draft" ||
      intent === "in_chapter_revision" ||
      intent === "same_chapter_continue");
  const needPriorHandoff =
    canReadContinuity &&
    Boolean(selection.priorCheckpoint?.handoffUsable) &&
    (intent === "blank_draft" || intent === "in_chapter_revision");

  const gaps: string[] = [];
  const safeRead = async (
    label: string,
    file: LongWorkspaceFileReference | undefined,
    mode: "head" | "tail",
    maxChars: number
  ): Promise<ReadExcerptResult | undefined> => {
    if (!file) return undefined;
    try {
      const res = await readBoundedExcerpt(
        input,
        workspace.bookId,
        file,
        mode,
        maxChars,
        signal
      );
      return res;
    } catch (error) {
      if (signal.aborted) throw error;
      gaps.push(`未能自动读取 ${label}，需要时请调用 read 工具核对。`);
      return undefined;
    }
  };

  const [cardRes, targetBodyRes, priorBodyRes, handoffRes] = await Promise.all([
    canReadCard
      ? safeRead(
          `${chapterCardId}/card`,
          selection.target.chapter.card,
          "head",
          CARD_MAX_CHARS
        )
      : Promise.resolve(undefined),
    needTargetBody
      ? safeRead(
          `${chapterCardId}/body`,
          selection.target.chapter.body,
          "tail",
          BODY_TAIL_MAX_CHARS
        )
      : Promise.resolve(undefined),
    needPriorBody && selection.latestWrittenPrior
      ? safeRead(
          `${selection.latestWrittenPrior.chapterCardId}/body`,
          selection.latestWrittenPrior.chapter.body,
          "tail",
          BODY_TAIL_MAX_CHARS
        )
      : Promise.resolve(undefined),
    needPriorHandoff && selection.priorCheckpoint
      ? safeRead(
          `${selection.priorCheckpoint.checkpoint.chapterCardId}/handoff`,
          selection.priorCheckpoint.checkpoint.chapter.handoff,
          "head",
          HANDOFF_MAX_CHARS
        )
      : Promise.resolve(undefined)
  ]);

  // Same-chapter continuation only needs the previous chapter tail when the
  // current chapter is still very short (or unexpectedly empty on disk).
  const includePriorBody =
    priorBodyRes !== undefined &&
    (intent !== "same_chapter_continue" ||
      !targetBodyRes ||
      targetBodyRes.totalCharacters < 600);

  const budgetTokens = options.budgetTokens ?? DEFAULT_EVIDENCE_BUDGET_TOKENS;
  const sources: LongChapterEvidenceSourceMeta[] = [];
  const blocks: string[] = [];
  let usedTokens = 0;

  const tryPushBlock = (
    text: string,
    meta?: LongChapterEvidenceSourceMeta
  ): boolean => {
    const cost = estimateTextTokens(text + "\n\n");
    if (usedTokens + cost > budgetTokens) return false;
    usedTokens += cost;
    blocks.push(text);
    if (meta) sources.push(meta);
    return true;
  };

  const intentLabel =
    intent === "blank_draft"
      ? "空白章起稿"
      : intent === "same_chapter_continue"
        ? "同章续写"
        : "章内回改";

  tryPushBlock(
    [
      `【本轮单章取证快照（${chapterTitle}｜${chapterCardId}｜意图：${intentLabel}）】`,
      "以下片段由系统按权限从 Core 只读桥读取，仅作取证参考，不包含未接受提案，也不授予 edit 完整读取凭证；修改已有非空文档前仍须调用 read 完整读取。若正文与章卡规划有出入，续写衔接以最新已保存正文为准。"
    ].join("\n")
  );

  const povLines = cardRes ? extractPovGuardLines(cardRes.content) : [];
  const hasPovGuard = povLines.length > 0;
  if (hasPovGuard) {
    tryPushBlock(
      [
        "### 有限视角与揭示边界（来自当前章卡）",
        ...povLines,
        "严格约束：当前章视角人物只能依据本章及之前已获知的信息行动；较早对话、摘要或后文规划中已讨论的未来真相不得提前写入本章人物认知。"
      ].join("\n")
    );
  }

  const continuityNotes = buildContinuityNotes(selection);
  if (continuityNotes.length > 0) {
    tryPushBlock(["### 连续性与版本核对说明", ...continuityNotes].join("\n"));
  }

  if (cardRes) {
    const meta: LongChapterEvidenceSourceMeta = {
      chapterCardId,
      document: "card",
      sourceKind: "chapter_plan",
      range: cardRes.range,
      updatedAt: cardRes.updatedAt,
      characters: cardRes.content.length
    };
    if (
      !tryPushBlock(
        `${renderEvidenceHeader(`当前章卡：${chapterTitle}`, meta)}\n${cardRes.content}`,
        meta
      )
    ) {
      gaps.push(
        `章卡 ${chapterCardId}/card 超出本轮取证预算，请按需调用 read。`
      );
    }
  } else if (canReadCard) {
    gaps.push(`当前章卡 ${chapterCardId}/card 为空或未读取。`);
  }

  if (targetBodyRes) {
    const meta: LongChapterEvidenceSourceMeta = {
      chapterCardId,
      document: "body",
      sourceKind: "saved_manuscript",
      range: targetBodyRes.range,
      updatedAt: targetBodyRes.updatedAt,
      characters: targetBodyRes.content.length
    };
    if (
      !tryPushBlock(
        `${renderEvidenceHeader(`当前章正文衔接：${chapterTitle}`, meta)}\n${targetBodyRes.content}`,
        meta
      )
    ) {
      gaps.push(
        `当前章正文 ${chapterCardId}/body 超出本轮取证预算，请按需调用 read。`
      );
    }
  }

  if (includePriorBody && selection.latestWrittenPrior && priorBodyRes) {
    const prior = selection.latestWrittenPrior;
    const meta: LongChapterEvidenceSourceMeta = {
      chapterCardId: prior.chapterCardId,
      document: "body",
      sourceKind: "saved_manuscript",
      range: priorBodyRes.range,
      updatedAt: priorBodyRes.updatedAt,
      characters: priorBodyRes.content.length
    };
    if (
      !tryPushBlock(
        `${renderEvidenceHeader(`前序已保存正文衔接：${prior.title}`, meta)}\n${priorBodyRes.content}`,
        meta
      )
    ) {
      gaps.push(
        `前序正文 ${prior.chapterCardId}/body 超出本轮取证预算，请按需调用 read(id="${prior.chapterCardId}", document="body", range="tail")。`
      );
    }
  }

  if (handoffRes && selection.priorCheckpoint) {
    const cp = selection.priorCheckpoint.checkpoint;
    const meta: LongChapterEvidenceSourceMeta = {
      chapterCardId: cp.chapterCardId,
      document: "handoff",
      sourceKind: "continuity_handoff",
      range: handoffRes.range,
      updatedAt: handoffRes.updatedAt,
      characters: handoffRes.content.length
    };
    if (
      !tryPushBlock(
        `${renderEvidenceHeader(`严格早于本章的连续性检查点：${cp.title}`, meta)}\n${handoffRes.content}`,
        meta
      )
    ) {
      gaps.push(
        `检查点交接 ${cp.chapterCardId}/handoff 超出本轮取证预算，请按需调用 read。`
      );
    }
  }

  if (gaps.length > 0) {
    tryPushBlock(`### 取证缺口\n${gaps.map((g) => `- ${g}`).join("\n")}`);
  }

  if (
    sources.length === 0 &&
    continuityNotes.length === 0 &&
    gaps.length === 0
  ) {
    return undefined;
  }

  return {
    kind: "evidence",
    chapterCardId,
    intent,
    text: blocks.join("\n\n"),
    sources,
    gaps,
    hasPovGuard
  };
}
