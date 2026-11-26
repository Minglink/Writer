import {
  LONG_AGENTS_MD_MAX_CHARACTERS,
  WRITING_CONTEXT_MAX_CHARACTERS,
  createShortWorkspaceContentRevision,
  longAgentsMdCharacterCount,
  writingContextCharacterCount,
  type SystemEventEnvelope
} from "@writer/contracts/renderer";
import { getActivePinia } from "pinia";
import { locale, registerFeatureMessages } from "../../i18n";
import { formatError, getErrorPayload } from "../../i18n/errors";
import { useLongWorkspaceStore } from "../../stores/longWorkspaceStore";
import type {
  AgentApprovalMode,
  AgentEditProposal
} from "../../types/conversation";
import { resolveLongWorkspaceApi } from "../../types/longWorkspace";
import { textEditDiscardSnapshot } from "../../utils/acceptedEditDiscard";
import {
  agentEditProposalGenerationId,
  agentEditProposalId,
  resolveAgentEditProposalGeneration
} from "../../utils/agentEditReview";
import { buildAgentTextDiff } from "../../utils/agentTextDiff";
import type { AgentConversationController } from "../useAgentConversation";
import type { ProposalCoordinatorContext } from "../useProposalCoordinator";
import {
  isLongProposalConversationActive,
  isShortProposalConversationActive
} from "./event-authorization";
import {
  resolveTextProposalAcceptBase,
  resolvedStaleBase,
  stagedStaleBase,
  staleRevisionAfterConflict
} from "./stale-base";

type WorkspaceEditorMutationEvent = Extract<
  SystemEventEnvelope,
  { type: "workspace.editor_mutation" }
>;
type LongPlotDesignMutationEvent = Extract<
  SystemEventEnvelope,
  { type: "long.mutation_proposal" }
>;

const agentsMdT = registerFeatureMessages("workspace.agentsMdLane", {
  "zh-CN": {
    shortContextTitle: "短篇上下文（AGENTS.md）",
    scriptContextTitle: "剧本上下文（AGENTS.md）",
    longContextTitle: "长篇上下文（AGENTS.md）",
    exceedsMaxCharacters: "作品上下文不能超过 {max} 个字符，请精简后再保存。",
    fileTruncatedCannotOverwrite:
      "作品上下文超出长度上限且被截断，未覆盖原文件。",
    missingProposedText: "待审阅的修改缺少完整新文本，请重新生成。",
    serviceUnavailable: "桌面文件服务当前不可用。",
    waitingForSave: "正在等待你的保存完成…",
    otherEditsSaving: "当前作品有其他修改正在保存，请稍候重试。",
    autoSavingContext: "正在自动批准并保存作品上下文…",
    savingContext: "正在保存作品上下文…",
    alreadySavedInContext:
      "该修改已写入作品上下文（AGENTS.md），无需重复保存。",
    alreadySavedToast: "作品上下文修改已保存在本地文件中",
    noChangesNeeded: "作品上下文没有变化，无需保存。",
    contextAutoAcceptedAndSaved: "已自动批准并保存作品上下文（AGENTS.md）。",
    contextAcceptedAndSaved: "已接受并保存作品上下文（AGENTS.md）。",
    contextAcceptedAndSavedToast: "已接受并保存作品上下文",
    failedToSaveContext: "保存作品上下文失败，原内容保持不变。"
  },
  "en-US": {
    shortContextTitle: "Short-Fiction Context (AGENTS.md)",
    scriptContextTitle: "Screenplay Context (AGENTS.md)",
    longContextTitle: "Long-Form Context (AGENTS.md)",
    exceedsMaxCharacters:
      "Project context cannot exceed {max} characters. Shorten it before saving.",
    fileTruncatedCannotOverwrite:
      "The project context exceeds the length limit and was truncated; the file was not overwritten.",
    missingProposedText:
      "The pending change is missing the complete revised text. Regenerate it.",
    serviceUnavailable: "The desktop file service is currently unavailable.",
    waitingForSave: "Waiting for your save to finish…",
    otherEditsSaving:
      "Other edits to this project are being saved. Wait a moment and try again.",
    autoSavingContext: "Automatically approving and saving project context…",
    savingContext: "Saving project context…",
    alreadySavedInContext:
      "These edits are already in AGENTS.md; no further save is needed.",
    alreadySavedToast: "The project context edits are already saved locally.",
    noChangesNeeded: "The project context has not changed; no save is needed.",
    contextAutoAcceptedAndSaved:
      "Automatically approved and saved project context (AGENTS.md).",
    contextAcceptedAndSaved: "Accepted and saved project context (AGENTS.md).",
    contextAcceptedAndSavedToast: "Project context accepted and saved.",
    failedToSaveContext:
      "Could not save project context; the original content is unchanged."
  }
});

function syncLongStructureAgentsMd(bookId: string, content: string): void {
  const pinia = getActivePinia();
  if (!pinia) return;
  const longWorkspace = useLongWorkspaceStore(pinia);
  if (
    longWorkspace.activeBookId === bookId ||
    longWorkspace.workspaceIndex?.bookId === bookId
  ) {
    longWorkspace.structureAgentsMd = content;
  }
}

export interface AgentsMdProposalLaneDeps {
  agentWrittenRevisions: Map<string, string>;
  isDisposed(): boolean;
  latestProposalForLane(
    conversation: AgentConversationController,
    runId: string,
    laneId: string
  ): AgentEditProposal | undefined;
  blockedAgentEditLaneMessage(
    proposal: AgentEditProposal | undefined
  ): string | undefined;
  notifyAutomaticEditPaused(
    existing: AgentEditProposal | undefined,
    runApprovalMode: AgentApprovalMode,
    title: string
  ): void;
  holdStaleTextProposal(
    conversation: AgentConversationController,
    runId: string,
    proposal: AgentEditProposal,
    liveContent: string | undefined,
    currentRevision: string
  ): void;
  queueAgentEdit(
    conversation: AgentConversationController,
    sessionId: string,
    runId: string,
    proposalId: string,
    automatic: boolean,
    scheduleImmediately: boolean
  ): void;
}

export function createAgentsMdProposalLane(
  context: ProposalCoordinatorContext,
  deps: AgentsMdProposalLaneDeps
) {
  async function stageShortOrScript(
    event: WorkspaceEditorMutationEvent,
    sourceConversation: AgentConversationController,
    runApprovalMode: AgentApprovalMode
  ): Promise<void> {
    const target = event.payload.mutationTarget;
    if (target?.kind !== "agents-md") return;
    const workspaceId = event.payload.workspaceId;
    const catalogApi = context.api()?.catalog;
    let liveContent = target.beforeText;
    if (catalogApi?.readWritingContext) {
      try {
        const readResult = await catalogApi.readWritingContext({
          bookId: workspaceId
        });
        liveContent = readResult.content;
      } catch {
        liveContent = target.beforeText;
      }
      if (
        deps.isDisposed() ||
        !isShortProposalConversationActive(
          context,
          sourceConversation,
          event.payload.sessionId
        )
      ) {
        return;
      }
    }

    const laneId = agentEditProposalId(
      event.payload.runId,
      workspaceId,
      "agents_md",
      "AGENTS.md"
    );
    const existing = deps.latestProposalForLane(
      sourceConversation,
      event.payload.runId,
      laneId
    );
    if (existing?.toolCallIds.includes(event.payload.toolCallId)) {
      return;
    }
    const blockedMessage = deps.blockedAgentEditLaneMessage(existing);
    if (blockedMessage) {
      sourceConversation.markToolConflict(
        event.payload.runId,
        event.payload.toolCallId,
        blockedMessage
      );
      return;
    }

    const identity = resolveAgentEditProposalGeneration(laneId, existing);
    const title =
      target.workspaceType === "script"
        ? agentsMdT("scriptContextTitle")
        : agentsMdT("shortContextTitle");
    const afterText = target.afterText;
    const baseRevision = identity.coalescesExisting
      ? (existing!.baseRevision ?? event.payload.baseRevision)
      : (existing?.proposedRevision ?? event.payload.baseRevision);
    const proposedRevision = createShortWorkspaceContentRevision(afterText);
    const awaitsPredecessor = Boolean(
      existing && !identity.coalescesExisting && existing.status !== "accepted"
    );
    const staleBase = awaitsPredecessor
      ? undefined
      : stagedStaleBase(
          existing,
          liveContent,
          baseRevision,
          event.timestamp,
          deps.agentWrittenRevisions.get(`${workspaceId}:AGENTS.md`)
        );
    const noChanges =
      !staleBase &&
      afterText === liveContent &&
      (!existing ||
        existing.status === "accepted" ||
        identity.coalescesExisting);
    const beforeText =
      existing && identity.coalescesExisting && existing.agentsMdTarget
        ? existing.agentsMdTarget.beforeText
        : target.beforeText;
    const diffBaseText = staleBase ? liveContent : beforeText;
    const diff = buildAgentTextDiff(diffBaseText, afterText);
    const proposal: AgentEditProposal = {
      id: identity.id,
      laneId,
      generation: identity.generation,
      approvalMode: staleBase ? "request-approval" : runApprovalMode,
      ...(staleBase ? { staleBase } : {}),
      sourceBaseRevision: event.payload.baseRevision,
      ...(identity.predecessorProposalId
        ? { predecessorProposalId: identity.predecessorProposalId }
        : {}),
      runId: event.payload.runId,
      workspaceId,
      stageId: "agents_md",
      documentId: "AGENTS.md",
      title,
      summary: event.payload.summary,
      status: noChanges ? "accepted" : "pending",
      baseRevision,
      proposedRevision,
      ...(noChanges ? {} : { proposedText: afterText }),
      toolCallIds: [
        ...new Set([
          ...(identity.coalescesExisting ? (existing?.toolCallIds ?? []) : []),
          event.payload.toolCallId
        ])
      ],
      additions: diff.additions,
      deletions: diff.deletions,
      hunks: diff.hunks,
      ...(diff.truncated ? { truncated: true } : {}),
      ...(noChanges ? { statusMessage: agentsMdT("noChangesNeeded") } : {}),
      createdAt:
        identity.coalescesExisting && existing
          ? existing.createdAt
          : event.timestamp,
      updatedAt: event.timestamp,
      discardSnapshot: textEditDiscardSnapshot(
        existing,
        identity.coalescesExisting,
        liveContent,
        title
      ),
      agentsMdTarget: {
        workspaceType: target.workspaceType,
        bookId: workspaceId,
        beforeText,
        expectedRevision: target.expectedRevision ?? event.payload.baseRevision
      }
    };
    sourceConversation.upsertEditProposal(event.payload.runId, proposal);
    if (staleBase) {
      deps.notifyAutomaticEditPaused(existing, runApprovalMode, title);
    } else if (!noChanges && runApprovalMode === "auto-approve") {
      deps.queueAgentEdit(
        sourceConversation,
        event.payload.sessionId,
        event.payload.runId,
        proposal.id,
        true,
        true
      );
    }
  }

  async function stageLong(
    event: LongPlotDesignMutationEvent,
    sourceConversation: AgentConversationController,
    runApprovalMode: AgentApprovalMode
  ): Promise<void> {
    const review = event.payload.review;
    const content = review?.content;
    if (review?.targetKind !== "agents_md" || !content) return;
    const bookId = event.payload.bookId;
    const workspaceId = `long:${bookId}`;
    const longApi = context.api()?.long ?? resolveLongWorkspaceApi();
    let liveContent = content.beforeText;
    if (longApi?.readAgentsMd) {
      try {
        const readResult = await longApi.readAgentsMd({ bookId });
        liveContent = readResult.content;
      } catch {
        liveContent = content.beforeText;
      }
      if (
        deps.isDisposed() ||
        !isLongProposalConversationActive(
          context,
          sourceConversation,
          bookId,
          event.payload.sessionId
        )
      ) {
        return;
      }
    }

    const laneId = agentEditProposalId(
      event.payload.runId,
      bookId,
      "agents_md",
      "AGENTS.md"
    );
    const existing = deps.latestProposalForLane(
      sourceConversation,
      event.payload.runId,
      laneId
    );
    if (existing?.toolCallIds.includes(event.payload.toolCallId)) {
      return;
    }
    const blockedMessage = deps.blockedAgentEditLaneMessage(existing);
    if (blockedMessage) {
      sourceConversation.markToolConflict(
        event.payload.runId,
        event.payload.toolCallId,
        blockedMessage
      );
      return;
    }

    const generation = existing ? (existing.generation ?? 1) + 1 : 1;
    const proposalId = agentEditProposalGenerationId(laneId, generation);
    const title = agentsMdT("longContextTitle");
    const baseRevision =
      content.baseRevision ??
      createShortWorkspaceContentRevision(content.beforeText);
    const proposedRevision = createShortWorkspaceContentRevision(
      content.afterText
    );
    const awaitsPredecessor = Boolean(
      existing && existing.status !== "accepted"
    );
    const staleBase = awaitsPredecessor
      ? undefined
      : stagedStaleBase(
          existing,
          liveContent,
          baseRevision,
          event.timestamp,
          deps.agentWrittenRevisions.get(`${bookId}:AGENTS.md`)
        );
    const noChanges =
      !staleBase &&
      content.afterText === liveContent &&
      (!existing || existing.status === "accepted");
    const diff = buildAgentTextDiff(
      staleBase ? liveContent : content.beforeText,
      content.afterText
    );
    const proposal: AgentEditProposal = {
      id: proposalId,
      laneId,
      generation,
      approvalMode: staleBase ? "request-approval" : runApprovalMode,
      ...(staleBase ? { staleBase } : {}),
      sourceBaseRevision: baseRevision,
      ...(existing ? { predecessorProposalId: existing.id } : {}),
      runId: event.payload.runId,
      workspaceId,
      stageId: "agents_md",
      documentId: "AGENTS.md",
      title,
      summary: event.payload.summary,
      status: noChanges ? "accepted" : "pending",
      baseRevision,
      proposedRevision,
      ...(noChanges ? {} : { proposedText: content.afterText }),
      toolCallIds: [event.payload.toolCallId],
      additions: diff.additions,
      deletions: diff.deletions,
      hunks: diff.hunks,
      ...(diff.truncated ? { truncated: true } : {}),
      ...(noChanges ? { statusMessage: agentsMdT("noChangesNeeded") } : {}),
      createdAt: event.timestamp,
      updatedAt: event.timestamp,
      discardSnapshot: { beforeText: liveContent },
      agentsMdTarget: {
        workspaceType: "long",
        bookId,
        beforeText: content.beforeText,
        expectedRevision: baseRevision
      }
    };
    sourceConversation.upsertEditProposal(event.payload.runId, proposal);
    if (staleBase) {
      deps.notifyAutomaticEditPaused(existing, runApprovalMode, title);
    } else if (!noChanges && runApprovalMode === "auto-approve") {
      deps.queueAgentEdit(
        sourceConversation,
        event.payload.sessionId,
        event.payload.runId,
        proposalId,
        true,
        true
      );
    }
  }

  async function accept(
    conversation: AgentConversationController,
    request: { runId: string; proposalId: string },
    proposal: AgentEditProposal,
    automatic: boolean,
    reserved = false
  ): Promise<void> {
    const target = proposal.agentsMdTarget;
    if (!target) return;
    if (
      (proposal.status === "accepting" && !reserved) ||
      proposal.status === "accepted" ||
      proposal.status === "rejected" ||
      proposal.status === "conflict"
    ) {
      return;
    }
    if (typeof proposal.proposedText !== "string") {
      const message = agentsMdT("missingProposedText");
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "error",
        statusMessage: message
      });
      context.notifications.error(message);
      return;
    }

    const proposedText = proposal.proposedText;
    const { workspaceType, bookId } = target;
    const maxCharacters =
      workspaceType === "long"
        ? LONG_AGENTS_MD_MAX_CHARACTERS
        : WRITING_CONTEXT_MAX_CHARACTERS;
    const charCount =
      workspaceType === "long"
        ? longAgentsMdCharacterCount(proposedText)
        : writingContextCharacterCount(proposedText);
    if (charCount > maxCharacters) {
      const message = agentsMdT("exceedsMaxCharacters", {
        max: maxCharacters.toLocaleString(locale.value)
      });
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "error",
        statusMessage: message
      });
      context.notifications.error(message);
      return;
    }

    const catalogApi = context.api()?.catalog;
    const longApi =
      workspaceType === "long"
        ? (context.api()?.long ?? resolveLongWorkspaceApi())
        : undefined;
    if (workspaceType === "long" ? !longApi : !catalogApi) {
      const message = agentsMdT("serviceUnavailable");
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "error",
        statusMessage: message
      });
      context.notifications.error(message);
      return;
    }

    if (context.editor.acceptingWorkspaceIds.value.has(proposal.workspaceId)) {
      const message = automatic
        ? agentsMdT("waitingForSave")
        : agentsMdT("otherEditsSaving");
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "pending",
        statusMessage: message
      });
      if (!automatic) {
        context.notifications.info(message);
      }
      return;
    }

    context.editor.setWorkspaceAccepting(proposal.workspaceId, true);
    try {
      const live =
        workspaceType === "long"
          ? await longApi!.readAgentsMd({ bookId })
          : await catalogApi!.readWritingContext({ bookId });
      if (live.truncated) {
        const message = agentsMdT("fileTruncatedCannotOverwrite");
        conversation.updateEditProposal(request.runId, request.proposalId, {
          status: "error",
          statusMessage: message
        });
        context.notifications.error(message);
        return;
      }

      const nextProposedRevision =
        createShortWorkspaceContentRevision(proposedText);
      if (live.content === proposedText) {
        if (workspaceType === "long") {
          syncLongStructureAgentsMd(bookId, proposedText);
        }
        conversation.updateEditProposal(request.runId, request.proposalId, {
          status: "accepted",
          proposedText: undefined,
          proposedRevision: nextProposedRevision,
          statusMessage: agentsMdT("alreadySavedInContext")
        });
        if (!automatic) {
          context.notifications.success(agentsMdT("alreadySavedToast"));
        }
        return;
      }

      const acceptBase = resolveTextProposalAcceptBase(
        proposal,
        live.content,
        deps.agentWrittenRevisions.get(`${bookId}:AGENTS.md`)
      );
      if (acceptBase.kind === "stale") {
        deps.holdStaleTextProposal(
          conversation,
          request.runId,
          proposal,
          live.content,
          acceptBase.currentRevision
        );
        return;
      }

      const expectedRevision =
        live.revision ?? createShortWorkspaceContentRevision(live.content);
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "accepting",
        statusMessage: automatic
          ? agentsMdT("autoSavingContext")
          : agentsMdT("savingContext")
      });

      if (workspaceType === "long") {
        await longApi!.writeAgentsMd({
          bookId,
          content: proposedText,
          expectedRevision
        });
        syncLongStructureAgentsMd(bookId, proposedText);
      } else {
        await catalogApi!.writeWritingContext({
          bookId,
          content: proposedText,
          expectedRevision
        });
      }

      deps.agentWrittenRevisions.set(
        `${bookId}:AGENTS.md`,
        nextProposedRevision
      );
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "accepted",
        proposedText: undefined,
        proposedRevision: nextProposedRevision,
        discardSnapshot: { beforeText: live.content },
        ...(acceptBase.overwrite
          ? resolvedStaleBase(proposal, "overwrote")
          : {}),
        statusMessage: automatic
          ? agentsMdT("contextAutoAcceptedAndSaved")
          : agentsMdT("contextAcceptedAndSaved")
      });
      if (!automatic) {
        context.notifications.success(
          agentsMdT("contextAcceptedAndSavedToast")
        );
      }
    } catch (error: unknown) {
      const conflict =
        context.catalog.isConflict(error) ||
        getErrorPayload(error)?.code === "long.document_conflict";
      if (conflict) {
        const fresh = await (
          workspaceType === "long"
            ? longApi!.readAgentsMd({ bookId })
            : catalogApi!.readWritingContext({ bookId })
        ).catch(() => undefined);
        const freshContent = fresh?.content;
        deps.holdStaleTextProposal(
          conversation,
          request.runId,
          proposal,
          freshContent,
          staleRevisionAfterConflict(error, freshContent, proposal)
        );
        return;
      }
      const message = formatError(error, agentsMdT("failedToSaveContext"));
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "error",
        statusMessage: message
      });
      context.notifications.error(message);
    } finally {
      context.editor.setWorkspaceAccepting(proposal.workspaceId, false);
    }
  }

  return {
    stageShortOrScript,
    stageLong,
    accept
  };
}
