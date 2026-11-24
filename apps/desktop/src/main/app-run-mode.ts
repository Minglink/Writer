export type WriterAppMode = "runtime" | "evaluation";

/**
 * Evaluation capture is strictly opt-in. Missing, misspelled, or unsupported
 * values all retain the normal runtime behavior.
 */
export function resolveWriterAppMode(value: string | undefined): WriterAppMode {
  return value?.trim().toLowerCase() === "evaluation"
    ? "evaluation"
    : "runtime";
}
