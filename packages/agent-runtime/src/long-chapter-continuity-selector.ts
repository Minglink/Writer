import {
  longLedgerCommitChapterIds,
  longLedgerCommitCheckpointChapterId,
  type LongLedgerCommitIndexEntry,
  type LongWorkspaceIndexSnapshot
} from "@writer/contracts";

export interface OrderedChapterCardEntry {
  chapterCardId: string;
  title: string;
  narrativeIndex: number;
  chapter: LongWorkspaceIndexSnapshot["chapters"][number];
}

export interface LongChapterContinuitySelection {
  target: OrderedChapterCardEntry;
  /** Immediately preceding chapter in narrative order, if any. */
  immediatePrevious?: OrderedChapterCardEntry;
  /** Closest strictly earlier chapter whose body is written, if any. */
  latestWrittenPrior?: OrderedChapterCardEntry;
  /** Unwritten chapter ids strictly between `latestWrittenPrior` and `target`. */
  unwrittenGapChapterIds: string[];
  /**
   * Batch commit covering the target chapter whose checkpoint is at or after
   * the target. Its checkpoint handoff must NEVER be treated as prior context.
   */
  coveringBatchCommit?: {
    commit: LongLedgerCommitIndexEntry;
    checkpointChapterCardId: string;
    chapterCardIds: string[];
  };
  /**
   * Most recent ledger commit whose checkpoint is strictly earlier than the
   * target chapter.
   */
  priorCheckpoint?: {
    commit: LongLedgerCommitIndexEntry;
    checkpoint: OrderedChapterCardEntry;
    /** True when any chapter in this commit was edited after archiving. */
    staleDueToBodyChanges: boolean;
    changedChapterIds: string[];
    /** Written chapters strictly between this checkpoint and target that are not yet committed. */
    uncommittedIntermediateChapterIds: string[];
    /** True only when safe to inject the checkpoint's handoff as prior summary. */
    handoffUsable: boolean;
  };
}

export function orderedLongChapterEntries(
  index: LongWorkspaceIndexSnapshot
): OrderedChapterCardEntry[] {
  const volumeOrder = new Map(
    index.plot.volumes.map((volume) => [volume.id, volume.order])
  );
  const chapterById = new Map(
    index.chapters.map((chapter) => [chapter.chapterCardId, chapter])
  );
  const sortedCards = [...index.plot.chapterCards].sort(
    (left, right) =>
      (volumeOrder.get(left.volumeId) ?? Number.MAX_SAFE_INTEGER) -
        (volumeOrder.get(right.volumeId) ?? Number.MAX_SAFE_INTEGER) ||
      left.narrativeOrder - right.narrativeOrder ||
      left.id.localeCompare(right.id)
  );
  const ordered: OrderedChapterCardEntry[] = [];
  for (const card of sortedCards) {
    const chapter = chapterById.get(card.id);
    if (!chapter) continue;
    ordered.push({
      chapterCardId: card.id,
      title: card.title,
      narrativeIndex: ordered.length,
      chapter
    });
  }
  return ordered;
}

/**
 * Selects strictly-prior continuity checkpoints and preceding written chapters
 * for a target chapter, guarding against intermediate batch chapters and
 * post-commit manuscript rewrites.
 */
export function selectApplicableContinuityCheckpoint(
  index: LongWorkspaceIndexSnapshot,
  targetChapterCardId: string
): LongChapterContinuitySelection | undefined {
  const ordered = orderedLongChapterEntries(index);
  const byId = new Map(ordered.map((entry) => [entry.chapterCardId, entry]));
  const target = byId.get(targetChapterCardId);
  if (!target) return undefined;

  const immediatePrevious =
    target.narrativeIndex > 0 ? ordered[target.narrativeIndex - 1] : undefined;

  let latestWrittenPrior: OrderedChapterCardEntry | undefined;
  const unwrittenGapChapterIds: string[] = [];
  for (let i = target.narrativeIndex - 1; i >= 0; i -= 1) {
    const candidate = ordered[i]!;
    if (candidate.chapter.bodyStatus === "written") {
      latestWrittenPrior = candidate;
      break;
    }
    unwrittenGapChapterIds.unshift(candidate.chapterCardId);
  }

  let coveringBatchCommit: LongChapterContinuitySelection["coveringBatchCommit"];
  let bestPrior:
    | {
        commit: LongLedgerCommitIndexEntry;
        checkpoint: OrderedChapterCardEntry;
      }
    | undefined;

  for (const commit of index.ledger.commits) {
    const chapterIds = longLedgerCommitChapterIds(commit);
    const checkpointId = longLedgerCommitCheckpointChapterId(commit);
    const checkpoint = byId.get(checkpointId);
    if (!checkpoint) continue;

    if (
      chapterIds.includes(targetChapterCardId) &&
      checkpoint.narrativeIndex >= target.narrativeIndex
    ) {
      coveringBatchCommit = {
        commit,
        checkpointChapterCardId: checkpointId,
        chapterCardIds: chapterIds
      };
    }

    if (checkpoint.narrativeIndex < target.narrativeIndex) {
      if (
        !bestPrior ||
        checkpoint.narrativeIndex > bestPrior.checkpoint.narrativeIndex ||
        (checkpoint.narrativeIndex === bestPrior.checkpoint.narrativeIndex &&
          commit.sequence > bestPrior.commit.sequence)
      ) {
        bestPrior = { commit, checkpoint };
      }
    }
  }

  let priorCheckpoint: LongChapterContinuitySelection["priorCheckpoint"];
  if (bestPrior) {
    const changedChapterIds = [...(bestPrior.commit.changedChapterIds ?? [])];
    const staleDueToBodyChanges = changedChapterIds.length > 0;
    const uncommittedIntermediateChapterIds: string[] = [];
    for (
      let i = bestPrior.checkpoint.narrativeIndex + 1;
      i < target.narrativeIndex;
      i += 1
    ) {
      const candidate = ordered[i]!;
      if (
        candidate.chapter.bodyStatus === "written" &&
        candidate.chapter.commitId === null
      ) {
        uncommittedIntermediateChapterIds.push(candidate.chapterCardId);
      }
    }
    priorCheckpoint = {
      commit: bestPrior.commit,
      checkpoint: bestPrior.checkpoint,
      staleDueToBodyChanges,
      changedChapterIds,
      uncommittedIntermediateChapterIds,
      handoffUsable: !staleDueToBodyChanges
    };
  }

  return {
    target,
    ...(immediatePrevious ? { immediatePrevious } : {}),
    ...(latestWrittenPrior ? { latestWrittenPrior } : {}),
    unwrittenGapChapterIds,
    ...(coveringBatchCommit ? { coveringBatchCommit } : {}),
    ...(priorCheckpoint ? { priorCheckpoint } : {})
  };
}
