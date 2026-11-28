import {
  SubscriptionCancelAuthResultSchema,
  SubscriptionScanLocalResultSchema,
  SubscriptionSettingsSnapshotSchema,
  SubscriptionStartAuthResultSchema,
  type CommandEnvelope,
  type CommandResult
} from "@writer/contracts";
import type { SubscriptionAccountManager } from "./manager";
import { safeSubscriptionError } from "./types";

export async function handleSubscriptionCommands(
  command: CommandEnvelope,
  manager: SubscriptionAccountManager
): Promise<CommandResult | undefined> {
  if (!command.type.startsWith("subscriptions.")) return undefined;

  if (
    command.type === "subscriptions.acquireCredential" ||
    command.type === "subscriptions.reportAndFailover"
  ) {
    return {
      status: "rejected",
      requestId: command.id,
      error: {
        code: "ipc.forbidden_internal_command",
        message: "Renderer cannot invoke internal commands."
      }
    };
  }

  try {
    let payload: unknown;
    switch (command.type) {
      case "subscriptions.getState":
        payload = SubscriptionSettingsSnapshotSchema.parse(
          await manager.getState()
        );
        break;
      case "subscriptions.startAuth":
        payload = SubscriptionStartAuthResultSchema.parse(
          await manager.startAuth(command.payload)
        );
        break;
      case "subscriptions.cancelAuth":
        payload = SubscriptionCancelAuthResultSchema.parse(
          await manager.cancelAuth(command.payload)
        );
        break;
      case "subscriptions.scanLocal":
        payload = SubscriptionScanLocalResultSchema.parse(
          await manager.scanLocal(command.payload)
        );
        break;
      case "subscriptions.importLocal":
        payload = SubscriptionSettingsSnapshotSchema.parse(
          await manager.importLocal(command.payload)
        );
        break;
      case "subscriptions.importManual":
        payload = SubscriptionSettingsSnapshotSchema.parse(
          await manager.importManual(command.payload)
        );
        break;
      case "subscriptions.setPrimaryAccount":
        payload = SubscriptionSettingsSnapshotSchema.parse(
          await manager.setPrimaryAccount(command.payload)
        );
        break;
      case "subscriptions.setAccountEnabled":
        payload = SubscriptionSettingsSnapshotSchema.parse(
          await manager.setAccountEnabled(command.payload)
        );
        break;
      case "subscriptions.removeAccount":
        payload = SubscriptionSettingsSnapshotSchema.parse(
          await manager.removeAccount(command.payload)
        );
        break;
      case "subscriptions.refreshQuota":
        payload = SubscriptionSettingsSnapshotSchema.parse(
          await manager.refreshQuota(command.payload)
        );
        break;
      case "subscriptions.refreshModels":
        payload = SubscriptionSettingsSnapshotSchema.parse(
          await manager.refreshModels(command.payload)
        );
        break;
      case "subscriptions.setModelEnabled":
        payload = SubscriptionSettingsSnapshotSchema.parse(
          await manager.setModelEnabled(command.payload)
        );
        break;
      case "subscriptions.setDefaultModel":
        payload = SubscriptionSettingsSnapshotSchema.parse(
          await manager.setDefaultModel(command.payload)
        );
        break;
      default:
        return undefined;
    }
    return { status: "accepted", requestId: command.id, payload };
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
