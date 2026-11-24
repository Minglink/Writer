import * as fs from "node:fs";
import * as path from "node:path";
import { describe, it } from "vitest";
import {
  runLongMemoryEvalArm,
  summarizeLongMemoryEval,
  type LongMemoryCaseResult,
  type LongMemoryEvalArm
} from "./harness";
import { LONG_MEMORY_SEED_CASES, type EvalSessionState } from "./seed-cases";

interface MatrixRun {
  arm: LongMemoryEvalArm;
  state: EvalSessionState;
  label: string;
}

const MATRIX: MatrixRun[] = [
  {
    arm: "current_writer",
    state: "fresh",
    label: "Baseline (Current Writer) - Fresh"
  },
  {
    arm: "current_writer",
    state: "hot",
    label: "Baseline (Current Writer) - Hot"
  },
  {
    arm: "long_context",
    state: "hot",
    label: "Long Context Baseline (12k Chars) - Hot"
  },
  {
    arm: "oracle_evidence",
    state: "hot",
    label: "Oracle Evidence Baseline - Hot"
  },
  {
    arm: "p1_chapter_evidence",
    state: "fresh",
    label: "P1 Chapter Evidence - Fresh"
  },
  {
    arm: "p1_chapter_evidence",
    state: "hot",
    label: "P1 Chapter Evidence - Hot"
  },
  {
    arm: "p1_chapter_evidence",
    state: "post_compaction",
    label: "P1 Chapter Evidence - Post Compaction"
  },
  {
    arm: "p1_chapter_evidence",
    state: "cold_restore",
    label: "P1 Chapter Evidence - Cold Restore"
  }
];

describe("Long memory evaluation matrix", () => {
  it("runs full evaluation matrix and generates report artifacts", async () => {
    console.log(
      "================================================================================"
    );
    console.log(
      "Writer 长篇 Agent 记忆优化方案与执行计划 - P0/P1 实测矩阵运行"
    );
    console.log(
      `执行用例数: ${LONG_MEMORY_SEED_CASES.length} 种子场景 | 评测分支数: ${MATRIX.length}`
    );
    console.log(
      "================================================================================\n"
    );

    const allResults: LongMemoryCaseResult[] = [];
    const armRunOutputs: Record<string, LongMemoryCaseResult[]> = {};

    for (const item of MATRIX) {
      const started = Date.now();
      const results = await runLongMemoryEvalArm({
        arm: item.arm,
        sessionState: item.state
      });
      const duration = Date.now() - started;
      console.log(
        `Completed [${item.arm}] (${item.state}) in ${duration}ms - ${results.length} cases`
      );
      allResults.push(...results);
      armRunOutputs[`${item.arm}__${item.state}`] = results;
    }

    const summary = summarizeLongMemoryEval(allResults);

    const matrixSummaries = MATRIX.map((m) => {
      const cases = armRunOutputs[`${m.arm}__${m.state}`] ?? [];
      const hits = cases.reduce((acc, c) => acc + c.requiredHits, 0);
      const totalReq = cases.reduce((acc, c) => acc + c.requiredTotal, 0);
      const completeness = totalReq > 0 ? (hits / totalReq) * 100 : 100;
      const assemblyLeaks = cases.reduce(
        (acc, c) =>
          acc +
          c.forbiddenLeaks.filter((l) => l.entryPoint === "assembly").length,
        0
      );
      const nonAssemblyLeaks = cases.reduce(
        (acc, c) =>
          acc +
          c.forbiddenLeaks.filter((l) => l.entryPoint !== "assembly").length,
        0
      );
      const versionPassCount = cases.filter((c) => c.versionCorrect).length;
      const versionPassRate = (versionPassCount / cases.length) * 100;
      const passedCases = cases.filter(
        (c) => c.failureAttribution === "pass"
      ).length;

      return {
        arm: m.arm,
        state: m.state,
        label: m.label,
        totalCases: cases.length,
        passedCases,
        completeness: completeness.toFixed(1) + "%",
        versionPassRate: versionPassRate.toFixed(1) + "%",
        assemblyLeaks,
        nonAssemblyLeaks,
        failures: {
          missing_evidence: cases.filter(
            (c) => c.failureAttribution === "missing_evidence"
          ).length,
          wrong_evidence: cases.filter(
            (c) => c.failureAttribution === "wrong_evidence"
          ).length,
          model_misuse: cases.filter(
            (c) => c.failureAttribution === "model_misuse"
          ).length
        }
      };
    });

    console.log(
      "\n================================ 汇总对照表 ================================"
    );
    console.table(
      matrixSummaries.map((s) => ({
        分支与会话态: s.label,
        通过数: `${s.passedCases}/${s.totalCases}`,
        证据完整率: s.completeness,
        版本准确率: s.versionPassRate,
        组装泄漏数: s.assemblyLeaks,
        历史与检查点残留: s.nonAssemblyLeaks,
        缺证据: s.failures.missing_evidence,
        选错证据: s.failures.wrong_evidence
      }))
    );

    console.log(
      "\n================== 核心验收场景：seed_06 (80章真相后回写18章) ================"
    );
    for (const m of MATRIX.filter(
      (x) => x.arm === "current_writer" || x.arm === "p1_chapter_evidence"
    )) {
      const cases = armRunOutputs[`${m.arm}__${m.state}`] ?? [];
      const c6 = cases.find(
        (c) => c.caseId === "seed_06_limited_pov_future_leak"
      );
      if (!c6) continue;
      const asmLeaks = c6.forbiddenLeaks.filter(
        (l) => l.entryPoint === "assembly"
      );
      const histLeaks = c6.forbiddenLeaks.filter(
        (l) => l.entryPoint === "history" || l.entryPoint === "checkpoint"
      );
      console.log(`[${m.arm} | ${m.state}]`);
      console.log(
        `  - 证据完整率: ${(c6.evidenceCompleteness * 100).toFixed(0)}%`
      );
      console.log(
        `  - 组装层剧透泄漏 (assembly): ${asmLeaks.length > 0 ? asmLeaks.map((l) => l.label).join(", ") : "无 (0)"}`
      );
      console.log(
        `  - 历史/检查点背景残留 (history/checkpoint): ${histLeaks.length > 0 ? histLeaks.map((l) => `${l.label}(${l.entryPoint})`).join(", ") : "无"}`
      );
      console.log(`  - 归因结论: ${c6.failureAttribution}`);
    }

    console.log(
      "\n================== 核心验收场景：seed_03 (第17章重写后第18章衔接) =============="
    );
    for (const m of MATRIX.filter(
      (x) => x.arm === "current_writer" || x.arm === "p1_chapter_evidence"
    )) {
      const cases = armRunOutputs[`${m.arm}__${m.state}`] ?? [];
      const c3 = cases.find(
        (c) => c.caseId === "seed_03_edit_after_prior_rewrite"
      );
      if (!c3) continue;
      console.log(`[${m.arm} | ${m.state}]`);
      console.log(
        `  - 证据完整率: ${(c3.evidenceCompleteness * 100).toFixed(0)}%`
      );
      console.log(
        `  - 版本正确性: ${c3.versionCorrect ? "正确 (读到修订版)" : "错误 (读到旧版)"}`
      );
      console.log(`  - 组装层泄漏旧版/晚期快照: ${c3.forbiddenLeaks.length}`);
      console.log(`  - 归因结论: ${c3.failureAttribution}`);
    }

    const artifactsDir = path.resolve(
      process.cwd(),
      "test/2026-11-25-long-memory-eval"
    );
    if (!fs.existsSync(artifactsDir)) {
      fs.mkdirSync(artifactsDir, { recursive: true });
    }

    const rawJsonPath = path.join(artifactsDir, "eval-results.json");
    fs.writeFileSync(
      rawJsonPath,
      JSON.stringify({ matrixSummaries, summary, allResults }, null, 2),
      "utf8"
    );

    const matrixMdPath = path.join(artifactsDir, "matrix-summary.md");
    const markdownTable = [
      "| 分支与会话态 | 通过用例 | 证据完整率 | 版本准确率 | 组装泄漏数 | 历史/检查点残留 | 归因：缺证据 | 归因：选错证据 |",
      "| --- | --- | --- | --- | --- | --- | --- | --- |",
      ...matrixSummaries.map(
        (s) =>
          `| ${s.label} | ${s.passedCases}/${s.totalCases} | ${s.completeness} | ${s.versionPassRate} | ${s.assemblyLeaks} | ${s.nonAssemblyLeaks} | ${s.failures.missing_evidence} | ${s.failures.wrong_evidence} |`
      )
    ].join("\n");
    fs.writeFileSync(matrixMdPath, markdownTable, "utf8");

    console.log(`\n实测数据产物已保存:`);
    console.log(`  - JSON: ${rawJsonPath}`);
    console.log(`  - Markdown 表格: ${matrixMdPath}`);
  });
});
