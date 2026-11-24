import type { AgentRuntimeRef } from "@writer/contracts";
import type { ChatMessage } from "../../types/conversation";
export interface MessageIdentityOperations {
  assistantMessageForRun(runId: string): ChatMessage | undefined;
  ensureAssistantMessage(
    runId: string,
    messageId: string,
    eventRuntime?: AgentRuntimeRef,
    createdAt?: string
  ): ChatMessage | undefined;
  ensureActivityMessage(
    runId: string,
    eventRuntime: AgentRuntimeRef,
    createdAt: string
  ): ChatMessage;
  ensureSubagentMessage(runId: string, createdAt: string): ChatMessage;
}
