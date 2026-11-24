import {
  LONG_CHAPTER_NOTE_CONTEXT_MAX_CHARS,
  LONG_CHAPTER_NOTE_QUOTE_MAX_CHARS,
  type LongChapterNoteQuote,
  type LongFileId
} from "@writer/contracts";

export type ChapterNoteAnchorResolution =
  | {
      status: "exact";
      start: number;
      end: number;
      shifted: boolean;
    }
  | {
      status: "ambiguous";
      matches: Array<{ start: number; end: number }>;
    }
  | {
      status: "missing";
    };

function clipPrefix(text: string, maxUtf16Units: number): string {
  if (text.length <= maxUtf16Units) return text;
  let start = text.length - maxUtf16Units;
  // Avoid starting in the middle of a UTF-16 surrogate pair.
  if (start > 0) {
    const code = text.charCodeAt(start);
    if (code >= 0xdc00 && code <= 0xdfff) {
      start += 1;
    }
  }
  return text.slice(start);
}

function clipSuffix(text: string, maxUtf16Units: number): string {
  if (text.length <= maxUtf16Units) return text;
  let end = maxUtf16Units;
  // Avoid ending in the middle of a UTF-16 surrogate pair.
  if (end > 0) {
    const code = text.charCodeAt(end - 1);
    if (code >= 0xd800 && code <= 0xdbff) {
      end -= 1;
    }
  }
  return text.slice(0, end);
}

export function captureChapterNoteQuote(params: {
  fileId: LongFileId;
  documentText: string;
  selectionStart: number;
  selectionEnd: number;
  sourceUpdatedAt?: string;
}): LongChapterNoteQuote | null {
  const { documentText, fileId, sourceUpdatedAt } = params;
  const maxOffset = documentText.length;
  const start = Math.max(0, Math.min(params.selectionStart, maxOffset));
  const end = Math.max(start, Math.min(params.selectionEnd, maxOffset));
  const rawSelection = documentText.slice(start, end);
  const trimmed = rawSelection.trim();
  if (!trimmed) return null;

  const leadingWhitespace =
    rawSelection.length - rawSelection.trimStart().length;
  const effectiveStart = start + leadingWhitespace;
  const excerpt = clipSuffix(trimmed, LONG_CHAPTER_NOTE_QUOTE_MAX_CHARS);
  const effectiveEnd = Math.min(maxOffset, effectiveStart + excerpt.length);

  const prefixContext = clipPrefix(
    documentText.slice(Math.max(0, effectiveStart - 160), effectiveStart),
    LONG_CHAPTER_NOTE_CONTEXT_MAX_CHARS
  );
  const suffixContext = clipSuffix(
    documentText.slice(effectiveEnd, Math.min(maxOffset, effectiveEnd + 160)),
    LONG_CHAPTER_NOTE_CONTEXT_MAX_CHARS
  );

  return {
    fileId,
    excerpt,
    prefixContext,
    suffixContext,
    offset: effectiveStart,
    ...(sourceUpdatedAt ? { sourceUpdatedAt } : {})
  };
}

function findAllOccurrences(text: string, needle: string): number[] {
  if (!needle) return [];
  const positions: number[] = [];
  let cursor = 0;
  while (cursor <= text.length - needle.length) {
    const idx = text.indexOf(needle, cursor);
    if (idx < 0) break;
    positions.push(idx);
    cursor = idx + 1;
  }
  return positions;
}

function sharedSuffixLength(a: string, b: string): number {
  let i = 0;
  while (
    i < a.length &&
    i < b.length &&
    a[a.length - 1 - i] === b[b.length - 1 - i]
  ) {
    i += 1;
  }
  return i;
}

function sharedPrefixLength(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) {
    i += 1;
  }
  return i;
}

export function resolveChapterNoteQuote(
  documentText: string,
  quote: LongChapterNoteQuote
): ChapterNoteAnchorResolution {
  const { excerpt, offset, prefixContext, suffixContext } = quote;
  if (!excerpt) return { status: "missing" };

  const occurrences = findAllOccurrences(documentText, excerpt);
  if (occurrences.length === 0) {
    return { status: "missing" };
  }
  if (occurrences.length === 1) {
    const start = occurrences[0]!;
    return {
      status: "exact",
      start,
      end: start + excerpt.length,
      shifted: start !== offset
    };
  }

  // Multiple occurrences exist: always score every occurrence (including the
  // original offset) against surrounding context so a duplicate inserted at the
  // old offset cannot shadow the real moved quote.
  const scored = occurrences.map((start) => {
    const end = start + excerpt.length;
    const before = documentText.slice(
      Math.max(0, start - prefixContext.length),
      start
    );
    const after = documentText.slice(
      end,
      Math.min(documentText.length, end + suffixContext.length)
    );
    const score =
      sharedSuffixLength(before, prefixContext) +
      sharedPrefixLength(after, suffixContext);
    return { start, end, score };
  });

  scored.sort((a, b) => b.score - a.score);
  const best = scored[0]!;
  const second = scored[1]!;

  // Require a clear context advantage (at least 4 matching surrounding chars over runner-up).
  if (best.score >= 4 && best.score - second.score >= 4) {
    return {
      status: "exact",
      start: best.start,
      end: best.end,
      shifted: best.start !== offset
    };
  }

  return {
    status: "ambiguous",
    matches: occurrences.map((start) => ({
      start,
      end: start + excerpt.length
    }))
  };
}
