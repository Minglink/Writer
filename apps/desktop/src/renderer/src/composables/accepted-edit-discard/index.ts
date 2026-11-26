import { createShortWorkspaceContentRevision } from "@writer/contracts/renderer";
import { getActivePinia } from "pinia";
import { formatError, getErrorPayload } from "../../i18n/errors";
import { createScopedTranslator, registerFeatureMessages } from "../../i18n";
import { useLongWorkspaceStore } from "../../stores/longWorkspaceStore";
import type { AgentEditProposal } from "../../types/conversation";
import { resolveLongWorkspaceApi } from "../../types/longWorkspace";
import {
  AcceptedEditDiscardConflictError,
  agentProposalSupportsDiscard,
  discardStatePatch
} from "../../utils/acceptedEditDiscard";
import type { AgentConversationController } from "../useAgentConversation";
import type {
  AgentEditReviewRequest,
  ProposalCoordinatorContext
} from "../proposal-coordinator/types";
import { discardAcceptedLongEdit, isLongRestoreConflict } from "./long";
import {
  discardAcceptedCatalogTextEdit,
  discardAcceptedShortStructureEdit
} from "./short";

const t = createScopedTranslator("workspace.index");
const discardT = registerFeatureMessages("workspace.agentsMdDiscard", {
  "zh-CN": {
    missingPreviousAgentsMd: "缺少上一版作品上下文内容，无法撤销本次修改。",
    serviceUnavailable: "桌面文件服务当前不可用。",
    agentsMdHasNewerChanges:
      "作品上下文已有后续修改，已保留当前内容，未撤销本次修改。"
  },
  "en-US": {
    missingPreviousAgentsMd:
      "The previous project context is missing; this edit cannot be undone.",
    serviceUnavailable: "The desktop file service is currently unavailable.",
    agentsMdHasNewerChanges:
      "The project context has newer changes; they were preserved and this edit was not undone."
  }
});

async function discardAcceptedAgentsMdEdit(
  context: ProposalCoordinatorContext,
  proposal: AgentEditProposal,
  agentWrittenRevisions?: Map<string, string>
): Promise<boolean> {
  const target = proposal.agentsMdTarget;
  if (!target) return false;
  const beforeText = proposal.discardSnapshot?.beforeText;
  const proposedRevision = proposal.proposedRevision;
  if (beforeText === undefined || !proposedRevision) {
    throw new Error(discardT("missingPreviousAgentsMd"));
  }
  const { workspaceType, bookId } = target;
  if (workspaceType === "long") {
    const longApi = context.api()?.long ?? resolveLongWorkspaceApi();
    if (!longApi) throw new Error(discardT("serviceUnavailable"));
    const live = await longApi.readAgentsMd({ bookId });
    if (
      live.truncated ||
      createShortWorkspaceContentRevision(live.content) !== proposedRevision
    ) {
      throw new AcceptedEditDiscardConflictError(
        discardT("agentsMdHasNewerChanges")
      );
    }
    await longApi.writeAgentsMd({
      bookId,
      content: beforeText,
      expectedRevision: proposedRevision
    });
    agentWrittenRevisions?.set(
      `${bookId}:AGENTS.md`,
      createShortWorkspaceContentRevision(beforeText)
    );
    const pinia = getActivePinia();
    if (pinia) {
      const longWorkspace = useLongWorkspaceStore(pinia);
      if (
        longWorkspace.activeBookId === bookId ||
        longWorkspace.workspaceIndex?.bookId === bookId
      ) {
        longWorkspace.structureAgentsMd = beforeText;
      }
    }
    return true;
  }
  const catalogApi = context.api()?.catalog;
  if (!catalogApi) throw new Error(discardT("serviceUnavailable"));
  const live = await catalogApi.readWritingContext({ bookId });
  if (
    live.truncated ||
    createShortWorkspaceContentRevision(live.content) !== proposedRevision
  ) {
    throw new AcceptedEditDiscardConflictError(
      discardT("agentsMdHasNewerChanges")
    );
  }
  await catalogApi.writeWritingContext({
    bookId,
    content: beforeText,
    expectedRevision: proposedRevision
  });
  agentWrittenRevisions?.set(
    `${bookId}:AGENTS.md`,
    createShortWorkspaceContentRevision(beforeText)
  );
  return true;
}

function updateDiscardState(
  conversation: AgentConversationController,
  proposal: AgentEditProposal,
  status: NonNullable<AgentEditProposal["discardState"]>["status"],
  message: string
): void {
  const state = discardStatePatch(status, message);
  conversation.updateEditProposal(proposal.runId, proposal.id, {
    discardState: state,
    updatedAt: state.updatedAt
  });
}

function conflictDependentProposals(
  conversation: AgentConversationController,
  proposal: AgentEditProposal
): void {
  for (const candidate of conversation.listEditProposals(proposal.runId)) {
    if (
      candidate.predecessorProposalId !== proposal.id ||
      (candidate.status !== "pending" && candidate.status !== "error")
    ) {
      continue;
    }
    conversation.updateEditProposal(candidate.runId, candidate.id, {
      status: "conflict",
      proposedText: undefined,
      statusMessage: t("thePreviousEditWasDiscardedRegenerateThisEditUsing")
    });
  }
}

export function createAcceptedEditDiscardCoordinator(
  context: ProposalCoordinatorContext,
  options?: { agentWrittenRevisions?: Map<string, string> }
) {
  async function discardProposal(
    conversation: AgentConversationController,
    request: Omit<AgentEditReviewRequest, "decision">
  ): Promise<void> {
    const proposal = conversation.getEditProposal(
      request.runId,
      request.proposalId
    );
    if (
      !proposal ||
      !agentProposalSupportsDiscard(proposal) ||
      proposal.discardState?.status === "discarding"
    ) {
      return;
    }
    if (context.editor.acceptingWorkspaceIds.value.has(proposal.workspaceId)) {
      context.notifications.info(t("otherEditsToThisProjectAreBeingSavedWait"));
      return;
    }
    updateDiscardState(
      conversation,
      proposal,
      "discarding",
      t("discardingThisEdit")
    );
    context.editor.setWorkspaceAccepting(proposal.workspaceId, true);
    try {
      if (
        !(await discardAcceptedAgentsMdEdit(
          context,
          proposal,
          options?.agentWrittenRevisions
        )) &&
        !(await discardAcceptedLongEdit(context, proposal)) &&
        !(await discardAcceptedShortStructureEdit(context, proposal))
      ) {
        await discardAcceptedCatalogTextEdit(context, proposal);
      }
      updateDiscardState(
        conversation,
        proposal,
        "discarded",
        t("editDiscardedThePreviousContentHasBeenRestored")
      );
      conflictDependentProposals(conversation, proposal);
      context.notifications.success(t("editDiscarded"));
    } catch (error: unknown) {
      const longDocumentConflict =
        getErrorPayload(error)?.code === "long.document_conflict";
      const conflict =
        error instanceof AcceptedEditDiscardConflictError ||
        isLongRestoreConflict(error) ||
        longDocumentConflict ||
        context.catalog.isConflict(error);
      const message = formatError(
        error,
        longDocumentConflict
          ? discardT("agentsMdHasNewerChanges")
          : t("failedToDiscardThisEdit")
      );
      updateDiscardState(
        conversation,
        proposal,
        conflict ? "conflict" : "error",
        message
      );
      if (conflict) context.notifications.warning(message);
      else context.notifications.error(message);
    } finally {
      context.editor.setWorkspaceAccepting(proposal.workspaceId, false);
    }
  }

  return {
    /** A card may live in the short or the long conversation; undo it there. */
    discardAgentEdit: (request: Omit<AgentEditReviewRequest, "decision">) => {
      const owner = [
        context.conversations.active.value,
        context.conversations.activeLong.value
      ].find((conversation) =>
        conversation?.getEditProposal(request.runId, request.proposalId)
      );
      return discardProposal(
        owner ?? context.conversations.active.value,
        request
      );
    }
  };
}
