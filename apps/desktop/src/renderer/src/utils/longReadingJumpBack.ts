export interface LongReadingJumpAnchor {
  bookId: string;
  fileId: string;
  title: string;
  selectionStart: number;
  selectionEnd: number;
  scrollTop: number;
}

export function captureTextareaJumpAnchor(params: {
  bookId: string;
  fileId: string;
  title: string;
  textarea: HTMLTextAreaElement | null;
}): LongReadingJumpAnchor {
  const { bookId, fileId, title, textarea } = params;
  const selectionStart = Math.max(0, textarea?.selectionStart ?? 0);
  const selectionEnd = Math.max(selectionStart, textarea?.selectionEnd ?? 0);
  const scrollTop = Math.max(0, Math.round(textarea?.scrollTop ?? 0));
  return {
    bookId,
    fileId,
    title,
    selectionStart,
    selectionEnd,
    scrollTop
  };
}

export function applyTextareaJumpAnchor(
  textarea: HTMLTextAreaElement | null,
  anchor: Pick<
    LongReadingJumpAnchor,
    "selectionStart" | "selectionEnd" | "scrollTop"
  >
): boolean {
  if (!textarea) {
    return false;
  }
  const maxOffset = textarea.value.length;
  const start = Math.max(0, Math.min(anchor.selectionStart, maxOffset));
  const end = Math.max(start, Math.min(anchor.selectionEnd, maxOffset));
  textarea.focus({ preventScroll: true });
  textarea.setSelectionRange(start, end);
  textarea.scrollTop = Math.max(0, anchor.scrollTop);
  return true;
}

export function isJumpAnchorReturnable(
  anchor: LongReadingJumpAnchor | null,
  bookId: string,
  currentFileId: string | null
): anchor is LongReadingJumpAnchor {
  return (
    anchor !== null &&
    anchor.bookId === bookId &&
    Boolean(anchor.fileId) &&
    anchor.fileId !== currentFileId
  );
}
