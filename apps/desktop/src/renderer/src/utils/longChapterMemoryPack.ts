import type { LongWorkspaceIndexSnapshot } from "@writer/contracts";

export interface LongChapterMemorySummary {
  currentChapterCardId: string | null;
  currentChapterTitle: string;
  currentCardFileId: string | null;
  currentBodyFileId: string | null;
  isPendingArchive: boolean;
  isCommitted: boolean;
  previousChapterTitle: string | null;
  previousHandoffFileId: string | null;
  openForeshadowings: Array<{
    id: string;
    title: string;
    status: string;
  }>;
  characterCount: number;
  worldbuildingCategoryCount: number;
}

export interface BookMemoryTemplateSnippet {
  id: string;
  labelZh: string;
  labelEn: string;
  contentZh: string;
  contentEn: string;
}

export const BOOK_MEMORY_SNIPPETS: readonly BookMemoryTemplateSnippet[] = [
  {
    id: "voice-and-banned-words",
    labelZh: "+ 文风与禁词",
    labelEn: "+ Voice & Avoid List",
    contentZh:
      "\n## 文风与禁词约定\n- 叙述基调：克制、有画面感，避免空泛总结句和过度解释人物心理。\n- 尽量少用/避免：不由得、赫然、嘴角勾起一抹弧度、眼神一凛。\n",
    contentEn:
      "\n## Voice & Avoid List\n- Tone: restrained, concrete imagery; avoid summarizing emotions the scene already shows.\n- Avoid overused filler phrases.\n"
  },
  {
    id: "character-voice-lines",
    labelZh: "+ 人物口癖与底线",
    labelEn: "+ Character Voice & Lines",
    contentZh:
      "\n## 人物口癖与行为红线\n- 主角说话简短，面对质疑先反问而不急于自证。\n- 任何角色不得在缺乏信息来源的情况下提前得知未揭露的秘密。\n",
    contentEn:
      "\n## Character Voice & Red Lines\n- Keep dialogue distinct per character.\n- Characters never act on secrets they have not yet learned in-story.\n"
  },
  {
    id: "pov-and-suspense",
    labelZh: "+ 视角与悬念边界",
    labelEn: "+ POV & Suspense Boundary",
    contentZh:
      "\n## 视角与悬念边界\n- 严格遵守当前章单一视角，不切全知上帝视角。\n- 允许读者先于主角察觉异常，但不要替主角提前说破真相。\n",
    contentEn:
      "\n## POV & Suspense Boundary\n- Stay strictly inside the active POV character.\n- Let the reader notice clues before the POV character states the answer aloud.\n"
  }
];

export function buildLongChapterMemorySummary(
  index: LongWorkspaceIndexSnapshot | null,
  activeChapterCardId: string | null
): LongChapterMemorySummary {
  if (!index) {
    return {
      currentChapterCardId: null,
      currentChapterTitle: "",
      currentCardFileId: null,
      currentBodyFileId: null,
      isPendingArchive: false,
      isCommitted: false,
      previousChapterTitle: null,
      previousHandoffFileId: null,
      openForeshadowings: [],
      characterCount: 0,
      worldbuildingCategoryCount: 0
    };
  }

  const orderedCards = [...index.plot.chapterCards].sort((a, b) => {
    const volA =
      index.plot.volumes.find((v) => v.id === a.volumeId)?.order ?? 0;
    const volB =
      index.plot.volumes.find((v) => v.id === b.volumeId)?.order ?? 0;
    if (volA !== volB) return volA - volB;
    return a.narrativeOrder - b.narrativeOrder;
  });

  const activeIdx = activeChapterCardId
    ? orderedCards.findIndex((c) => c.id === activeChapterCardId)
    : -1;
  const activeCard = activeIdx >= 0 ? orderedCards[activeIdx] : undefined;
  const activeChapter = activeCard
    ? index.chapters.find((ch) => ch.chapterCardId === activeCard.id)
    : undefined;

  const prevCard = activeIdx > 0 ? orderedCards[activeIdx - 1] : undefined;
  const prevChapter = prevCard
    ? index.chapters.find((ch) => ch.chapterCardId === prevCard.id)
    : undefined;

  const openForeshadowings = (index.plot.foreshadowing ?? [])
    .filter((item) => item.status !== "resolved" && item.status !== "abandoned")
    .slice(0, 8)
    .map((item) => ({
      id: item.id,
      title: item.title,
      status: item.status
    }));

  const isCommitted = Boolean(activeChapter?.commitId);
  const isPendingArchive =
    Boolean(activeChapter) &&
    activeChapter?.bodyStatus === "written" &&
    !isCommitted;

  return {
    currentChapterCardId: activeCard?.id ?? null,
    currentChapterTitle: activeCard?.title ?? "",
    currentCardFileId: activeChapter?.card.id ?? null,
    currentBodyFileId: activeChapter?.body.id ?? null,
    isPendingArchive,
    isCommitted,
    previousChapterTitle: prevCard?.title ?? null,
    previousHandoffFileId: prevChapter?.handoff.id ?? null,
    openForeshadowings,
    characterCount: index.characters.length,
    worldbuildingCategoryCount: index.worldbuilding.length
  };
}
