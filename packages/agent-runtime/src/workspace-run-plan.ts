import {
  fauxAssistantMessage,
  fauxText,
  fauxThinking
} from "@earendil-works/pi-ai";
import type { AgentTurnRetryPolicyOptions } from "./agent-turn-retry";
import { assertConversationPromptBudget } from "@writer/contracts";
import { conversationAgentKey } from "./conversation-agent-rebuild";
import { buildLocalThinking, buildLocalWritingResponse } from "./faux-local";
import type { AgentRunPlan } from "./kernel/run-plan";
import { libraryManagementParentPrompt } from "./library-management-runtime";
import { teamManagementParentPrompt } from "./team-management-runtime";
import { resolvePortableToolSchemaProfile } from "./portable-tool-schema";
import {
  buildLongCoCreationBoundary,
  buildLongRuntimeToolBoundary
} from "./prompts-long";
import {
  buildEffectiveSystemPrompt,
  buildFollowUpRawUserMessageContent,
  buildLongFollowUpTurnUserMessageContent,
  buildMysteryFollowUpTurnUserMessageContent,
  buildRawUserMessage,
  buildRuntimeUserMessageContent,
  longAgentRefreshesDesignContextOnLaterTurns
} from "./prompts";
import { buildRunTools } from "./run-tools";
import type { AgentRunInput } from "./runtime-types";
import type { AgentToolExecutionHooks } from "./subagent-runtime";
import { workspaceContextPolicy } from "./workspace-context-policy";
import { assembleLongChapterEvidence } from "./long-chapter-evidence-assembler";
import type { UserMessage } from "@earendil-works/pi-ai";

function attachChapterEvidence(
  content: UserMessage["content"],
  evidenceText: string
): UserMessage["content"] {
  if (typeof content === "string") {
    const marker = "\n【用户消息与上传附件】\n";
    const markerIndex = content.lastIndexOf(marker);
    if (markerIndex >= 0) {
      return (
        content.slice(0, markerIndex) +
        `\n\n${evidenceText}` +
        content.slice(markerIndex)
      );
    }
    return `${content}\n\n${evidenceText}`;
  }
  const next = [...content];
  const firstTextIndex = next.findIndex((block) => block.type === "text");
  if (firstTextIndex >= 0) {
    const first = next[firstTextIndex]!;
    if (first.type === "text") {
      next[firstTextIndex] = {
        ...first,
        text: attachChapterEvidence(first.text, evidenceText) as string
      };
      return next;
    }
  }
  return [{ type: "text", text: evidenceText }, ...next];
}

export interface WorkspaceRunPlanOptions {
  /** Overrides the localized ground rules; normally omitted. */
  basePrompt?: string;
  toolExecutionHooks: AgentToolExecutionHooks;
  retryPolicy?: AgentTurnRetryPolicyOptions;
  subagentTimeoutMs?: number;
}

/**
 * Assembles creation-space and library runs that arrive through
 * `session.prompt`. "更多功能" agents, chat included, use `planExtrasRun`.
 */
export function planWorkspaceRun(
  input: AgentRunInput,
  options: WorkspaceRunPlanOptions
): AgentRunPlan {
  const shortWorkspace = input.workspaceContext?.shortWorkspace;
  const scriptWorkspace = input.workspaceContext?.scriptWorkspace;
  const academicWorkspace = input.workspaceContext?.academicWorkspace;
  const contextPolicy = workspaceContextPolicy(input);
  const portableToolSchemaProfile = resolvePortableToolSchemaProfile(
    input.workspaceContext
  );
  return {
    target: input,
    eventSource: input,
    agentKey: conversationAgentKey(input),
    portableToolSchemaProfile,
    pausesForWriteApproval: input.writeApprovalMode !== "auto-approve",
    assertModelBudget: () =>
      assertConversationPromptBudget(
        { message: input.prompt, attachments: input.attachments },
        input.contextCompactionSettings?.budgetTokens
      ),
    fauxResponses: (thinkingLevel) => [
      fauxAssistantMessage(
        thinkingLevel === "off"
          ? [fauxText(buildLocalWritingResponse(input))]
          : [
              fauxThinking(buildLocalThinking(input)),
              fauxText(buildLocalWritingResponse(input))
            ]
      )
    ],
    build: (context) => {
      const tools = buildRunTools(input, {
        model: context.model,
        thinkingLevel: context.thinkingLevel,
        streamFn: context.spawnStreamFn,
        parentRuntime: context.runtime,
        parentSignal: context.parentSignal,
        requestUserInput: context.requestUserInput,
        portableToolSchemaProfile,
        toolExecutionHooks: options.toolExecutionHooks,
        ...(options.retryPolicy ? { retryPolicy: options.retryPolicy } : {}),
        ...(options.subagentTimeoutMs === undefined
          ? {}
          : { subagentTimeoutMs: options.subagentTimeoutMs }),
        getParentMessages: context.getParentMessages,
        onContextCompacted: context.onContextCompacted,
        onWriteApprovalSettled: context.onWriteApprovalSettled
      });
      return {
        systemPrompt: [
          buildEffectiveSystemPrompt(
            options.basePrompt,
            input,
            tools.map((tool) => tool.name)
          ),
          libraryManagementParentPrompt(input),
          teamManagementParentPrompt(input),
          input.longAgentProfile && input.workspaceContext?.longWorkspace
            ? buildLongRuntimeToolBoundary(tools, input.promptLocale)
            : "",
          input.longAgentProfile && input.workspaceContext?.longWorkspace
            ? buildLongCoCreationBoundary(
                input.coCreationMode,
                input.promptLocale
              )
            : ""
        ]
          .filter(Boolean)
          .join("\n\n"),
        tools
      };
    },
    ...(contextPolicy ? { contextPolicy } : {}),
    rawUserMessageContent: () => buildRawUserMessage(input).content,
    ...(input.longAgentProfile &&
    input.workspaceContext?.longWorkspace &&
    input.longCommandExecutor
      ? {
          prepareRunContext: async ({
            firstTurn,
            signal,
            budgetTokens
          }: {
            firstTurn: boolean;
            signal: AbortSignal;
            budgetTokens?: number;
          }) => {
            const baseContent = firstTurn
              ? buildRuntimeUserMessageContent(input)
              : longAgentRefreshesDesignContextOnLaterTurns(
                    input.longAgentProfile?.id
                  )
                ? buildLongFollowUpTurnUserMessageContent(input)
                : buildFollowUpRawUserMessageContent(input);
            try {
              const assembled = await assembleLongChapterEvidence(input, {
                signal,
                ...(budgetTokens !== undefined ? { budgetTokens } : {})
              });
              if (!assembled) return undefined;
              return {
                userMessageContent: attachChapterEvidence(
                  baseContent,
                  assembled.text
                ),
                refreshFirstTurnContent: () =>
                  attachChapterEvidence(
                    buildRuntimeUserMessageContent(input),
                    assembled.text
                  ),
                ...(assembled.chapterCardId
                  ? { chapterSnapshotId: assembled.chapterCardId }
                  : {})
              };
            } catch (error) {
              if (signal.aborted) throw error;
              // Degrade gracefully to the standard on-demand flow when prefetch
              // times out or fails, disclosing the gap to the model.
              return {
                userMessageContent: attachChapterEvidence(
                  baseContent,
                  "【本轮单章取证提示】自动取证因超时或读取失败未完成，请按需使用 read 工具读取目标章卡与前情正文后再写作。"
                )
              };
            }
          }
        }
      : {}),
    // Writing runs refresh navigation and AGENTS.md in the system prompt.
    userMessageContent: (firstTurn) =>
      firstTurn ||
      (input.agentProfile && shortWorkspace) ||
      (input.scriptAgentProfile && scriptWorkspace) ||
      (input.academicAgentProfile && academicWorkspace)
        ? buildRuntimeUserMessageContent(input)
        : longAgentRefreshesDesignContextOnLaterTurns(
              input.longAgentProfile?.id
            ) && input.workspaceContext?.longWorkspace
          ? buildLongFollowUpTurnUserMessageContent(input)
          : input.mysteryAgentProfile &&
              input.workspaceContext?.mysteryWorkspace
            ? buildMysteryFollowUpTurnUserMessageContent(input)
            : buildFollowUpRawUserMessageContent(input)
  };
}
