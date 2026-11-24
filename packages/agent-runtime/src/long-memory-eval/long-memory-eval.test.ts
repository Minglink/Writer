import { describe, expect, it } from "vitest";
import { runLongMemoryEvalArm, summarizeLongMemoryEval } from "./harness";
import { LONG_MEMORY_SEED_CASES } from "./seed-cases";

describe("P0/P1 long-form memory evaluation harness", () => {
  it("runs all 8 seed cases across baseline arms and P1 with reproducible failure attribution", async () => {
    const [currentHot, longCtxHot, oracleHot, p1Hot, p1Compacted, p1Cold] =
      await Promise.all([
        runLongMemoryEvalArm({ arm: "current_writer", sessionState: "hot" }),
        runLongMemoryEvalArm({ arm: "long_context", sessionState: "hot" }),
        runLongMemoryEvalArm({ arm: "oracle_evidence", sessionState: "hot" }),
        runLongMemoryEvalArm({
          arm: "p1_chapter_evidence",
          sessionState: "hot"
        }),
        runLongMemoryEvalArm({
          arm: "p1_chapter_evidence",
          sessionState: "post_compaction"
        }),
        runLongMemoryEvalArm({
          arm: "p1_chapter_evidence",
          sessionState: "cold_restore"
        })
      ]);

    const report = summarizeLongMemoryEval([
      ...currentHot,
      ...longCtxHot,
      ...oracleHot,
      ...p1Hot
    ]);

    expect(LONG_MEMORY_SEED_CASES).toHaveLength(8);

    const currentSummary = report.arms.find((a) => a.arm === "current_writer")!;
    const oracleSummary = report.arms.find((a) => a.arm === "oracle_evidence")!;
    const p1Summary = report.arms.find((a) => a.arm === "p1_chapter_evidence")!;

    // Baseline current_writer without P1 prefetch lacks required chapter evidence upfront.
    expect(currentSummary.avgEvidenceCompleteness).toBeLessThan(0.5);
    expect(currentSummary.failureCounts.missing_evidence).toBeGreaterThan(0);

    // Oracle arm has 100% required evidence completeness.
    expect(oracleSummary.avgEvidenceCompleteness).toBe(1);

    // P1 achieves >= 90% required evidence completeness with 0 assembly leaks.
    expect(p1Summary.avgEvidenceCompleteness).toBeGreaterThanOrEqual(0.9);
    expect(p1Summary.assemblyLeaks).toBe(0);

    // Rewritten chapter 17 case uses the latest saved version and omits stale handoff.
    const ch17Rewrite = p1Hot.find(
      (r) => r.caseId === "seed_03_edit_after_prior_rewrite"
    )!;
    expect(ch17Rewrite.evidenceCompleteness).toBe(1);
    expect(ch17Rewrite.versionCorrect).toBe(true);
    expect(
      ch17Rewrite.forbiddenLeaks.filter((l) => l.entryPoint === "assembly")
    ).toHaveLength(0);

    // Batch intermediate chapter 16 never pulls chapter 17's later handoff.
    const ch16Batch = p1Hot.find(
      (r) => r.caseId === "seed_04_batch_intermediate_chapter"
    )!;
    expect(ch16Batch.evidenceCompleteness).toBe(1);
    expect(ch16Batch.forbiddenLeaks).toHaveLength(0);

    // Core acceptance scenario (seed_06): P1 assembly has zero future leaks;
    // any future-truth presence in history/checkpoint is explicitly attributed.
    const povCold = p1Cold.find(
      (r) => r.caseId === "seed_06_limited_pov_future_leak"
    )!;
    expect(povCold.evidenceCompleteness).toBe(1);
    expect(
      povCold.forbiddenLeaks.filter((l) => l.entryPoint === "assembly")
    ).toHaveLength(0);
    expect(
      povCold.forbiddenLeaks.some(
        (l) => l.entryPoint === "history" || l.entryPoint === "checkpoint"
      )
    ).toBe(true);

    // Post-compaction and cold-restore P1 runs maintain >= 90% completeness.
    const p1CompactedSummary = summarizeLongMemoryEval(p1Compacted).arms[0]!;
    const p1ColdSummary = summarizeLongMemoryEval(p1Cold).arms[0]!;
    expect(p1CompactedSummary.avgEvidenceCompleteness).toBeGreaterThanOrEqual(
      0.9
    );
    expect(p1ColdSummary.avgEvidenceCompleteness).toBeGreaterThanOrEqual(0.9);

    // Fresh run with empty prior history must report 0 history/checkpoint leaks.
    const p1Fresh = await runLongMemoryEvalArm({
      arm: "p1_chapter_evidence",
      sessionState: "fresh"
    });
    const povFresh = p1Fresh.find(
      (r) => r.caseId === "seed_06_limited_pov_future_leak"
    )!;
    expect(povFresh.forbiddenLeaks).toHaveLength(0);
  });
});
