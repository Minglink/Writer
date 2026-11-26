import { runLongMemoryEvalArm, summarizeLongMemoryEval } from "./harness";

/**
 * Optional env-gated live-API runner for long-memory evaluation.
 * Skips cleanly when WRITER_EVAL_API_KEY is absent so CI/local offline runs never fail.
 */
async function main(): Promise<void> {
  const apiKey = process.env.WRITER_EVAL_API_KEY?.trim();
  const baseUrl = process.env.WRITER_EVAL_BASE_URL?.trim();
  const modelId = process.env.WRITER_EVAL_MODEL_ID?.trim() || "deepseek-chat";

  if (!apiKey || !baseUrl) {
    console.log(
      "SKIPPED: Set WRITER_EVAL_API_KEY and WRITER_EVAL_BASE_URL to run live API long-memory eval."
    );
    return;
  }

  const results = await runLongMemoryEvalArm({
    arm: "p1_chapter_evidence",
    sessionState: "hot",
    runtimeConfig: {
      id: "eval-live",
      label: "Live Eval Model",
      provider: "openai-compatible",
      modelId,
      api: "openai-completions",
      baseUrl,
      apiKey,
      reasoning: false,
      defaultThinkingLevel: "off",
      thinkingLevelOptions: [],
      temperatureOptions: [0.3, 0.7, 1.0]
    }
  });
  const report = summarizeLongMemoryEval(results);
  console.log(JSON.stringify(report, null, 2));
}

if (import.meta.url === `file://${process.argv[1]?.replaceAll("\\", "/")}`) {
  void main();
}
