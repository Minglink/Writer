import { createPinia, setActivePinia } from "pinia";
import { computed, createSSRApp, h, ref, shallowRef } from "vue";
import { renderToString } from "vue/server-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createEnvelope,
  createShortWorkspaceContentRevision as revision,
  type Book,
  type LongMutationProposalEventEnvelope,
  type WorkspaceEditorMutationEventEnvelope
} from "@writer/contracts/renderer";
import AgentEditProposalCard from "../components/AgentEditProposalCard.vue";
import { useLongWorkspaceStore } from "../stores/longWorkspaceStore";
import type {
  AgentApprovalMode,
  AgentEditProposal
} from "../types/conversation";
import { agentProposalSupportsDiscard } from "../utils/acceptedEditDiscard";
import { proposalEditBaseText } from "../utils/agentProposalEdit";
import { buildAgentTextDiff } from "../utils/agentTextDiff";
import { parseStoredEditProposal } from "./agent-conversation/parse-proposal";
import type { AgentConversationController } from "./useAgentConversation";
import {
  useProposalCoordinator,
  type ProposalCoordinatorContext
} from "./useProposalCoordinator";

const NOW = "2026-11-25T10:00:00.000Z";
const SESSION_ID = "session-agents-md";
const RUN_ID = "run-agents-md";
const SHORT_BOOK_ID = "book-agents-md";
const LONG_BOOK_ID = "longbook_agents_md";

const runtime = {
  provider: "example-provider",
  model: "example-model",
  mode: "provider" as const
};

function createConversationHarness(approvalMode: AgentApprovalMode) {
  const proposals = new Map<string, AgentEditProposal>();
  const messages = ref<{ editProposals: AgentEditProposal[] }[]>([]);
  const syncMessages = () => {
    messages.value = [{ editProposals: [...proposals.values()] }];
  };
  const markToolConflict = vi.fn();
  const conversation = {
    sessionId: ref(SESSION_ID),
    isBusy: ref(false),
    messages,
    acceptsRunEvent: (sessionId: string, runId: string) =>
      sessionId === SESSION_ID && runId === RUN_ID,
    approvalModeForRun: () => approvalMode,
    markToolConflict,
    getEditProposal: (runId: string, proposalId: string) => {
      const proposal = proposals.get(proposalId);
      return proposal?.runId === runId ? proposal : undefined;
    },
    listEditProposals: (runId: string) =>
      [...proposals.values()].filter((proposal) => proposal.runId === runId),
    upsertEditProposal: (runId: string, proposal: AgentEditProposal) => {
      if (proposal.runId === runId) proposals.set(proposal.id, proposal);
      syncMessages();
      return proposal;
    },
    updateEditProposal: (
      runId: string,
      proposalId: string,
      patch: Partial<AgentEditProposal>
    ) => {
      const proposal = proposals.get(proposalId);
      if (!proposal || proposal.runId !== runId) return undefined;
      const updated = { ...proposal, ...patch };
      proposals.set(proposalId, updated);
      syncMessages();
      return updated;
    }
  } as unknown as AgentConversationController;

  return { conversation, markToolConflict };
}

function createAgentsMdTestFixture(
  options: {
    workspaceType?: "short" | "script";
    approvalMode?: AgentApprovalMode;
    initialShortContext?: string;
    initialLongContext?: string;
  } = {}
) {
  const workspaceType = options.workspaceType ?? "short";
  const approvalMode = options.approvalMode ?? "request-approval";
  let shortContext = options.initialShortContext ?? "# 初始上下文\n第一条约束";
  let longContext =
    options.initialLongContext ?? "# 长篇初始上下文\n保持冷峻克制叙事";

  const shortHarness = createConversationHarness(approvalMode);
  const longHarness = createConversationHarness(approvalMode);

  const readWritingContext = vi.fn(async ({ bookId }: { bookId: string }) => ({
    bookId,
    workspaceType,
    content: shortContext,
    truncated: false,
    revision: revision(shortContext)
  }));
  const writeWritingContext = vi.fn(
    async ({
      bookId,
      content,
      expectedRevision
    }: {
      bookId: string;
      content: string;
      expectedRevision?: string;
    }) => {
      const actualRevision = revision(shortContext);
      if (
        expectedRevision !== undefined &&
        expectedRevision !== actualRevision
      ) {
        throw {
          code: "catalog.conflict",
          message: "conflict",
          details: { expectedRevision, actualRevision }
        };
      }
      shortContext = content;
      return {
        bookId,
        workspaceType,
        revision: revision(content)
      };
    }
  );

  const readAgentsMd = vi.fn(async ({ bookId }: { bookId: string }) => ({
    bookId,
    content: longContext,
    truncated: false,
    revision: revision(longContext)
  }));
  const writeAgentsMd = vi.fn(
    async ({
      bookId,
      content,
      expectedRevision
    }: {
      bookId: string;
      content: string;
      expectedRevision?: string;
    }) => {
      const actualRevision = revision(longContext);
      if (
        expectedRevision !== undefined &&
        expectedRevision !== actualRevision
      ) {
        throw {
          code: "long.document_conflict",
          message: "长篇上下文已被修改，请刷新后重试。"
        };
      }
      longContext = content;
      return {
        bookId,
        revision: revision(content)
      };
    }
  );
  const previewOperations = vi.fn();
  const applyOperations = vi.fn();

  const book = {
    id: SHORT_BOOK_ID,
    title: "上下文测试作品",
    bookType: workspaceType,
    projectRevision: 1
  } as unknown as Book;

  const acceptingWorkspaceIds = ref(new Set<string>());
  const seenEvents = new Set<string>();
  const notifications = {
    error: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
    warning: vi.fn()
  };

  const context = {
    api: () => ({
      catalog: {
        readWritingContext,
        writeWritingContext
      },
      long: {
        readAgentsMd,
        writeAgentsMd,
        previewOperations,
        applyOperations
      }
    }),
    notifications,
    catalog: {
      snapshot: shallowRef({} as never),
      projection: shallowRef(null),
      catalogBook: (bookId: string) =>
        bookId === SHORT_BOOK_ID ? book : undefined,
      findCatalogLibrary: () => undefined,
      loadSnapshot: vi.fn(async () => undefined),
      ensureDocumentLoaded: vi.fn(),
      applyAcceptedDocumentLocally: vi.fn(),
      applyCreatedLibraryEntry: vi.fn(async () => undefined),
      applySavedLibraryEntry: vi.fn(async () => undefined),
      applyUpdatedLibrary: vi.fn(async () => undefined),
      isConflict: (error: unknown) =>
        (error as { code?: unknown } | undefined)?.code === "catalog.conflict",
      refreshBookAfterSave: vi.fn(async () => true)
    },
    editor: {
      documents: shallowRef([]),
      drafts: ref({}),
      liveDocuments: computed(() => []),
      selectedDraftFileKinds: ref({}),
      selectedExpertSectionIds: ref({}),
      acceptingWorkspaceIds,
      savingDocumentIds: ref(new Set<string>()),
      rememberWorkspaceMutationEvent: (eventId: string) => {
        if (seenEvents.has(eventId)) return false;
        seenEvents.add(eventId);
        return true;
      },
      setDocumentAccepting: vi.fn(),
      setWorkspaceAccepting: (workspaceId: string, accepting: boolean) => {
        const next = new Set(acceptingWorkspaceIds.value);
        if (accepting) next.add(workspaceId);
        else next.delete(workspaceId);
        acceptingWorkspaceIds.value = next;
      }
    },
    conversations: {
      active: computed(() => shortHarness.conversation),
      activeLong: computed(() => longHarness.conversation),
      byKey: new Map([[`long:${LONG_BOOK_ID}:long`, longHarness.conversation]]),
      all: () => [shortHarness.conversation, longHarness.conversation],
      remove: vi.fn(),
      legacyDraftSectionKeys: () => [],
      forLongProposal: (event: { payload: { bookId: string } }) =>
        event.payload.bookId === LONG_BOOK_ID
          ? longHarness.conversation
          : undefined
    },
    longWorkspace: {
      activeBookId: ref(LONG_BOOK_ID),
      books: shallowRef([]),
      refreshWorkspaceAfterProposal: vi.fn(async () => true),
      saveActiveEditorChanges: vi.fn(async () => true)
    },
    navigation: {
      selectedResourceId: ref(""),
      activeCreationResourceId: ref(""),
      rightCollapsed: ref(false)
    }
  } as unknown as ProposalCoordinatorContext;

  return {
    coordinator: useProposalCoordinator(context),
    shortConversation: shortHarness.conversation,
    longConversation: longHarness.conversation,
    shortMarkToolConflict: shortHarness.markToolConflict,
    longMarkToolConflict: longHarness.markToolConflict,
    readWritingContext,
    writeWritingContext,
    readAgentsMd,
    writeAgentsMd,
    previewOperations,
    applyOperations,
    notifications,
    getShortContext: () => shortContext,
    setShortContext: (next: string) => {
      shortContext = next;
    },
    getLongContext: () => longContext,
    setLongContext: (next: string) => {
      longContext = next;
    }
  };
}

function shortAgentsMdEvent(
  workspaceType: "short" | "script",
  toolCallId: string,
  beforeText: string,
  afterText: string,
  step: number,
  baseRevision = revision(beforeText)
): WorkspaceEditorMutationEventEnvelope {
  return createEnvelope(
    "workspace.editor_mutation",
    {
      sessionId: SESSION_ID,
      runId: RUN_ID,
      toolCallId,
      workspaceId: SHORT_BOOK_ID,
      stageId: "agents_md" as const,
      text: afterText,
      mutationTarget: {
        kind: "agents-md" as const,
        workspaceType,
        beforeText,
        afterText,
        expectedRevision: baseRevision
      },
      baseRevision,
      summary: `更新作品上下文 #${step}`,
      runtime
    },
    {
      id: `event-short-agents-md-${step}`,
      timestamp: `2026-11-25T10:00:0${step}.000Z`,
      context: {
        sessionId: SESSION_ID,
        runId: RUN_ID,
        resourceId: SHORT_BOOK_ID
      }
    }
  ) as WorkspaceEditorMutationEventEnvelope;
}

function longAgentsMdEvent(
  toolCallId: string,
  beforeText: string,
  afterText: string,
  step: number,
  baseRevision = revision(beforeText)
): LongMutationProposalEventEnvelope {
  return createEnvelope(
    "long.mutation_proposal",
    {
      sessionId: SESSION_ID,
      runId: RUN_ID,
      toolCallId,
      bookId: LONG_BOOK_ID,
      agentId: "long" as const,
      summary: `更新长篇上下文 #${step}`,
      runtime,
      batch: {
        updatedAt: NOW,
        operations: [],
        documentWrites: []
      },
      review: {
        targetKey: "doc:AGENTS.md",
        targetKind: "agents_md" as const,
        targetId: "AGENTS.md",
        action: "edit" as const,
        title: "长篇上下文（AGENTS.md）",
        content: {
          filePath: "AGENTS.md" as const,
          operation: "write" as const,
          beforeText,
          afterText,
          baseRevision
        }
      }
    },
    {
      id: `event-long-agents-md-${step}`,
      timestamp: `2026-11-25T10:00:0${step}.000Z`,
      context: {
        sessionId: SESSION_ID,
        runId: RUN_ID,
        resourceId: LONG_BOOK_ID
      }
    }
  ) as LongMutationProposalEventEnvelope;
}

describe("useProposalCoordinator agentsMdTarget lane", () => {
  let pinia = createPinia();

  beforeEach(() => {
    pinia = createPinia();
    setActivePinia(pinia);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    ["short", "短篇上下文（AGENTS.md）"],
    ["script", "剧本上下文（AGENTS.md）"]
  ] as const)(
    "stages, accepts, and undoes %s AGENTS.md proposals with CAS expectedRevision",
    async (workspaceType, expectedTitle) => {
      const beforeText = "# 初始上下文\n第一条约束";
      const afterText = "# 更新后上下文\n第一条约束\n第二条新增约束";
      const fixture = createAgentsMdTestFixture({
        workspaceType,
        initialShortContext: beforeText
      });
      try {
        await fixture.coordinator.stageAgentEditProposal(
          shortAgentsMdEvent(workspaceType, "tool-1", beforeText, afterText, 1)
        );
        await fixture.coordinator.drain();

        const [staged] = fixture.shortConversation.listEditProposals(RUN_ID);
        expect(staged).toMatchObject({
          stageId: "agents_md",
          documentId: "AGENTS.md",
          title: expectedTitle,
          status: "pending",
          baseRevision: revision(beforeText),
          proposedRevision: revision(afterText),
          proposedText: afterText,
          agentsMdTarget: {
            workspaceType,
            bookId: SHORT_BOOK_ID,
            beforeText,
            expectedRevision: revision(beforeText)
          }
        });
        expect(fixture.writeWritingContext).not.toHaveBeenCalled();

        await fixture.coordinator.reviewAgentEdit({
          runId: RUN_ID,
          proposalId: staged!.id,
          decision: "accept"
        });
        await fixture.coordinator.drain();

        expect(fixture.writeWritingContext).toHaveBeenCalledWith({
          bookId: SHORT_BOOK_ID,
          content: afterText,
          expectedRevision: revision(beforeText)
        });
        const accepted = fixture.shortConversation.getEditProposal(
          RUN_ID,
          staged!.id
        )!;
        expect(accepted).toMatchObject({
          status: "accepted",
          proposedRevision: revision(afterText),
          discardSnapshot: { beforeText }
        });
        expect(agentProposalSupportsDiscard(accepted)).toBe(true);

        await fixture.coordinator.discardAgentEdit({
          runId: RUN_ID,
          proposalId: accepted.id
        });
        await fixture.coordinator.drain();

        expect(fixture.writeWritingContext).toHaveBeenLastCalledWith({
          bookId: SHORT_BOOK_ID,
          content: beforeText,
          expectedRevision: revision(afterText)
        });
        expect(fixture.getShortContext()).toBe(beforeText);
        expect(
          fixture.shortConversation.getEditProposal(RUN_ID, accepted.id)
            ?.discardState?.status
        ).toBe("discarded");
      } finally {
        await fixture.coordinator.dispose();
      }
    }
  );

  it("stages, accepts, syncs useLongWorkspaceStore().structureAgentsMd, and undoes Long AGENTS.md proposals", async () => {
    const beforeText = "# 长篇初始上下文\n第一卷基调";
    const afterText = "# 长篇更新上下文\n第一卷基调\n主角行动底线";
    const longStore = useLongWorkspaceStore(pinia);
    longStore.activateBook(LONG_BOOK_ID);
    longStore.structureAgentsMd = beforeText;

    const fixture = createAgentsMdTestFixture({
      initialLongContext: beforeText
    });
    try {
      fixture.coordinator.stageLongPlotDesignEditProposal(
        longAgentsMdEvent("tool-long-1", beforeText, afterText, 1)
      );
      await fixture.coordinator.drain();

      const [staged] = fixture.longConversation.listEditProposals(RUN_ID);
      expect(staged).toMatchObject({
        stageId: "agents_md",
        documentId: "AGENTS.md",
        title: "长篇上下文（AGENTS.md）",
        status: "pending",
        baseRevision: revision(beforeText),
        proposedRevision: revision(afterText),
        proposedText: afterText,
        agentsMdTarget: {
          workspaceType: "long",
          bookId: LONG_BOOK_ID,
          beforeText,
          expectedRevision: revision(beforeText)
        }
      });
      expect(staged?.longPlotDesignTarget).toBeUndefined();
      expect(fixture.previewOperations).not.toHaveBeenCalled();
      expect(fixture.applyOperations).not.toHaveBeenCalled();

      await fixture.coordinator.reviewLongAgentEdit({
        runId: RUN_ID,
        proposalId: staged!.id,
        decision: "accept"
      });
      await fixture.coordinator.drain();

      expect(fixture.writeAgentsMd).toHaveBeenCalledWith({
        bookId: LONG_BOOK_ID,
        content: afterText,
        expectedRevision: revision(beforeText)
      });
      expect(longStore.structureAgentsMd).toBe(afterText);

      const accepted = fixture.longConversation.getEditProposal(
        RUN_ID,
        staged!.id
      )!;
      expect(accepted.status).toBe("accepted");
      expect(agentProposalSupportsDiscard(accepted)).toBe(true);

      await fixture.coordinator.discardAgentEdit({
        runId: RUN_ID,
        proposalId: accepted.id
      });
      await fixture.coordinator.drain();

      expect(fixture.writeAgentsMd).toHaveBeenLastCalledWith({
        bookId: LONG_BOOK_ID,
        content: beforeText,
        expectedRevision: revision(afterText)
      });
      expect(longStore.structureAgentsMd).toBe(beforeText);
      expect(
        fixture.longConversation.getEditProposal(RUN_ID, accepted.id)
          ?.discardState?.status
      ).toBe("discarded");
    } finally {
      await fixture.coordinator.dispose();
    }
  });

  it("supports inline Card Edit & Accept for Short and Long (including empty beforeText) and blocks >10,000 code-point edits before IPC", async () => {
    const longStore = useLongWorkspaceStore(pinia);
    longStore.activateBook(LONG_BOOK_ID);
    longStore.structureAgentsMd = "";

    const fixture = createAgentsMdTestFixture({
      initialShortContext: "",
      initialLongContext: ""
    });
    try {
      await fixture.coordinator.stageAgentEditProposal(
        shortAgentsMdEvent("short", "tool-edit-short", "", "智能体短篇草案", 1)
      );
      fixture.coordinator.stageLongPlotDesignEditProposal(
        longAgentsMdEvent("tool-edit-long", "", "智能体长篇草案", 2)
      );
      await fixture.coordinator.drain();

      const shortProposal =
        fixture.shortConversation.listEditProposals(RUN_ID)[0]!;
      const longProposal =
        fixture.longConversation.listEditProposals(RUN_ID)[0]!;
      expect(proposalEditBaseText(shortProposal)).toBe("");
      expect(proposalEditBaseText(longProposal)).toBe("");

      const tooLong = "字".repeat(10_001);
      await fixture.coordinator.reviewAgentEdit({
        runId: RUN_ID,
        proposalId: shortProposal.id,
        decision: "accept",
        editedText: tooLong
      });
      await fixture.coordinator.reviewLongAgentEdit({
        runId: RUN_ID,
        proposalId: longProposal.id,
        decision: "accept",
        editedText: tooLong
      });
      await fixture.coordinator.drain();

      expect(fixture.writeWritingContext).not.toHaveBeenCalled();
      expect(fixture.writeAgentsMd).not.toHaveBeenCalled();
      expect(
        fixture.shortConversation.getEditProposal(RUN_ID, shortProposal.id)
          ?.status
      ).toBe("error");
      expect(
        fixture.longConversation.getEditProposal(RUN_ID, longProposal.id)
          ?.status
      ).toBe("error");

      // Stage fresh proposals and save valid edited versions.
      const fixtureValid = createAgentsMdTestFixture({
        initialShortContext: "",
        initialLongContext: ""
      });
      try {
        await fixtureValid.coordinator.stageAgentEditProposal(
          shortAgentsMdEvent(
            "short",
            "tool-valid-short",
            "",
            "智能体短篇草案",
            3
          )
        );
        fixtureValid.coordinator.stageLongPlotDesignEditProposal(
          longAgentsMdEvent("tool-valid-long", "", "智能体长篇草案", 4)
        );
        await fixtureValid.coordinator.drain();

        const validShort =
          fixtureValid.shortConversation.listEditProposals(RUN_ID)[0]!;
        const validLong =
          fixtureValid.longConversation.listEditProposals(RUN_ID)[0]!;

        await fixtureValid.coordinator.reviewAgentEdit({
          runId: RUN_ID,
          proposalId: validShort.id,
          decision: "accept",
          editedText: "用户手改后的短篇上下文"
        });
        await fixtureValid.coordinator.reviewLongAgentEdit({
          runId: RUN_ID,
          proposalId: validLong.id,
          decision: "accept",
          editedText: "用户手改后的长篇上下文"
        });
        await fixtureValid.coordinator.drain();

        expect(fixtureValid.writeWritingContext).toHaveBeenCalledWith({
          bookId: SHORT_BOOK_ID,
          content: "用户手改后的短篇上下文",
          expectedRevision: revision("")
        });
        expect(fixtureValid.writeAgentsMd).toHaveBeenCalledWith({
          bookId: LONG_BOOK_ID,
          content: "用户手改后的长篇上下文",
          expectedRevision: revision("")
        });
        expect(
          fixtureValid.shortConversation.getEditProposal(RUN_ID, validShort.id)
        ).toMatchObject({
          status: "accepted",
          userEditedText: "用户手改后的短篇上下文"
        });
        expect(
          fixtureValid.longConversation.getEditProposal(RUN_ID, validLong.id)
        ).toMatchObject({
          status: "accepted",
          userEditedText: "用户手改后的长篇上下文"
        });
        expect(longStore.structureAgentsMd).toBe("用户手改后的长篇上下文");
      } finally {
        await fixtureValid.coordinator.dispose();
      }
    } finally {
      await fixture.coordinator.dispose();
    }
  });

  it("rejects proposals and blocks subsequent generations in both Short and Long lanes", async () => {
    const fixture = createAgentsMdTestFixture({
      initialShortContext: "初版",
      initialLongContext: "长篇初版"
    });
    try {
      await fixture.coordinator.stageAgentEditProposal(
        shortAgentsMdEvent("short", "short-gen-1", "初版", "短篇二版", 1)
      );
      fixture.coordinator.stageLongPlotDesignEditProposal(
        longAgentsMdEvent("long-gen-1", "长篇初版", "长篇二版", 2)
      );
      await fixture.coordinator.drain();
      fixture.coordinator.stageLongPlotDesignEditProposal(
        longAgentsMdEvent("long-gen-2", "长篇二版", "长篇三版", 3)
      );
      await fixture.coordinator.drain();

      const shortFirst =
        fixture.shortConversation.listEditProposals(RUN_ID)[0]!;
      const longProposals = fixture.longConversation
        .listEditProposals(RUN_ID)
        .sort((a, b) => (a.generation ?? 1) - (b.generation ?? 1));
      expect(longProposals).toHaveLength(2);
      expect(longProposals[1]).toMatchObject({
        generation: 2,
        predecessorProposalId: longProposals[0]!.id,
        status: "pending"
      });

      await fixture.coordinator.reviewAgentEdit({
        runId: RUN_ID,
        proposalId: shortFirst.id,
        decision: "reject"
      });
      await fixture.coordinator.reviewLongAgentEdit({
        runId: RUN_ID,
        proposalId: longProposals[0]!.id,
        decision: "reject"
      });
      await fixture.coordinator.drain();

      expect(
        fixture.shortConversation.getEditProposal(RUN_ID, shortFirst.id)?.status
      ).toBe("rejected");
      expect(
        fixture.longConversation.getEditProposal(RUN_ID, longProposals[0]!.id)
          ?.status
      ).toBe("rejected");
      expect(
        fixture.longConversation.getEditProposal(RUN_ID, longProposals[1]!.id)
          ?.status
      ).toBe("conflict");

      await fixture.coordinator.stageAgentEditProposal(
        shortAgentsMdEvent("short", "short-gen-2", "初版", "短篇再写", 4)
      );
      fixture.coordinator.stageLongPlotDesignEditProposal(
        longAgentsMdEvent("long-gen-3", "长篇初版", "长篇再写", 5)
      );
      await fixture.coordinator.drain();

      expect(fixture.shortMarkToolConflict).toHaveBeenCalledOnce();
      expect(fixture.longMarkToolConflict).toHaveBeenCalledOnce();
    } finally {
      await fixture.coordinator.dispose();
    }
  });

  it("holds stale proposals on catalog.conflict and long.document_conflict, rebuilds diff, and supports overwrite or keep-user", async () => {
    const beforeText = "第一行\n原始规则";
    const agentText = "第一行\n智能体新规则";
    const userText = "第一行\n用户中途手改的规则";

    const fixture = createAgentsMdTestFixture({
      initialShortContext: beforeText,
      initialLongContext: beforeText
    });
    try {
      await fixture.coordinator.stageAgentEditProposal(
        shortAgentsMdEvent("short", "tool-short-cas", beforeText, agentText, 1)
      );
      fixture.coordinator.stageLongPlotDesignEditProposal(
        longAgentsMdEvent("tool-long-cas", beforeText, agentText, 2)
      );
      await fixture.coordinator.drain();

      const shortStaged =
        fixture.shortConversation.listEditProposals(RUN_ID)[0]!;
      const longStaged = fixture.longConversation.listEditProposals(RUN_ID)[0]!;

      // Simulate race where read saw beforeText right before user saved userText,
      // causing writeWritingContext / writeAgentsMd to throw CAS conflict.
      fixture.readWritingContext.mockResolvedValueOnce({
        bookId: SHORT_BOOK_ID,
        workspaceType: "short",
        content: beforeText,
        truncated: false,
        revision: revision(beforeText)
      });
      fixture.readAgentsMd.mockResolvedValueOnce({
        bookId: LONG_BOOK_ID,
        content: beforeText,
        truncated: false,
        revision: revision(beforeText)
      });
      fixture.setShortContext(userText);
      fixture.setLongContext(userText);

      await fixture.coordinator.reviewAgentEdit({
        runId: RUN_ID,
        proposalId: shortStaged.id,
        decision: "accept"
      });
      await fixture.coordinator.reviewLongAgentEdit({
        runId: RUN_ID,
        proposalId: longStaged.id,
        decision: "accept"
      });
      await fixture.coordinator.drain();

      const heldShort = fixture.shortConversation.getEditProposal(
        RUN_ID,
        shortStaged.id
      )!;
      const heldLong = fixture.longConversation.getEditProposal(
        RUN_ID,
        longStaged.id
      )!;
      const expectedRebuiltHunks = buildAgentTextDiff(
        userText,
        agentText
      ).hunks;

      expect(heldShort).toMatchObject({
        status: "pending",
        approvalMode: "request-approval",
        staleBase: { currentRevision: revision(userText) },
        hunks: expectedRebuiltHunks
      });
      expect(heldLong).toMatchObject({
        status: "pending",
        approvalMode: "request-approval",
        staleBase: { currentRevision: revision(userText) },
        hunks: expectedRebuiltHunks
      });
      expect(proposalEditBaseText(heldShort)).toBeUndefined();
      expect(proposalEditBaseText(heldLong)).toBeUndefined();

      // Short: user chooses Reject ("keep mine").
      await fixture.coordinator.reviewAgentEdit({
        runId: RUN_ID,
        proposalId: heldShort.id,
        decision: "reject"
      });
      // Long: user chooses Accept ("overwrite with agent version").
      await fixture.coordinator.reviewLongAgentEdit({
        runId: RUN_ID,
        proposalId: heldLong.id,
        decision: "accept"
      });
      await fixture.coordinator.drain();

      expect(
        fixture.shortConversation.getEditProposal(RUN_ID, heldShort.id)
      ).toMatchObject({
        status: "rejected",
        staleBase: { resolution: "kept-user" }
      });
      expect(fixture.getShortContext()).toBe(userText);

      expect(fixture.writeAgentsMd).toHaveBeenLastCalledWith({
        bookId: LONG_BOOK_ID,
        content: agentText,
        expectedRevision: revision(userText)
      });
      const overwroteLong = fixture.longConversation.getEditProposal(
        RUN_ID,
        heldLong.id
      )!;
      expect(overwroteLong).toMatchObject({
        status: "accepted",
        staleBase: { resolution: "overwrote" },
        discardSnapshot: { beforeText: userText }
      });
    } finally {
      await fixture.coordinator.dispose();
    }
  });

  it("marks Discard/Undo as conflict if the user edited AGENTS.md after accepting", async () => {
    const beforeText = "旧上下文";
    const afterText = "已接受上下文";
    const fixture = createAgentsMdTestFixture({
      initialShortContext: beforeText,
      initialLongContext: beforeText
    });
    try {
      await fixture.coordinator.stageAgentEditProposal(
        shortAgentsMdEvent("short", "tool-undo-short", beforeText, afterText, 1)
      );
      fixture.coordinator.stageLongPlotDesignEditProposal(
        longAgentsMdEvent("tool-undo-long", beforeText, afterText, 2)
      );
      await fixture.coordinator.drain();

      const shortId =
        fixture.shortConversation.listEditProposals(RUN_ID)[0]!.id;
      const longId = fixture.longConversation.listEditProposals(RUN_ID)[0]!.id;

      await fixture.coordinator.reviewAgentEdit({
        runId: RUN_ID,
        proposalId: shortId,
        decision: "accept"
      });
      await fixture.coordinator.reviewLongAgentEdit({
        runId: RUN_ID,
        proposalId: longId,
        decision: "accept"
      });
      await fixture.coordinator.drain();

      fixture.setShortContext("用户接受后又手改的短篇上下文");
      fixture.setLongContext("用户接受后又手改的长篇上下文");

      await fixture.coordinator.discardAgentEdit({
        runId: RUN_ID,
        proposalId: shortId
      });
      await fixture.coordinator.discardAgentEdit({
        runId: RUN_ID,
        proposalId: longId
      });
      await fixture.coordinator.drain();

      expect(
        fixture.shortConversation.getEditProposal(RUN_ID, shortId)?.discardState
          ?.status
      ).toBe("conflict");
      expect(
        fixture.longConversation.getEditProposal(RUN_ID, longId)?.discardState
          ?.status
      ).toBe("conflict");
      expect(fixture.notifications.warning).toHaveBeenCalledTimes(2);
    } finally {
      await fixture.coordinator.dispose();
    }
  });

  it("round-trips agentsMdTarget through parseStoredEditProposal and hides Locate on AgentEditProposalCard", async () => {
    const diff = buildAgentTextDiff("旧版", "新版");
    const storedLongAgentsMd: AgentEditProposal = {
      id: "proposal-agents-md-1",
      laneId: "lane-agents-md-1",
      generation: 1,
      approvalMode: "request-approval",
      runId: RUN_ID,
      workspaceId: `long:${LONG_BOOK_ID}`,
      stageId: "agents_md",
      documentId: "AGENTS.md",
      title: "长篇上下文（AGENTS.md）",
      summary: "更新上下文",
      status: "accepted",
      baseRevision: revision("旧版"),
      proposedRevision: revision("新版"),
      toolCallIds: ["tool-1"],
      additions: diff.additions,
      deletions: diff.deletions,
      hunks: diff.hunks,
      createdAt: NOW,
      updatedAt: NOW,
      discardSnapshot: { beforeText: "旧版" },
      agentsMdTarget: {
        workspaceType: "long",
        bookId: LONG_BOOK_ID,
        beforeText: "旧版",
        expectedRevision: revision("旧版")
      }
    };

    const parsed = parseStoredEditProposal(
      JSON.parse(JSON.stringify(storedLongAgentsMd))
    );
    expect(parsed).toEqual(storedLongAgentsMd);

    // Bidirectional stage invariant enforcement.
    const { agentsMdTarget: _missingTarget, ...withoutTarget } =
      storedLongAgentsMd;
    expect(parseStoredEditProposal(withoutTarget)).toBeUndefined();
    expect(
      parseStoredEditProposal({ ...storedLongAgentsMd, stageId: "draft" })
    ).toBeUndefined();

    const renderCard = async (
      proposal: AgentEditProposal,
      variant: "card" | "row"
    ) => {
      const app = createSSRApp({
        render: () =>
          h(AgentEditProposalCard, {
            proposal,
            messageStatus: "completed",
            discardable: true,
            variant
          })
      });
      app.use(createPinia());
      return await renderToString(app);
    };

    const cardHtml = await renderCard(storedLongAgentsMd, "card");
    const rowHtml = await renderCard(storedLongAgentsMd, "row");
    expect(cardHtml).not.toContain("跳转文件");
    expect(cardHtml).toContain("撤销修改");
    expect(rowHtml).not.toContain("跳转文件");
    expect(rowHtml).toContain("撤销修改");

    const regularAccepted: AgentEditProposal = {
      ...withoutTarget,
      stageId: "draft",
      documentId: "doc-1"
    };
    const regularCardHtml = await renderCard(regularAccepted, "card");
    expect(regularCardHtml).toContain("跳转文件");
  });
});
