import type { MysteryWorkspaceRuntimeContext } from "@writer/contracts";
import { MysteryWorkspaceRuntimeContextSchema } from "@writer/contracts/renderer";

/** Mystery context validation is only needed when a user submits a turn. */
export function validateMysteryRuntimeContext(
  context: MysteryWorkspaceRuntimeContext
): MysteryWorkspaceRuntimeContext {
  return MysteryWorkspaceRuntimeContextSchema.parse(context);
}
