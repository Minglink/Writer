import {
  CatalogSnapshotSchema,
  catalogDraftBodyDocumentId,
  catalogDraftCharacterStateDocumentId,
  createDefaultBookPlotStages
} from "@writer/contracts/renderer";
import type {
  LongBookSummary,
  LongWorkspaceIndexSnapshot
} from "@writer/contracts";
import { computed, effectScope, nextTick, ref } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  projectCatalogWorkspace,
  resolveDraftSectionResourceId
} from "../data/catalogWorkspace";
import type { LongWorkspaceSelection } from "../types/longWorkspace";
import type { ResourceTreeNode, WorkspaceDocument } from "../types/workspace";
import { createResourceTreeLookup } from "../utils/resourceTreeLookup";
import {
  createLongRootSelection,
  longNavigationNodeId
} from "../utils/longWorkspaceResourceTree";
import { useTreeNodeDisclosure } from "./useTreeNodeDisclosure";
import type { WorkspaceResourceCoordinatorOptions } from "./useWorkspaceResourceCoordinator";
import { useWorkspaceResourceNavigation } from "./useWorkspaceResourceNavigation";

vi.mock("vue", async (original) => ({
  ...(await original<typeof import("vue")>()),
  provide: vi.fn()
}));

const scopes: ReturnType<typeof effectScope>[] = [];
afterEach(() => scopes.splice(0).forEach((scope) => scope.stop()));

function fixture(bookType: "short" | "script" = "short", list = false) {
  const now = "2026-10-02T12:00:00.000Z";
  const document = (id: string, title: string, content: string) => ({
    id,
    title,
    content,
    createdAt: now,
    updatedAt: now
  });
  const plotStages = createDefaultBookPlotStages({ allEnabled: true });
  const catalog = CatalogSnapshotSchema.parse({
    schemaVersion: 1,
    revision: 1,
    updatedAt: now,
    books: [
      {
        id: "book_navigation",
        title: "导航样书",
        bookType,
        genre: "其他",
        status: "editing",
        linkedMaterialIdsByKind: {
          character: [],
          gimmick: [],
          plot: [],
          draft: [],
          other: []
        },
        linkedSkillIdsByKind: { general: [], plot: [], style: [], other: [] },
        characterStructure: list
          ? { format: "list", items: [] }
          : { format: "text" },
        plotStages,
        documents: [
          document("character_design", "概览", "人物内容"),
          ...plotStages.map((stage) =>
            document(stage.id, stage.title, "剧情内容")
          )
        ],
        draft: {
          id: "draft",
          title: "正文",
          sections: [
            {
              id: "section_one",
              title: "第一节",
              wordCountRequirement: "",
              body: document(
                catalogDraftBodyDocumentId("section_one"),
                "正文",
                "正文内容"
              ),
              characterState: document(
                catalogDraftCharacterStateDocumentId("section_one"),
                "人物状态",
                ""
              ),
              createdAt: now,
              updatedAt: now
            }
          ],
          createdAt: now,
          updatedAt: now
        },
        createdAt: now,
        updatedAt: now
      }
    ],
    materialGroups: [],
    skillGroups: [],
    materials: [],
    skills: []
  });
  const book = catalog.books[0]!;
  const projection = projectCatalogWorkspace(catalog);
  const bookNode = projection.resourceSections[0]!.nodes[0]!;
  const characterNode = bookNode.children!.find(
    (node) => node.stageCategoryId === "character_design"
  )!;
  const summary = {
    id: "longbook_navigation",
    title: "长篇导航样书"
  } as LongBookSummary;
  const index = { bookId: summary.id } as LongWorkspaceIndexSnapshot;
  const worldbuilding = createLongRootSelection(summary, "worldbuilding");
  const draft = createLongRootSelection(summary, "draft");
  const worldbuildingNode: ResourceTreeNode = {
    id: longNavigationNodeId(summary.id, worldbuilding.key),
    label: "世界观",
    longBookId: summary.id,
    longWorkspaceSelection: worldbuilding
  };
  const longNode: ResourceTreeNode = {
    id: `long-book:${summary.id}`,
    label: summary.title,
    catalogNodeType: "long-book",
    longBookId: summary.id,
    children: [worldbuildingNode]
  };
  const sections = ref(
    projection.resourceSections.map((section) => ({
      ...section,
      nodes:
        section.id === "creation" ? [...section.nodes, longNode] : section.nodes
    }))
  );
  const documents = ref(projection.workspaceDocuments);
  const selectedResourceId = ref("");
  const activeCreationResourceId = ref("");
  const activeBookId = ref<string | null>(null);
  const selection = ref<LongWorkspaceSelection | null>(draft);
  const activeSummary = ref<LongBookSummary | null>(null);
  const workspaceIndex = ref<LongWorkspaceIndexSnapshot | null>(null);
  const view = ref("book-identity");
  const showConversation = vi.fn(() => {
    view.value = "conversation";
  });
  const revealEditor = vi.fn();
  const saveBeforeLeaving = vi.fn(async () => true);
  const openBook = vi.fn(
    async (id: string, target?: LongWorkspaceSelection | null) => {
      activeBookId.value = id;
      activeSummary.value = summary;
      workspaceIndex.value = index;
      selection.value = target ?? null;
    }
  );
  const selectWorkspaceFile = vi.fn(async (target: LongWorkspaceSelection) => {
    selection.value = target;
    return true;
  });
  const ensureOne = vi.fn(async (target: string | WorkspaceDocument) => {
    const document =
      typeof target === "string"
        ? documents.value.find((document) => document.id === target)
        : target;
    return {
      ok: true,
      requestedIds: [],
      loadedIds: [],
      alreadyLoadedIds: [],
      skippedIds: [],
      retriedIds: [],
      failures: [],
      published: false,
      documents: documents.value,
      document
    };
  });
  const options: WorkspaceResourceCoordinatorOptions = {
    state: {
      selectedResourceId,
      activeCreationResourceId,
      selectedExpertSectionIds: ref({}),
      selectedDraftFileKinds: ref({}),
      pendingEditorReferences: ref([]),
      editorReferenceNavigation: ref(),
      documents,
      editorDrafts: ref({})
    },
    catalog: {
      snapshot: ref(null),
      projection: ref(projection),
      loader: {
        documentsById: computed(
          () =>
            new Map(documents.value.map((document) => [document.id, document]))
        ),
        ensureOne,
        ensureLoaded: async () => ({
          ok: true,
          requestedIds: [],
          loadedIds: [],
          alreadyLoadedIds: [],
          skippedIds: [],
          retriedIds: [],
          failures: [],
          published: false,
          documents: documents.value
        }),
        contextSnapshot: (snapshot) => snapshot
      },
      findBook: (id) => catalog.books.find((book) => book.id === id)
    },
    tree: {
      sections,
      lookup: computed(() => createResourceTreeLookup(sections.value))
    },
    longNavigation: {
      books: ref([summary]),
      activeBookId,
      activeBookSummary: activeSummary,
      workspaceIndex,
      activeRoot: ref("worldbuilding"),
      workspaceActive: ref(false),
      saveActiveEditorBeforeLeaving: saveBeforeLeaving,
      openBook,
      selectWorkspaceFile,
      deactivateActiveBook: () => {
        activeBookId.value = null;
      }
    },
    emptyDocument: {
      id: "empty",
      domain: "creation",
      title: "未选择",
      eyebrow: "",
      path: [],
      content: ""
    },
    showConversation,
    revealEditor,
    notifications: { warning: vi.fn(), error: vi.fn(), info: vi.fn() }
  };
  const scope = effectScope();
  scopes.push(scope);
  const navigation = scope.run(() => useWorkspaceResourceNavigation(options))!;
  const disclosure = scope.run(() =>
    useTreeNodeDisclosure(
      () => bookNode,
      () => selectedResourceId.value
    )
  )!;
  return {
    navigation,
    book,
    bookNode,
    characterNode,
    worldbuildingNode,
    longNode,
    selectedResourceId,
    activeCreationResourceId,
    activeBookId,
    activeSummary,
    workspaceIndex,
    selection,
    view,
    showConversation,
    revealEditor,
    saveBeforeLeaving,
    openBook,
    selectWorkspaceFile,
    ensureOne,
    disclosure
  };
}

describe("book identity workspace navigation", () => {
  it.each([
    ["short", false],
    ["short", true],
    ["script", false],
    ["script", true]
  ] as const)(
    "opens %s characters (list=%s), selects the sidebar and reveals the editor",
    async (bookType, list) => {
      const f = fixture(bookType, list);
      await f.navigation.openIdentityBook({
        projectType: bookType,
        projectId: f.book.id
      });
      await nextTick();
      expect(f.view.value).toBe("conversation");
      expect(f.navigation.activeDocument.value).toMatchObject({
        workspaceId: f.book.id,
        stageId: "character_design",
        content: "人物内容"
      });
      expect(f.selectedResourceId.value).toBe(f.characterNode.id);
      expect(f.activeCreationResourceId.value).toBe(f.characterNode.id);
      expect(f.disclosure.open.value).toBe(true);
      expect(f.ensureOne).toHaveBeenCalled();
      expect(f.revealEditor).toHaveBeenCalledOnce();
    }
  );

  it("leaves the active long book before opening short characters", async () => {
    const f = fixture();
    f.activeBookId.value = "longbook_navigation";
    f.selectedResourceId.value = f.worldbuildingNode.id;
    await f.navigation.openIdentityBook({
      projectType: "short",
      projectId: f.book.id
    });
    expect(f.activeBookId.value).toBeNull();
    expect(f.selectedResourceId.value).toBe(f.characterNode.id);
    expect(f.navigation.activeDocument.value.content).toBe("人物内容");
  });

  it("opens a long book at worldbuilding and synchronizes the sidebar selection", async () => {
    const f = fixture();
    await f.navigation.openIdentityBook({
      projectType: "long",
      projectId: "longbook_navigation"
    });
    expect(f.view.value).toBe("conversation");
    expect(f.activeBookId.value).toBe("longbook_navigation");
    expect(f.selectedResourceId.value).toBe(f.worldbuildingNode.id);
    expect(f.selection.value?.key).toBe("root:worldbuilding");
    expect(f.revealEditor).toHaveBeenCalledOnce();
  });

  it("returns an already active long book to worldbuilding", async () => {
    const f = fixture();
    f.activeBookId.value = "longbook_navigation";
    f.activeSummary.value = {
      id: "longbook_navigation",
      title: "长篇导航样书"
    } as LongBookSummary;
    f.workspaceIndex.value = {
      bookId: "longbook_navigation"
    } as LongWorkspaceIndexSnapshot;
    await f.navigation.openIdentityBook({
      projectType: "long",
      projectId: "longbook_navigation"
    });
    expect(f.openBook).not.toHaveBeenCalled();
    expect(f.selectWorkspaceFile).toHaveBeenCalledOnce();
    expect(f.selection.value?.key).toBe("root:worldbuilding");
    expect(f.selectedResourceId.value).toBe(f.worldbuildingNode.id);
  });

  it.each(["short", "long"] as const)(
    "stays in book identity when saving prevents %s navigation",
    async (projectType) => {
      const f = fixture();
      f.saveBeforeLeaving.mockResolvedValueOnce(false);
      await f.navigation.openIdentityBook({
        projectType,
        projectId: projectType === "long" ? "longbook_navigation" : f.book.id
      });
      expect(f.view.value).toBe("book-identity");
      expect(f.selectedResourceId.value).toBe("");
      expect(f.showConversation).not.toHaveBeenCalled();
      expect(f.revealEditor).not.toHaveBeenCalled();
    }
  );

  it("preserves the active short draft section when opening with preserveSelection", async () => {
    const f = fixture();
    const sectionResourceId = resolveDraftSectionResourceId(
      f.bookNode,
      "section_one"
    )!;
    const sectionNode = f.navigation.findResourceNodeWhere(
      (node) => node.id === sectionResourceId
    )!;
    await f.navigation.selectResource(sectionNode);
    await nextTick();
    expect(f.selectedResourceId.value).toBe(sectionNode.id);
    expect(f.navigation.activeDocument.value.content).toBe("正文内容");

    f.view.value = "book-identity";
    f.showConversation.mockClear();
    f.revealEditor.mockClear();

    const opened = await f.navigation.openExternalTarget(
      { kind: "short", id: f.book.id },
      { preserveSelection: true }
    );
    expect(opened).toBe(true);
    expect(f.view.value).toBe("conversation");
    expect(f.showConversation).toHaveBeenCalledOnce();
    expect(f.selectedResourceId.value).toBe(sectionNode.id);
    expect(f.navigation.activeDocument.value.content).toBe("正文内容");
    expect(f.revealEditor).not.toHaveBeenCalled();
  });

  it("preserves the active long selection when opening with preserveSelection", async () => {
    const f = fixture();
    const draftNodeId = longNavigationNodeId(
      "longbook_navigation",
      "root:draft"
    );
    f.activeBookId.value = "longbook_navigation";
    f.activeSummary.value = {
      id: "longbook_navigation",
      title: "长篇导航样书"
    } as LongBookSummary;
    f.workspaceIndex.value = {
      bookId: "longbook_navigation"
    } as LongWorkspaceIndexSnapshot;
    f.selectedResourceId.value = draftNodeId;

    const opened = await f.navigation.openExternalTarget(
      { kind: "long", id: "longbook_navigation" },
      { preserveSelection: true }
    );
    expect(opened).toBe(true);
    expect(f.view.value).toBe("conversation");
    expect(f.showConversation).toHaveBeenCalledOnce();
    expect(f.openBook).not.toHaveBeenCalled();
    expect(f.selectWorkspaceFile).not.toHaveBeenCalled();
    expect(f.selection.value?.key).toBe("root:draft");
    expect(f.selectedResourceId.value).toBe(draftNodeId);
  });

  it("selects the target book when preserveSelection is true and another book or empty selection is active", async () => {
    const f = fixture();
    await expect(
      f.navigation.openExternalTarget(
        { kind: "short", id: f.book.id },
        { preserveSelection: true }
      )
    ).resolves.toBe(true);
    expect(f.selectedResourceId.value).toBe(f.characterNode.id);

    await expect(
      f.navigation.openExternalTarget(
        { kind: "long", id: "longbook_navigation" },
        { preserveSelection: true }
      )
    ).resolves.toBe(true);
    expect(f.activeBookId.value).toBe("longbook_navigation");
    expect(f.selectedResourceId.value).toBe(f.worldbuildingNode.id);
  });

  it.each(["short", "long"] as const)(
    "returns false from openExternalTarget when saving aborts %s navigation",
    async (kind) => {
      const f = fixture();
      f.saveBeforeLeaving.mockResolvedValueOnce(false);
      await expect(
        f.navigation.openExternalTarget(
          {
            kind,
            id: kind === "long" ? "longbook_navigation" : f.book.id
          },
          { preserveSelection: true }
        )
      ).resolves.toBe(false);
      expect(f.selectedResourceId.value).toBe("");
      expect(f.showConversation).not.toHaveBeenCalled();
    }
  );
});
