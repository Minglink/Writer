import type { TextViewMode } from "@writer/contracts";
import type { WorkspaceDocument } from "../types/workspace";

export type EditorScrollView = TextViewMode;

interface EditorScrollPosition {
  edit: number;
  preview: number;
  cursorStart?: number;
  cursorEnd?: number;
}

const MAX_REMEMBERED_DOCUMENTS = 200;
const STORAGE_KEY = "writer.editorScrollMemory.v1";
const scrollPositions = new Map<string, EditorScrollPosition>(
  loadPersistedScrollPositions()
);

function loadPersistedScrollPositions(): Array<[string, EditorScrollPosition]> {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return [];
    }
    return Object.entries(parsed as Record<string, EditorScrollPosition>)
      .filter(
        ([, value]) =>
          value &&
          typeof value === "object" &&
          typeof value.edit === "number" &&
          typeof value.preview === "number"
      )
      .slice(-MAX_REMEMBERED_DOCUMENTS);
  } catch {
    return [];
  }
}

function persistScrollPositions(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(Object.fromEntries(scrollPositions))
    );
  } catch {
    // Ignore storage errors.
  }
}

export function editorScrollMemoryKey(
  document: Pick<
    WorkspaceDocument,
    "domain" | "id" | "libraryId" | "workspaceId"
  >
): string {
  return [
    document.workspaceId ?? "",
    document.libraryId ?? "",
    document.domain,
    document.id
  ].join("\u0000");
}

export function rememberEditorScrollPosition(
  key: string,
  view: EditorScrollView,
  scrollTop: number
): void {
  const position = scrollPositions.get(key) ?? { edit: 0, preview: 0 };
  position[view] = Number.isFinite(scrollTop) ? Math.max(0, scrollTop) : 0;

  // Refresh insertion order so the least recently viewed document is evicted first.
  scrollPositions.delete(key);
  scrollPositions.set(key, position);
  if (scrollPositions.size > MAX_REMEMBERED_DOCUMENTS) {
    const oldestKey = scrollPositions.keys().next().value;
    if (oldestKey !== undefined) scrollPositions.delete(oldestKey);
  }
  persistScrollPositions();
}

export function recalledEditorScrollPosition(
  key: string,
  view: EditorScrollView
): number {
  return scrollPositions.get(key)?.[view] ?? 0;
}

export function rememberEditorCursorPosition(
  key: string,
  selectionStart: number,
  selectionEnd: number
): void {
  const position = scrollPositions.get(key) ?? { edit: 0, preview: 0 };
  const start = Number.isFinite(selectionStart)
    ? Math.max(0, Math.round(selectionStart))
    : 0;
  const end = Number.isFinite(selectionEnd)
    ? Math.max(start, Math.round(selectionEnd))
    : start;
  position.cursorStart = start;
  position.cursorEnd = end;
  scrollPositions.delete(key);
  scrollPositions.set(key, position);
  if (scrollPositions.size > MAX_REMEMBERED_DOCUMENTS) {
    const oldestKey = scrollPositions.keys().next().value;
    if (oldestKey !== undefined) scrollPositions.delete(oldestKey);
  }
  persistScrollPositions();
}

export function recalledEditorCursorPosition(
  key: string
): { start: number; end: number } | null {
  const position = scrollPositions.get(key);
  if (
    typeof position?.cursorStart !== "number" ||
    typeof position?.cursorEnd !== "number"
  ) {
    return null;
  }
  return {
    start: position.cursorStart,
    end: Math.max(position.cursorStart, position.cursorEnd)
  };
}

export function clearEditorScrollMemory(): void {
  scrollPositions.clear();
  persistScrollPositions();
}
