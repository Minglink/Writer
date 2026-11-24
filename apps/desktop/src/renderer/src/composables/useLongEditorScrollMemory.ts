import type { TextViewMode } from "@writer/contracts";
import { nextTick, watch, type Ref } from "vue";
import {
  recalledEditorCursorPosition,
  recalledEditorScrollPosition,
  rememberEditorCursorPosition,
  rememberEditorScrollPosition
} from "../utils/editorScrollMemory";

export interface LongEditorScrollIdentity {
  bookId: string;
  selectionKey: string;
  fileId: string;
  worldbuildingItemId: string;
  bookLineVolumeId: string;
  bookLineContentTab: string;
  plotPointId: string;
  plotPointTab: string;
  storyPlotId: string;
  chapterCardId: string;
}

export function longEditorScrollMemoryKey(
  identity: LongEditorScrollIdentity
): string {
  return [
    "long-workspace",
    identity.bookId,
    identity.selectionKey,
    identity.fileId,
    identity.worldbuildingItemId,
    identity.bookLineVolumeId,
    identity.bookLineContentTab,
    identity.plotPointId,
    identity.plotPointTab,
    identity.storyPlotId,
    identity.chapterCardId
  ].join("\u0000");
}

interface ScrollElement {
  scrollTop: number;
}

function eventScrollElement(event: Event): ScrollElement | null {
  const target = event.currentTarget;
  if (!target || typeof target !== "object" || !("scrollTop" in target)) {
    return null;
  }
  return target as unknown as ScrollElement;
}

export function useLongEditorScrollMemory(options: {
  documentKey: () => string;
  viewMode: Ref<TextViewMode>;
  editorInput: Ref<HTMLTextAreaElement | null | undefined>;
  documentPreview: Ref<HTMLElement | null | undefined>;
  isBusy?: () => boolean;
  /**
   * Short and script editors reset the view mode in their own document watch
   * and then restore. Leaving this on would record the previous section's
   * offset against the next section during that reset.
   */
  bindIdentityWatch?: boolean;
}) {
  function scrollerFor(view: TextViewMode): ScrollElement | null {
    const element =
      view === "edit"
        ? options.editorInput.value
        : options.documentPreview.value;
    return element ?? null;
  }

  function rememberScroll(
    key = options.documentKey(),
    view = options.viewMode.value
  ): void {
    if (options.isBusy?.()) return;
    const scroller = scrollerFor(view);
    if (!scroller) return;
    rememberEditorScrollPosition(key, view, scroller.scrollTop);
    if (view === "edit" && options.editorInput.value) {
      rememberEditorCursorPosition(
        key,
        options.editorInput.value.selectionStart ?? 0,
        options.editorInput.value.selectionEnd ?? 0
      );
    }
  }

  async function restoreScroll(
    key = options.documentKey(),
    view = options.viewMode.value
  ): Promise<void> {
    // Read before the textarea value changes. A scroll event from that reuse
    // must not replace this document's own remembered offset.
    const scrollTop = recalledEditorScrollPosition(key, view);
    const cursor = view === "edit" ? recalledEditorCursorPosition(key) : null;
    await nextTick();
    if (options.documentKey() !== key || options.viewMode.value !== view) {
      return;
    }
    const scroller = scrollerFor(view);
    if (!scroller) return;
    if (
      cursor &&
      view === "edit" &&
      options.editorInput.value &&
      typeof options.editorInput.value.value === "string" &&
      typeof options.editorInput.value.setSelectionRange === "function"
    ) {
      const input = options.editorInput.value;
      const maxOffset = input.value.length;
      const start = Math.max(0, Math.min(cursor.start, maxOffset));
      const end = Math.max(start, Math.min(cursor.end, maxOffset));
      input.setSelectionRange(start, end);
    }
    scroller.scrollTop = scrollTop;
  }

  function handleScroll(event: Event): void {
    if (options.isBusy?.()) return;
    const scroller = eventScrollElement(event);
    if (!scroller) return;
    rememberEditorScrollPosition(
      options.documentKey(),
      options.viewMode.value,
      scroller.scrollTop
    );
  }

  if (options.bindIdentityWatch !== false) {
    watch(
      () => [options.documentKey(), options.viewMode.value] as const,
      ([nextKey, nextView], [previousKey, previousView]) => {
        rememberScroll(previousKey, previousView);
        void restoreScroll(nextKey, nextView);
      },
      { flush: "pre" }
    );
  }

  return {
    handleScroll,
    rememberScroll,
    restoreScroll
  };
}
