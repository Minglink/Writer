/** The isolated evaluation smoke selects Faux without registering provider credentials. */
export function isDecompositionFauxSmokeModel(
  modelId: string | undefined
): boolean {
  return (
    process.env.WRITER_SMOKE === "1" &&
    process.env.WRITER_SMOKE_SUITE === "decomposition" &&
    process.env.WRITER_APP_MODE === "evaluation" &&
    modelId === "decomposition_smoke_model"
  );
}
