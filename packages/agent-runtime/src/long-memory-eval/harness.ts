import type {
  AgentEvaluationSnapshot,
  AgentUsage,
  LongAgentProfile
} from "@writer/contracts";
import { PiAgentRuntimeAdapter } from "../adapter";
import type { AgentRunInput } from "../runtime-types";
import {
  createSyntheticLongBook,
  createSyntheticLongCommandExecutor,
  createSyntheticLongProfile,
  createSyntheticRuntimeContext,
  type SyntheticLongBook
} from "./synthetic-book";
import {
  LONG_MEMORY_SEED_CASES,
  type EvalSessionState,
  type LongMemorySeedCase
} from "./seed-cases";

export type LongMemoryEvalArm =
  "current_writer" | "long_context" | "oracle_evidence" | "p1_chapter_evidence";

export type FailureAttribution =
  "pass" | "missing_evidence" | "wrong_evidence" | "model_misuse";

export interface ForbiddenLeakObservation {
  label: string;
  pattern: string;
  sourceKind: LongMemorySeedCase["forbiddenInfo"][number]["sourceKind"];
  entryPoint: "assembly" | "history" | "checkpoint" | "tool_result";
}

export interface LongMemoryCaseResult {
  caseId: string;
  arm: LongMemoryEvalArm;
  sessionState: EvalSessionState;
  requiredTotal: number;
  requiredHits: number;
  missingEvidenceIds: string[];
  evidenceCompleteness: number;
  forbiddenLeaks: ForbiddenLeakObservation[];
  versionCorrect: boolean;
  failureAttribution: FailureAttribution;
  toolCalls: number;
  ttftMs: number | null;
  durationMs: number;
  usage: AgentUsage | null;
  longContextChars?: number;
}

export interface LongMemoryArmSummary {
  arm: LongMemoryEvalArm;
  totalRuns: number;
  passCount: number;
  avgEvidenceCompleteness: number;
  totalForbiddenLeaks: number;
  assemblyLeaks: number;
  historyOrCheckpointLeaks: number;
  failureCounts: Record<FailureAttribution, number>;
  avgToolCalls: number;
  p95DurationMs: number;
}

export interface LongMemoryEvalReport {
  generatedAt: string;
  arms: LongMemoryArmSummary[];
  results: LongMemoryCaseResult[];
}

export interface RunEvalArmOptions {
  arm: LongMemoryEvalArm;
  sessionState: EvalSessionState;
  cases?: readonly LongMemorySeedCase[];
  profile?: LongAgentProfile;
  /** Optional hook for real-model runs; omit for deterministic faux runs. */
  runtimeConfig?: AgentRunInput["runtimeConfig"];
}

function buildLongContextPrefix(
  book: SyntheticLongBook,
  maxChars = 12_000
): string {
  const parts: string[] = ["【长上下文基线：连续原文拼接】"];
  let used = 0;
  for (const chapter of book.index.chapters) {
    const body = book.files.get(chapter.body.id)?.content.trim();
    if (!body) continue;
    const block = `### ${chapter.chapterCardId}\n${body}`;
    if (used + block.length > maxChars) break;
    parts.push(block);
    used += block.length;
  }
  return parts.join("\n\n");
}

function extractSnapshotTexts(
  snapshot: AgentEvaluationSnapshot | undefined,
  sessionState: EvalSessionState,
  initialSnapshot?: AgentEvaluationSnapshot
): {
  assemblyText: string;
  historyText: string;
  checkpointText: string;
  toolResultText: string;
} {
  if (!snapshot) {
    return {
      assemblyText: "",
      historyText: "",
      checkpointText: "",
      toolResultText: ""
    };
  }
  const assemblyText = snapshot.runtimeContext.text;
  const historyParts: string[] = [];
  const checkpointParts: string[] = [];
  const toolParts: string[] = [];
  const priorMessages =
    initialSnapshot?.conversationHistory ?? snapshot.conversationHistory ?? [];
  for (const msg of priorMessages) {
    if (msg.role === "tool") {
      toolParts.push(msg.text);
      continue;
    }
    // Skip the current turn's own injected runtime-context / chapter-evidence message
    // so it is scored exclusively in the assembly bucket, never as prior history.
    if (msg.text === assemblyText || msg.text.includes("【本轮单章取证快照")) {
      continue;
    }
    if (msg.text.includes("【较早对话的压缩检查点】")) {
      if (sessionState !== "fresh") {
        checkpointParts.push(msg.text);
      }
    } else if (sessionState !== "fresh") {
      historyParts.push(msg.text);
    }
  }
  if (initialSnapshot && snapshot !== initialSnapshot) {
    for (const msg of snapshot.conversationHistory ?? []) {
      if (msg.role === "tool") {
        toolParts.push(msg.text);
      }
    }
  }
  return {
    assemblyText,
    historyText: historyParts.join("\n"),
    checkpointText: checkpointParts.join("\n"),
    toolResultText: toolParts.join("\n")
  };
}

export function scoreEvalSnapshot(
  seed: LongMemorySeedCase,
  arm: LongMemoryEvalArm,
  sessionState: EvalSessionState,
  snapshot: AgentEvaluationSnapshot | undefined,
  metrics: {
    toolCalls: number;
    ttftMs: number | null;
    durationMs: number;
    usage: AgentUsage | null;
    longContextChars?: number;
  },
  initialSnapshot?: AgentEvaluationSnapshot
): LongMemoryCaseResult {
  const texts = extractSnapshotTexts(snapshot, sessionState, initialSnapshot);
  const allVisible = [
    texts.assemblyText,
    texts.historyText,
    texts.checkpointText,
    texts.toolResultText
  ].join("\n");

  const missingEvidenceIds: string[] = [];
  let versionCorrect = true;
  for (const req of seed.requiredEvidence) {
    if (!allVisible.includes(req.mustContain)) {
      missingEvidenceIds.push(`${req.id}/${req.document}`);
      continue;
    }
    if (
      req.allowedUpdatedAt &&
      texts.assemblyText.includes(req.mustContain) &&
      !texts.assemblyText.includes(req.allowedUpdatedAt) &&
      arm === "p1_chapter_evidence"
    ) {
      versionCorrect = false;
    }
  }

  const forbiddenLeaks: ForbiddenLeakObservation[] = [];
  for (const item of seed.forbiddenInfo) {
    const check = (
      entryPoint: ForbiddenLeakObservation["entryPoint"],
      haystack: string
    ) => {
      if (haystack.includes(item.pattern)) {
        forbiddenLeaks.push({
          label: item.label,
          pattern: item.pattern,
          sourceKind: item.sourceKind,
          entryPoint
        });
      }
    };
    // For limited POV cards, the card itself legitimately mentions "禁止透露：周明远是幕后主使".
    // Only count an assembly leak when the forbidden pattern appears outside a "禁止透露" guard line.
    const assemblyWithoutGuardLines = texts.assemblyText
      .split("\n")
      .filter(
        (line) => !line.includes("禁止透露") && !line.includes("视角边界")
      )
      .join("\n");
    check("assembly", assemblyWithoutGuardLines);
    check("history", texts.historyText);
    check("checkpoint", texts.checkpointText);
    check("tool_result", texts.toolResultText);
  }

  const requiredTotal = seed.requiredEvidence.length;
  const requiredHits = requiredTotal - missingEvidenceIds.length;
  const evidenceCompleteness =
    requiredTotal === 0 ? 1 : requiredHits / requiredTotal;

  let failureAttribution: FailureAttribution = "pass";
  if (missingEvidenceIds.length > 0) {
    failureAttribution = "missing_evidence";
  } else if (
    !versionCorrect ||
    forbiddenLeaks.some((leak) => leak.entryPoint === "assembly")
  ) {
    failureAttribution = "wrong_evidence";
  }

  return {
    caseId: seed.id,
    arm,
    sessionState,
    requiredTotal,
    requiredHits,
    missingEvidenceIds,
    evidenceCompleteness,
    forbiddenLeaks,
    versionCorrect,
    failureAttribution,
    toolCalls: metrics.toolCalls,
    ttftMs: metrics.ttftMs,
    durationMs: metrics.durationMs,
    usage: metrics.usage,
    ...(metrics.longContextChars !== undefined
      ? { longContextChars: metrics.longContextChars }
      : {})
  };
}

export async function runLongMemoryEvalArm(
  options: RunEvalArmOptions
): Promise<LongMemoryCaseResult[]> {
  const cases = options.cases ?? LONG_MEMORY_SEED_CASES;
  const results: LongMemoryCaseResult[] = [];

  for (const seed of cases) {
    const book = createSyntheticLongBook(
      seed.rewriteChapter17 !== undefined
        ? { rewriteChapter17: seed.rewriteChapter17 }
        : {}
    );
    const profile = options.profile ?? createSyntheticLongProfile();
    const executor = createSyntheticLongCommandExecutor(book);
    const runtime = new PiAgentRuntimeAdapter({
      evaluationMode: true,
      tokensPerSecond: 0
    });

    let prompt = seed.prompt;
    let longContextChars: number | undefined;
    if (options.arm === "long_context") {
      const prefix = buildLongContextPrefix(book);
      longContextChars = prefix.length;
      prompt = `${prefix}\n\n${seed.prompt}`;
    } else if (options.arm === "oracle_evidence") {
      prompt = `${seed.oracleEvidenceText}\n\n${seed.prompt}`;
    }

    const baseInput: AgentRunInput = {
      runId: `eval_${options.arm}_${options.sessionState}_${seed.id}`,
      sessionId: `session_${options.arm}_${options.sessionState}_${seed.id}`,
      prompt,
      thinkingLevel: "off",
      longAgentProfile: profile,
      longCommandExecutor: executor,
      ...(options.runtimeConfig
        ? { runtimeConfig: options.runtimeConfig }
        : {}),
      ...(seed.coCreationMode ? { coCreationMode: seed.coCreationMode } : {}),
      // Disable P1 auto-assembly on non-P1 arms so baseline vs P1 is strictly controlled.
      ...(options.arm !== "p1_chapter_evidence"
        ? { disableLongChapterEvidencePrefetch: true }
        : {}),
      workspaceContext: {
        longWorkspace: createSyntheticRuntimeContext(book, {
          activeRoot: seed.activeRoot,
          activeChapterCardId: seed.activeChapterCardId,
          profile
        })
      },
      contextCompactionSettings: {
        enabled: true,
        budgetTokens: 32_000
      }
    };

    if (
      options.sessionState === "hot" &&
      seed.priorConversationHistory?.length
    ) {
      baseInput.conversationHistory = seed.priorConversationHistory;
    } else if (options.sessionState === "post_compaction") {
      if (seed.priorCheckpoint) {
        baseInput.conversationCheckpoint = seed.priorCheckpoint;
      } else {
        baseInput.conversationCheckpoint = {
          summary: "此前已完成前序章节的规划与校对。",
          firstKeptCreatedAt: "2026-11-23T00:00:00.000Z",
          tokensBefore: 8_000,
          createdAt: "2026-11-23T01:00:00.000Z"
        };
      }
    } else if (options.sessionState === "cold_restore") {
      if (seed.priorCheckpoint) {
        baseInput.conversationCheckpoint = seed.priorCheckpoint;
      }
      if (seed.priorConversationHistory?.length) {
        baseInput.conversationHistory = seed.priorConversationHistory;
      }
    }

    const startedAt = Date.now();
    let ttftMs: number | null = null;
    let toolCalls = 0;
    let usage: AgentUsage | null = null;
    let initialSnapshot: AgentEvaluationSnapshot | undefined;
    let latestSnapshot: AgentEvaluationSnapshot | undefined;

    for await (const event of runtime.start(baseInput)) {
      if (event.type === "agent.delta" && ttftMs === null) {
        ttftMs = Date.now() - startedAt;
      } else if (event.type === "agent.tool_requested") {
        toolCalls += 1;
      } else if (event.type === "agent.usage_observed") {
        usage = event.payload.usage;
      } else if (event.type === "agent.evaluation_snapshot") {
        if (!initialSnapshot) {
          initialSnapshot = event.payload.snapshot;
        }
        latestSnapshot = event.payload.snapshot;
      }
    }

    const durationMs = Date.now() - startedAt;
    results.push(
      scoreEvalSnapshot(
        seed,
        options.arm,
        options.sessionState,
        latestSnapshot,
        {
          toolCalls,
          ttftMs,
          durationMs,
          usage,
          ...(longContextChars !== undefined ? { longContextChars } : {})
        },
        initialSnapshot
      )
    );
  }

  return results;
}

export function summarizeLongMemoryEval(
  results: readonly LongMemoryCaseResult[]
): LongMemoryEvalReport {
  const arms = Array.from(new Set(results.map((r) => r.arm)));
  const summaries: LongMemoryArmSummary[] = arms.map((arm) => {
    const rows = results.filter((r) => r.arm === arm);
    const failureCounts: Record<FailureAttribution, number> = {
      pass: 0,
      missing_evidence: 0,
      wrong_evidence: 0,
      model_misuse: 0
    };
    let completenessSum = 0;
    let totalForbiddenLeaks = 0;
    let assemblyLeaks = 0;
    let historyOrCheckpointLeaks = 0;
    let toolCallsSum = 0;
    const durations: number[] = [];

    for (const row of rows) {
      failureCounts[row.failureAttribution] += 1;
      completenessSum += row.evidenceCompleteness;
      totalForbiddenLeaks += row.forbiddenLeaks.length;
      assemblyLeaks += row.forbiddenLeaks.filter(
        (l) => l.entryPoint === "assembly"
      ).length;
      historyOrCheckpointLeaks += row.forbiddenLeaks.filter(
        (l) => l.entryPoint === "history" || l.entryPoint === "checkpoint"
      ).length;
      toolCallsSum += row.toolCalls;
      durations.push(row.durationMs);
    }
    durations.sort((a, b) => a - b);
    const p95Index = Math.min(
      durations.length - 1,
      Math.max(0, Math.ceil(durations.length * 0.95) - 1)
    );

    return {
      arm,
      totalRuns: rows.length,
      passCount: failureCounts.pass,
      avgEvidenceCompleteness:
        rows.length > 0 ? completenessSum / rows.length : 0,
      totalForbiddenLeaks,
      assemblyLeaks,
      historyOrCheckpointLeaks,
      failureCounts,
      avgToolCalls: rows.length > 0 ? toolCallsSum / rows.length : 0,
      p95DurationMs: durations[p95Index] ?? 0
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    arms: summaries,
    results: [...results]
  };
}
