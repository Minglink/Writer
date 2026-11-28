import {
  CommandEnvelopeSchema,
  SubscriptionAcquiredCredentialSchema,
  createEnvelope,
  type AgentPromptCommandPayload,
  type CommandResult,
  type CommandEnvelope
} from "@writer/contracts";
import type {
  AgentRunInput,
  LongCommandExecutor,
  MysteryCommandExecutor,
  LibraryManagementCommandExecutor,
  MaterialCommandExecutor,
  SubscriptionCredentialBridge,
  TeamManagementCommandExecutor
} from "@writer/agent-runtime";
import { createId } from "@writer/shared";
import type { UtilityCommandHandlerContext } from "./runtime";

function abortedError(): Error {
  const error = new Error("Workspace Core request was aborted.");
  error.name = "AbortError";
  return error;
}

/** Agent -> Core query bridge; Main authorizes each command per run. */
export function createCoreCommandExecutor(
  context: UtilityCommandHandlerContext
): (
  command:
    | Extract<
        CommandEnvelope,
        {
          type:
            | "catalog.readWritingWorkspace"
            | "catalog.readLibraryAgentLibrary"
            | "catalog.previewLibraryStructure";
        }
      >
    | Parameters<LongCommandExecutor>[0]
    | Parameters<MysteryCommandExecutor>[0]
    | Parameters<MaterialCommandExecutor>[0]
    | Parameters<LibraryManagementCommandExecutor>[0]
    | Parameters<TeamManagementCommandExecutor>[0],
  signal?: AbortSignal
) => Promise<CommandResult> {
  return (command, signal) => {
    if (signal?.aborted) return Promise.reject(abortedError());
    const request = context.requestInternalCommand("core", command, {
      timeoutMs: 60_000
    });
    if (!signal) return request;
    return new Promise((resolve, reject) => {
      const onAbort = (): void => {
        signal.removeEventListener("abort", onAbort);
        reject(abortedError());
      };
      signal.addEventListener("abort", onAbort, { once: true });
      void request.then(
        (result) => {
          signal.removeEventListener("abort", onAbort);
          if (signal.aborted) reject(abortedError());
          else resolve(result);
        },
        (error: unknown) => {
          signal.removeEventListener("abort", onAbort);
          reject(error);
        }
      );
    });
  };
}

/** Agent -> Main controlled credential bridge for short-lived subscription tokens. */
export function createSubscriptionCredentialBridge(
  context: UtilityCommandHandlerContext,
  scope: { runId: string; sessionId?: string }
): SubscriptionCredentialBridge {
  const envelopeContext = {
    runId: scope.runId,
    ...(scope.sessionId ? { sessionId: scope.sessionId } : {})
  };
  return {
    async acquireCredential(input) {
      const id = createId("cmd_sub_acquire");
      const command = CommandEnvelopeSchema.parse(
        createEnvelope(
          "subscriptions.acquireCredential",
          {
            runId: scope.runId,
            provider: input.provider,
            modelId: input.modelId,
            ...(input.accountId ? { accountId: input.accountId } : {})
          },
          { id, correlationId: id, context: envelopeContext }
        )
      );
      const result = await context.requestInternalCommand("main", command, {
        timeoutMs: 30_000
      });
      if (result.status === "rejected") {
        throw new Error(result.error.message);
      }
      return SubscriptionAcquiredCredentialSchema.parse(result.payload);
    },
    async reportAndFailover(input) {
      const id = createId("cmd_sub_failover");
      const command = CommandEnvelopeSchema.parse(
        createEnvelope(
          "subscriptions.reportAndFailover",
          {
            runId: scope.runId,
            provider: input.provider,
            modelId: input.modelId,
            failedAccountId: input.failedAccountId,
            reason: input.reason,
            ...(input.retryAfterSec !== undefined
              ? { retryAfterSec: input.retryAfterSec }
              : {}),
            ...(input.resetAt !== undefined ? { resetAt: input.resetAt } : {}),
            ...(input.message !== undefined ? { message: input.message } : {})
          },
          { id, correlationId: id, context: envelopeContext }
        )
      );
      const result = await context.requestInternalCommand("main", command, {
        timeoutMs: 30_000
      });
      if (result.status === "rejected") {
        throw new Error(result.error.message);
      }
      return SubscriptionAcquiredCredentialSchema.parse(result.payload);
    }
  };
}

export function createAgentRunInput(
  payload: AgentPromptCommandPayload,
  runId: string,
  signal: AbortSignal,
  context?: UtilityCommandHandlerContext
): AgentRunInput {
  return {
    runId,
    sessionId: payload.sessionId,
    prompt: payload.message,
    ...(payload.conversationHistory?.length
      ? { conversationHistory: payload.conversationHistory }
      : {}),
    ...(payload.conversationHistoryMode
      ? { conversationHistoryMode: payload.conversationHistoryMode }
      : {}),
    ...(payload.conversationCheckpoint
      ? { conversationCheckpoint: payload.conversationCheckpoint }
      : {}),
    ...(payload.contextCompaction
      ? { contextCompaction: payload.contextCompaction }
      : {}),
    ...(payload.contextCompactionSettings
      ? { contextCompactionSettings: payload.contextCompactionSettings }
      : {}),
    ...(payload.compactionRuntimeConfig
      ? { compactionRuntimeConfig: payload.compactionRuntimeConfig }
      : {}),
    ...(payload.attachments?.length
      ? { attachments: payload.attachments }
      : {}),
    ...(payload.promptLocale ? { promptLocale: payload.promptLocale } : {}),
    ...(payload.writeApprovalMode
      ? { writeApprovalMode: payload.writeApprovalMode }
      : {}),
    ...(payload.coCreationMode
      ? { coCreationMode: payload.coCreationMode }
      : {}),
    ...(payload.proposalSettlements
      ? { proposalSettlements: payload.proposalSettlements }
      : {}),
    ...(payload.thinkingLevel ? { thinkingLevel: payload.thinkingLevel } : {}),
    ...(payload.temperature !== undefined
      ? { temperature: payload.temperature }
      : {}),
    ...(payload.runtimeConfig ? { runtimeConfig: payload.runtimeConfig } : {}),
    ...(payload.webSearch ? { webSearch: payload.webSearch } : {}),
    ...(payload.webSearchEnabled === true ? { webSearchEnabled: true } : {}),
    ...(payload.agentProfile ? { agentProfile: payload.agentProfile } : {}),
    ...(payload.scriptAgentProfile
      ? { scriptAgentProfile: payload.scriptAgentProfile }
      : {}),
    ...(payload.longAgentProfile
      ? { longAgentProfile: payload.longAgentProfile }
      : {}),
    ...(payload.academicAgentProfile
      ? { academicAgentProfile: payload.academicAgentProfile }
      : {}),
    ...(payload.mysteryAgentProfile
      ? { mysteryAgentProfile: payload.mysteryAgentProfile }
      : {}),
    ...((payload.workspaceContext?.shortWorkspace ||
      payload.workspaceContext?.scriptWorkspace ||
      payload.workspaceContext?.academicWorkspace) &&
    context
      ? { writingCommandExecutor: createCoreCommandExecutor(context) }
      : {}),
    ...(payload.longAgentProfile && context
      ? { longCommandExecutor: createCoreCommandExecutor(context) }
      : {}),
    ...(payload.mysteryAgentProfile && context
      ? { mysteryCommandExecutor: createCoreCommandExecutor(context) }
      : {}),
    ...(payload.workspaceContext?.materialCatalog && context
      ? { materialCommandExecutor: createCoreCommandExecutor(context) }
      : {}),
    ...(payload.subagentDefinitions
      ? { subagentDefinitions: payload.subagentDefinitions }
      : {}),
    ...(payload.subagentRuntimeConfigs
      ? { subagentRuntimeConfigs: payload.subagentRuntimeConfigs }
      : {}),
    ...(payload.parallelSubagents ? { parallelSubagents: true } : {}),
    ...(payload.libraryManagement && context
      ? {
          libraryManagement: payload.libraryManagement,
          libraryManagementCommandExecutor: createCoreCommandExecutor(context)
        }
      : {}),
    ...(payload.teamManagement && context
      ? {
          teamManagement: payload.teamManagement,
          teamManagementCommandExecutor: createCoreCommandExecutor(context)
        }
      : {}),
    ...(payload.libraryAgentProfile
      ? {
          libraryAgentProfile: payload.libraryAgentProfile,
          ...(context
            ? {
                libraryAgentCommandExecutor: createCoreCommandExecutor(context)
              }
            : {})
        }
      : {}),
    ...(payload.workspaceContext
      ? { workspaceContext: payload.workspaceContext }
      : {}),
    ...(context
      ? {
          subscriptionCredentialBridge: createSubscriptionCredentialBridge(
            context,
            { runId, sessionId: payload.sessionId }
          )
        }
      : {}),
    signal
  };
}
