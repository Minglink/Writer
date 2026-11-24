/** The isolated UI smoke exposes a selectable model without provider traffic. */
export function isBookIdentityFauxSmokeModel(
  modelId: string | undefined
): boolean {
  return (
    process.env.WRITER_SMOKE === "1" &&
    process.env.WRITER_SMOKE_SUITE === "book-identity" &&
    process.env.WRITER_APP_MODE === "evaluation" &&
    modelId === "book_identity_smoke_model"
  );
}
