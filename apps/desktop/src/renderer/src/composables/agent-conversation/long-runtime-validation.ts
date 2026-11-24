import type { LongWorkspaceRuntimeContext } from "@writer/contracts";
import { LongWorkspaceRuntimeContextSchema } from "@writer/contracts/renderer";

/** Long-form context validation is only needed when a user submits a turn. */
export function validateLongRuntimeContext(
  context: LongWorkspaceRuntimeContext
): LongWorkspaceRuntimeContext {
  return LongWorkspaceRuntimeContextSchema.parse(context);
}
