import {
  SubscriptionAcquiredCredentialSchema,
  type CommandResult
} from "@writer/contracts";
import type { UtilityInternalCommandAuthorizationContext } from "../supervisor";
import type { SubscriptionAccountManager } from "./manager";
import { safeSubscriptionError } from "./types";

/**
 * Handles Agent -> Main internal subscription credential commands after
 * allowlist and active-run/model-test authorization. Never returns refresh tokens.
 */
export async function handleSubscriptionInternalCommand(
  context: UtilityInternalCommandAuthorizationContext,
  getManager: () => SubscriptionAccountManager | undefined
): Promise<CommandResult | undefined> {
  if (context.target !== "main") return undefined;
  const { command } = context.message;
  if (
    command.type !== "subscriptions.acquireCredential" &&
    command.type !== "subscriptions.reportAndFailover"
  ) {
    return undefined;
  }
  const manager = getManager();
  if (!manager) {
    return {
      status: "rejected",
      requestId: command.id,
      error: {
        code: "subscriptions.manager_unavailable",
        message: "订阅账号管理器尚未初始化。"
      }
    };
  }
  try {
    const credential =
      command.type === "subscriptions.acquireCredential"
        ? await manager.acquireCredential(command.payload)
        : await manager.reportAndFailover(command.payload);
    return {
      status: "accepted",
      requestId: command.id,
      payload: SubscriptionAcquiredCredentialSchema.parse(credential)
    };
  } catch (error: unknown) {
    const safe = safeSubscriptionError(error);
    return {
      status: "rejected",
      requestId: command.id,
      error: {
        code: safe.code,
        message: safe.message
      }
    };
  }
}
