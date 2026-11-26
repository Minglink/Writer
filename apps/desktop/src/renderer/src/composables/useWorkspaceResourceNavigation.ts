import { t } from "../i18n";
import { computed, provide } from "vue";
import type {
  ChatAssistantProjectRef,
  ExternalWindowTarget
} from "@writer/contracts";
import type { ResourceTreeNode } from "../types/workspace";
import type { ApprovalNavigationTarget } from "../utils/approvalNavigation";
import {
  useWorkspaceResourceCoordinator,
  type WorkspaceResourceCoordinatorOptions
} from "./useWorkspaceResourceCoordinator";
import {
  COMPOSER_CONTEXT_NAVIGATION,
  OPEN_WORKSPACE_RESOURCE,
  type ComposerContextNavigation
} from "./composerContextNavigationContext";

/** Share existing workspace navigation; build picker choices only on demand. */
export function useWorkspaceResourceNavigation(
  options: WorkspaceResourceCoordinatorOptions
) {
  const resources = useWorkspaceResourceCoordinator(options);
  const { longNavigation, mysteryNavigation, notifications, state, tree } =
    options;
  let navigation: Promise<ComposerContextNavigation | null> | undefined;
  provide(OPEN_WORKSPACE_RESOURCE, async (id) => {
    const node = tree.lookup.value.nodeById.get(id);
    if (!node || node.unavailable || node.missing) return false;
    await resources.selectResource(node);
    return state.selectedResourceId.value === id;
  });
  provide(COMPOSER_CONTEXT_NAVIGATION, {
    available: computed(() =>
      tree.lookup.value.nodeById.has(state.selectedResourceId.value)
    ),
    load() {
      navigation ??= import("./composerContextNavigation")
        .then(({ createWorkspaceComposerContextNavigation }) =>
          createWorkspaceComposerContextNavigation(options, resources)
        )
        .catch(() => {
          navigation = undefined;
          notifications.error(
            t(
              "workspace.workspaceResourceNavigation.couldNotLoadTheSelectionListTryAgain"
            )
          );
          return null;
        });
      return navigation;
    }
  });

  function findOpening(
    kind: ExternalWindowTarget["kind"] | ChatAssistantProjectRef["projectType"],
    id: string
  ) {
    const root = resources.findResourceNodeWhere((node) =>
      kind === "long"
        ? node.longBookId === id && node.catalogNodeType === "long-book"
        : kind === "mystery"
          ? node.mysteryBookId === id && node.catalogNodeType === "mystery-book"
          : kind === "library"
            ? node.libraryId === id && node.catalogNodeType === "library"
            : node.id === id && node.catalogNodeType === "book"
    );
    const opening = (node?: ResourceTreeNode): ResourceTreeNode | undefined => {
      if (!node || node.unavailable || node.missing) return undefined;
      if (
        kind === "mystery"
          ? node.catalogNodeType === "mystery-book"
          : kind === "long"
            ? node.longWorkspaceSelection?.key === "root:worldbuilding"
            : resources.documentForResourceId(node.id)
      ) {
        return node;
      }
      for (const child of node.children ?? []) {
        const found = opening(child);
        if (found) return found;
      }
      return undefined;
    };
    return { root, node: opening(root) };
  }

  async function openIdentityBook(
    book: ChatAssistantProjectRef
  ): Promise<void> {
    const { node } = findOpening(book.projectType, book.projectId);
    if (!node) {
      notifications.warning(
        t("components.workspaceShell.theTargetEntryNoLongerExists")
      );
      return;
    }
    await resources.selectResource(node);
  }

  /** Opens the first readable document; returns false when there is none. */
  async function openExternalTarget(
    target: ExternalWindowTarget,
    navOptions?: { preserveSelection?: boolean }
  ): Promise<boolean> {
    const { root, node } = findOpening(target.kind, target.id);
    if (!node) return false;
    const selected = state.selectedResourceId.value;
    const inSubtree = (n?: ResourceTreeNode): boolean =>
      Boolean(n && (n.id === selected || n.children?.some(inSubtree)));
    if (
      navOptions?.preserveSelection &&
      selected &&
      (target.kind === "long"
        ? longNavigation.activeBookId.value === target.id &&
          Boolean(longNavigation.workspaceIndex.value) &&
          selected.startsWith(`long-book:${target.id}`)
        : target.kind === "mystery"
          ? mysteryNavigation?.activeBookId.value === target.id &&
            selected.startsWith(`mystery-book:${target.id}`)
          : !longNavigation.activeBookId.value &&
            !mysteryNavigation?.activeBookId.value &&
            inSubtree(root) &&
            selected !== root?.id)
    ) {
      options.showConversation();
      return true;
    }
    await resources.selectResource(node);
    return (
      state.selectedResourceId.value === node.id &&
      (target.kind !== "long" ||
        longNavigation.activeBookId.value === target.id)
    );
  }

  async function selectEditorEntrySearchResult(
    documentId: string,
    navigate: (target: ApprovalNavigationTarget) => Promise<boolean>
  ): Promise<void> {
    const target = resources.liveWorkspaceDocuments.value.find(
      (document) => document.id === documentId
    );
    if (!target) {
      notifications.warning(
        t("components.workspaceShell.theTargetEntryNoLongerExists")
      );
      return;
    }
    const navigated = await navigate({
      kind: "document",
      workspaceId: target.workspaceId ?? target.libraryId ?? target.id,
      documentId: target.id
    });
    if (!navigated)
      notifications.warning(
        t("components.workspaceShell.theTargetEntryCannotBeOpenedRightNow")
      );
  }

  async function selectLongEntrySearchResult(
    fileId: string,
    navigate: (target: ApprovalNavigationTarget) => Promise<boolean>
  ): Promise<void> {
    const bookId = longNavigation.activeBookId.value;
    if (!bookId) return;
    const navigated = await navigate({
      kind: "long",
      bookId,
      candidates: [{ kind: "file", fileId }]
    });
    if (!navigated)
      notifications.warning(
        t("components.workspaceShell.theTargetNovelEntryCannotBeOpenedRightNow")
      );
  }

  return {
    ...resources,
    defaultCreationResourceId: () =>
      resources.fallbackCreationResourceId(
        tree.sections.value,
        state.selectedResourceId.value
      ),
    openIdentityBook,
    openExternalTarget,
    selectEditorEntrySearchResult,
    selectLongEntrySearchResult
  };
}
