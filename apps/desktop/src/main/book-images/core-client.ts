import {
  CommandEnvelopeSchema,
  createEnvelope,
  type BookImageBookRef,
  type CommandEnvelope,
  type CommandResult
} from "@writer/contracts";
import { createId } from "@writer/shared";

export type BookImageCore = (
  command: CommandEnvelope
) => Promise<CommandResult>;
export async function bookImageCore(
  core: BookImageCore,
  type: "bookImages.write" | "bookImages.resolve",
  payload: unknown,
  book: BookImageBookRef
): Promise<unknown> {
  const id = createId("cmd_book_image_core");
  const result = await core(
    CommandEnvelopeSchema.parse(
      createEnvelope(type, payload, {
        id,
        correlationId: id,
        context: { resourceId: book.projectId }
      })
    )
  );
  if (result.status === "rejected") throw result.error;
  return result.payload;
}
