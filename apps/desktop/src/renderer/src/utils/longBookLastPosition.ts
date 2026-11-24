import type {
  LongBookSummary,
  LongChapterCardId,
  LongFileId,
  LongWorkspaceIndexSnapshot
} from "@writer/contracts";
import {
  createLongChapterSelection,
  type LongWorkspaceFileRole,
  type LongWorkspaceSelection
} from "../types/longWorkspace";

const STORAGE_KEY = "writer.longLastSelection.v1";
const WRITING_POSITION_STORAGE_KEY = "writer.longLastWritingPosition.v1";
const MAX_REMEMBERED_BOOKS = 100;
const WRITING_ANCHOR_EXCERPT_MAX_CHARS = 64;

export interface LongWritingPosition {
  readonly bookId: string;
  readonly chapterCardId: LongChapterCardId;
  readonly fileId: LongFileId;
  readonly title: string;
  readonly selectionStart: number;
  readonly selectionEnd: number;
  readonly scrollTop: number;
  readonly anchorExcerpt: string;
  readonly anchorOffsetInExcerpt?: number;
  readonly updatedAt: string;
}

type StoredWritingPositionMap = Record<string, LongWritingPosition>;

function readWritingPositionMap(): StoredWritingPositionMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(WRITING_POSITION_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as StoredWritingPositionMap)
      : {};
  } catch {
    return {};
  }
}

function writeWritingPositionMap(map: StoredWritingPositionMap): void {
  if (typeof window === "undefined") return;
  try {
    const entries = Object.entries(map).slice(-MAX_REMEMBERED_BOOKS);
    window.localStorage.setItem(
      WRITING_POSITION_STORAGE_KEY,
      JSON.stringify(Object.fromEntries(entries))
    );
  } catch {
    // Ignore storage quota or restricted-environment errors.
  }
}

export function extractWritingAnchor(
  documentText: string,
  cursorOffset: number
): { excerpt: string; offsetInExcerpt: number } {
  if (!documentText) return { excerpt: "", offsetInExcerpt: 0 };
  const clamped = Math.max(0, Math.min(cursorOffset, documentText.length));
  const half = Math.floor(WRITING_ANCHOR_EXCERPT_MAX_CHARS / 2);
  const sliceStart = Math.max(0, clamped - half);
  const sliceEnd = Math.min(
    documentText.length,
    sliceStart + WRITING_ANCHOR_EXCERPT_MAX_CHARS
  );
  const raw = documentText.slice(sliceStart, sliceEnd);
  const leadingTrim = raw.length - raw.trimStart().length;
  const excerpt = raw.trim();
  if (!excerpt) return { excerpt: "", offsetInExcerpt: 0 };
  const effectiveStart = sliceStart + leadingTrim;
  const offsetInExcerpt = Math.max(
    0,
    Math.min(excerpt.length, clamped - effectiveStart)
  );
  return { excerpt, offsetInExcerpt };
}

export function extractWritingAnchorExcerpt(
  documentText: string,
  cursorOffset: number
): string {
  return extractWritingAnchor(documentText, cursorOffset).excerpt;
}

export function rememberLongWritingPosition(
  position: LongWritingPosition
): void {
  if (!position.bookId || !position.chapterCardId || !position.fileId) return;
  const map = readWritingPositionMap();
  delete map[position.bookId];
  map[position.bookId] = {
    ...position,
    selectionStart: Math.max(0, Math.floor(position.selectionStart)),
    selectionEnd: Math.max(
      Math.max(0, Math.floor(position.selectionStart)),
      Math.floor(position.selectionEnd)
    ),
    scrollTop: Math.max(0, Math.round(position.scrollTop)),
    anchorExcerpt: position.anchorExcerpt.slice(
      0,
      WRITING_ANCHOR_EXCERPT_MAX_CHARS
    )
  };
  writeWritingPositionMap(map);
}

export function loadLongWritingPosition(
  bookId: string
): LongWritingPosition | null {
  if (!bookId) return null;
  return readWritingPositionMap()[bookId] ?? null;
}

export function resolveWritingPositionOffset(
  documentText: string,
  position: Pick<
    LongWritingPosition,
    | "selectionStart"
    | "selectionEnd"
    | "anchorExcerpt"
    | "anchorOffsetInExcerpt"
  >
): { start: number; end: number; relocated: boolean; foundAnchor: boolean } {
  const maxOffset = documentText.length;
  const clampedStart = Math.max(
    0,
    Math.min(position.selectionStart, maxOffset)
  );
  const clampedEnd = Math.max(
    clampedStart,
    Math.min(position.selectionEnd, maxOffset)
  );
  const selectionLength = Math.max(0, clampedEnd - clampedStart);
  const excerpt = position.anchorExcerpt.trim();
  if (!excerpt) {
    return {
      start: clampedStart,
      end: clampedEnd,
      relocated: false,
      foundAnchor: true
    };
  }
  const relativeOffset =
    typeof position.anchorOffsetInExcerpt === "number" &&
    Number.isFinite(position.anchorOffsetInExcerpt)
      ? Math.max(
          0,
          Math.min(excerpt.length, Math.floor(position.anchorOffsetInExcerpt))
        )
      : Math.floor(excerpt.length / 2);

  const expectedExcerptStart = clampedStart - relativeOffset;
  if (
    expectedExcerptStart >= 0 &&
    expectedExcerptStart + excerpt.length <= documentText.length &&
    documentText.slice(
      expectedExcerptStart,
      expectedExcerptStart + excerpt.length
    ) === excerpt
  ) {
    return {
      start: clampedStart,
      end: Math.min(maxOffset, clampedStart + selectionLength),
      relocated: false,
      foundAnchor: true
    };
  }

  const firstIdx = documentText.indexOf(excerpt);
  if (firstIdx >= 0) {
    let bestIdx = firstIdx;
    let bestDist = Math.abs(firstIdx + relativeOffset - clampedStart);
    let cursor = firstIdx + 1;
    while (cursor <= documentText.length - excerpt.length) {
      const nextIdx = documentText.indexOf(excerpt, cursor);
      if (nextIdx < 0) break;
      const dist = Math.abs(nextIdx + relativeOffset - clampedStart);
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = nextIdx;
      }
      cursor = nextIdx + 1;
    }
    const targetStart = Math.min(maxOffset, bestIdx + relativeOffset);
    const targetEnd = Math.min(maxOffset, targetStart + selectionLength);
    return {
      start: targetStart,
      end: targetEnd,
      relocated: targetStart !== clampedStart,
      foundAnchor: true
    };
  }
  return {
    start: clampedStart,
    end: clampedEnd,
    relocated: false,
    foundAnchor: false
  };
}

export interface RememberedLongBookSelection {
  readonly key: string;
  readonly chapterCardId?: LongChapterCardId | undefined;
  readonly preferredFileId?: LongFileId | undefined;
  readonly preferredRole?: LongWorkspaceFileRole | undefined;
}

type StoredSelectionMap = Record<string, RememberedLongBookSelection>;

function readMap(): StoredSelectionMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as StoredSelectionMap)
      : {};
  } catch {
    return {};
  }
}

function writeMap(map: StoredSelectionMap): void {
  if (typeof window === "undefined") return;
  try {
    const entries = Object.entries(map).slice(-MAX_REMEMBERED_BOOKS);
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(Object.fromEntries(entries))
    );
  } catch {
    // Ignore storage quota or restricted-environment errors.
  }
}

export function rememberLongBookSelection(
  bookId: string,
  selection: LongWorkspaceSelection
): void {
  if (!bookId) return;
  const map = readMap();
  delete map[bookId];
  map[bookId] = {
    key: selection.key,
    ...(selection.chapterCardId
      ? { chapterCardId: selection.chapterCardId }
      : {}),
    ...(selection.preferredFileId
      ? { preferredFileId: selection.preferredFileId }
      : {}),
    ...(selection.preferredRole
      ? { preferredRole: selection.preferredRole }
      : {})
  };
  writeMap(map);
}

export function loadRememberedLongBookSelection(
  bookId: string
): RememberedLongBookSelection | null {
  if (!bookId) return null;
  return readMap()[bookId] ?? null;
}

export function resolveRestoredLongSelection(
  book: LongBookSummary,
  index: LongWorkspaceIndexSnapshot,
  remembered: RememberedLongBookSelection | null
): LongWorkspaceSelection | null {
  if (remembered?.chapterCardId) {
    const rememberedChapter = index.chapters.find(
      (entry) => entry.chapterCardId === remembered.chapterCardId
    );
    if (rememberedChapter) {
      return (
        createLongChapterSelection(
          book,
          index,
          rememberedChapter.chapterCardId,
          undefined,
          remembered.preferredRole === "card" ? "card" : "body"
        ) ?? null
      );
    }
  }
  const firstChapter = index.chapters[0];
  if (firstChapter) {
    return (
      createLongChapterSelection(
        book,
        index,
        firstChapter.chapterCardId,
        undefined,
        "body"
      ) ?? null
    );
  }
  return null;
}
