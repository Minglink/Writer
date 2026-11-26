import { nextTick } from "vue";
import type {
  LongWebNovelPacingMode,
  ShortWebNovelPacingMode
} from "@writer/contracts";
import { resolveLongBookFrameworkPreset } from "@writer/contracts/renderer";
import { activeWorkspaceControlPorts } from "../extras/external-control/useExternalControlBridge";
import { locale } from "../i18n";
import { useLayoutStore } from "../stores/layoutStore";
import { useSettingsStore } from "../stores/settingsStore";
import { uiMessage } from "../ui-feedback";
import { genreLabel } from "./genreLabels";
import { writingContextCoCreationT } from "./writingContextCoCreationMessages";

export type CoCreationWorkspaceType = "long" | "short" | "script" | "mystery";

export interface BookPositioningSnapshot {
  readonly genre: string;
  readonly pacingMode?:
    LongWebNovelPacingMode | ShortWebNovelPacingMode | null | undefined;
  readonly tropes?: readonly string[] | undefined;
}

export interface BuildPositioningTransitionPromptInput {
  readonly bookType: "long" | "short";
  readonly before: BookPositioningSnapshot;
  readonly after: BookPositioningSnapshot;
  readonly transitionNote?: string | undefined;
}

export interface HandoffWritingContextToAgentInput {
  readonly bookId: string;
  readonly workspaceType: CoCreationWorkspaceType;
  readonly prompt?: string | undefined;
}

export type HandoffWritingContextResult = "sent" | "prefilled" | "unavailable";

const ZH_PACING_LABELS: Readonly<
  Record<LongWebNovelPacingMode | ShortWebNovelPacingMode, string>
> = {
  fanqie: "番茄快节奏（免费算法流）",
  qidian: "起点长线精品（付费订阅流）",
  jinjiang: "晋江人设情感（女频精品/IP流）",
  viral_short: "盐选/番茄爆款短篇（强钩子强反转）",
  refined_short: "精品叙事短篇（重质感与余韵）"
};

const EN_PACING_LABELS: Readonly<
  Record<LongWebNovelPacingMode | ShortWebNovelPacingMode, string>
> = {
  fanqie: "Fast-Paced Hook-Driven (Fanqie / Free-to-Read)",
  qidian: "Long-Form World & Arc Progression (Qidian / Subscription)",
  jinjiang: "Character & Emotional Chemistry (Jinjiang / Character-Driven)",
  viral_short: "High-Hook Twist Short (Viral Short)",
  refined_short: "Literary & Resonant Short (Refined Narrative)"
};

const pause = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

async function waitWithTimeout(
  task: Promise<unknown>,
  timeoutMs: number
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      task.catch(() => undefined),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, timeoutMs);
      })
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function normalizeTropes(tropes: readonly string[] | undefined): string[] {
  if (!tropes?.length) return [];
  const unique = new Set<string>();
  for (const raw of tropes) {
    const cleaned = raw.trim();
    if (cleaned) unique.add(cleaned);
  }
  return [...unique];
}

function formatPacingLabel(
  mode: LongWebNovelPacingMode | ShortWebNovelPacingMode | null | undefined,
  isEn: boolean
): string {
  if (!mode) {
    return isEn ? "Unset (Default)" : "未指定（默认）";
  }
  return isEn ? EN_PACING_LABELS[mode] : ZH_PACING_LABELS[mode];
}

function focusComposer(): void {
  if (typeof document === "undefined") return;
  const focusNow = () => {
    const textarea = document.querySelector<HTMLTextAreaElement>(
      ".composer-input-surface textarea, .composer textarea"
    );
    if (textarea && !textarea.disabled) {
      textarea.focus();
    }
  };
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(focusNow);
  } else {
    focusNow();
  }
}

export function buildWritingContextCoCreationPrompt(
  workspaceType: CoCreationWorkspaceType
): string {
  if (locale.value === "en-US") {
    const targetName =
      workspaceType === "long"
        ? "this serialized novel"
        : workspaceType === "short"
          ? "this short story"
          : workspaceType === "script"
            ? "this screenplay"
            : "this mystery game";
    return [
      `Please read the current \`AGENTS.md\` creative context along with the structure and progress of ${targetName} so we can co-create and refine its writing guidelines:`,
      "1. Keep all existing manuscript chapters/scenes, character profiles, and saved worldbuilding/truth documents strictly untouched.",
      "2. Based on current project progress, discuss creative direction, style guardrails, or stage rules that can be clarified or added in `AGENTS.md`.",
      "3. Preserve any custom hand-written author rules, and submit any `AGENTS.md` modifications as a reviewable Diff proposal card for my confirmation."
    ].join("\n");
  }

  const targetName =
    workspaceType === "long"
      ? "这部连载长篇"
      : workspaceType === "short"
        ? "这篇短篇小说"
        : workspaceType === "script"
          ? "这部剧本"
          : "这部剧本杀作品";
  return [
    `请先完整读取${targetName}当前的 \`AGENTS.md\` 创作上下文与作品结构/创作进度，与我共创梳理和优化创作约定：`,
    "1. 既往已写正文/分场、已有角色档案与已落盘世界观/真相设定严禁改动；",
    "2. 结合当前作品进度，指出 `AGENTS.md` 中可补充、细化或对齐的创作方向、文风约束与阶段重点，并先与我讨论确认；",
    "3. 需要修改 `AGENTS.md` 时，请保留我手写的自定义要求，并以可审阅的 Diff 修改提案卡片提交，待我确认后再执行后续调整。"
  ].join("\n");
}

export function buildPositioningTransitionPrompt(
  input: BuildPositioningTransitionPromptInput
): string {
  const isEn = locale.value === "en-US";
  const beforeGenreRaw = input.before.genre.trim();
  const afterGenreRaw = input.after.genre.trim();
  const beforeGenreDisplay = isEn ? genreLabel(beforeGenreRaw) : beforeGenreRaw;
  const afterGenreDisplay = isEn ? genreLabel(afterGenreRaw) : afterGenreRaw;
  const genreChanged = beforeGenreRaw !== afterGenreRaw;

  const beforePacingMode = input.before.pacingMode ?? null;
  const afterPacingMode = input.after.pacingMode ?? null;
  const beforePacingDisplay = formatPacingLabel(beforePacingMode, isEn);
  const afterPacingDisplay = formatPacingLabel(afterPacingMode, isEn);
  const pacingChanged = beforePacingMode !== afterPacingMode;

  const beforeTropes = normalizeTropes(input.before.tropes);
  const afterTropes = normalizeTropes(input.after.tropes);
  const beforeSet = new Set(beforeTropes);
  const afterSet = new Set(afterTropes);
  const addedTropes = afterTropes.filter((tag) => !beforeSet.has(tag));
  const removedTropes = beforeTropes.filter((tag) => !afterSet.has(tag));
  const retainedTropes = afterTropes.filter((tag) => beforeSet.has(tag));

  const transitionNote = input.transitionNote?.trim();

  if (isEn) {
    const genreLine = genreChanged
      ? `${beforeGenreDisplay} → ${afterGenreDisplay}`
      : `${afterGenreDisplay} (unchanged)`;
    const pacingLine = pacingChanged
      ? `${beforePacingDisplay} → ${afterPacingDisplay}`
      : `${afterPacingDisplay} (unchanged)`;
    const beforeTropesText = beforeTropes.length
      ? beforeTropes.join(", ")
      : "None";
    const afterTropesText = afterTropes.length
      ? afterTropes.join(", ")
      : "None";
    const addedText = addedTropes.length
      ? addedTropes.map((tag) => `+${tag}`).join(", ")
      : "None";
    const removedText = removedTropes.length
      ? removedTropes.map((tag) => `-${tag}`).join(", ")
      : "None";
    const retainedText = retainedTropes.length
      ? retainedTropes.join(", ")
      : "None";

    const positioningLines = [
      "[Original Positioning → New Positioning]",
      `- Work Type: ${input.bookType === "long" ? "Serialized Long-Form Novel" : "Short Story"}`,
      `- Genre: ${genreLine}`,
      `- Serial Pacing: ${pacingLine}`,
      `- Trope Tags: ${beforeTropesText} → ${afterTropesText} (Added: ${addedText}; Removed: ${removedText}; Retained: ${retainedText})`
    ];

    if (input.bookType === "long") {
      const preset = resolveLongBookFrameworkPreset(afterGenreRaw);
      const categories = preset.worldCategories
        .map(([, title]) => title)
        .join(", ");
      positioningLines.push(
        `- Target Genre Framework Preset: ${preset.name}`,
        `  - 7 Worldbuilding Categories: ${categories}`,
        `  - Core Drive: ${preset.coreDrive}`
      );
    }

    const sections = [
      "I just updated this work's web-novel positioning. Please help me smoothly transition the creative context:",
      positioningLines.join("\n")
    ];

    if (transitionNote) {
      sections.push(`[Author Transition & Tuning Note]\n${transitionNote}`);
    }

    sections.push(
      [
        "[Strict Execution Requirements]",
        "1. Do NOT modify any already-written manuscript chapters/sections, existing character profiles, or saved worldbuilding documents.",
        "2. Read the current `AGENTS.md` and storyline / latest chapter progress first, preserve the author's custom hand-written rules, and submit a smooth-transition `AGENTS.md` modification proposal (Diff review card) integrating the new positioning with continuity constraints between existing and upcoming chapters.",
        "3. Based on current progress, provide concrete transition suggestions in your reply on how upcoming chapters/sections can pivot naturally into the new direction (and whether any missing worldbuilding categories or next-chapter hooks should be incrementally added), waiting for my confirmation before any further edits."
      ].join("\n")
    );

    return sections.join("\n\n");
  }

  const genreLine = genreChanged
    ? `${beforeGenreDisplay} → ${afterGenreDisplay}`
    : `${afterGenreDisplay}（保持不变）`;
  const pacingLine = pacingChanged
    ? `${beforePacingDisplay} → ${afterPacingDisplay}`
    : `${afterPacingDisplay}（保持不变）`;
  const beforeTropesText = beforeTropes.length ? beforeTropes.join("、") : "无";
  const afterTropesText = afterTropes.length ? afterTropes.join("、") : "无";
  const addedText = addedTropes.length
    ? addedTropes.map((tag) => `+${tag}`).join("、")
    : "无";
  const removedText = removedTropes.length
    ? removedTropes.map((tag) => `-${tag}`).join("、")
    : "无";
  const retainedText = retainedTropes.length ? retainedTropes.join("、") : "无";

  const positioningLines = [
    "【原定位 → 新定位】",
    `- 作品形态：${input.bookType === "long" ? "长篇小说" : "短篇小说"}`,
    `- 题材分类：${genreLine}`,
    `- 连载/叙事风向：${pacingLine}`,
    `- 流派标签变化：${beforeTropesText} → ${afterTropesText}（新增：${addedText}；移除：${removedText}；保留：${retainedText}）`
  ];

  if (input.bookType === "long") {
    const preset = resolveLongBookFrameworkPreset(afterGenreRaw);
    const categories = preset.worldCategories
      .map(([, title]) => title)
      .join("、");
    positioningLines.push(
      `- 目标题材长篇框架参考：${preset.name}`,
      `  - 七维世界观分类：${categories}`,
      `  - 核心驱动：${preset.coreDrive}`
    );
  }

  const sections = [
    "我刚调整了当前作品的网文定位，请协助我平滑过渡创作上下文：",
    positioningLines.join("\n")
  ];

  if (transitionNote) {
    sections.push(`【作者转型与微调说明】\n${transitionNote}`);
  }

  sections.push(
    [
      "【严格执行要求】",
      "1. 既往已写正文、已有角色档案与已落盘世界观内容严禁改动；",
      "2. 请先读取当前 `AGENTS.md` 以及主线剧情/最新章节进度，完整保留我手写的自定义规则，将新定位与新旧章节衔接约束融合整理后，提交一份平滑过渡版的 `AGENTS.md` 修改提案（Diff 审阅卡片）；",
      "3. 结合当前创作进度，在回复中给出后续章节/小节如何自然转向新风向与流派卖点的具体衔接建议（如是否需渐进补充世界观分类或下一章钩子），待我确认后再做进一步调整。"
    ].join("\n")
  );

  return sections.join("\n\n");
}

export async function handoffWritingContextToAgent(
  input: HandoffWritingContextToAgentInput
): Promise<HandoffWritingContextResult> {
  const ports = activeWorkspaceControlPorts;
  if (!ports) {
    uiMessage.warning(writingContextCoCreationT("handoffWorkspaceUnavailable"));
    return "unavailable";
  }

  const opened = await ports.open(
    { kind: input.workspaceType, id: input.bookId },
    { preserveSelection: true }
  );
  if (!opened) {
    uiMessage.warning(writingContextCoCreationT("handoffWorkspaceUnavailable"));
    return "unavailable";
  }

  const layoutStore = useLayoutStore();
  const settingsStore = useSettingsStore();
  layoutStore.showWorkspace();
  if (settingsStore.generalSettings.workspacePaneLayout === "editor-agent") {
    layoutStore.setPaneCollapsed("right", false);
  }
  await nextTick();

  await waitWithTimeout(ports.conversationsRestored(), 3_000);

  let conversation = ports.conversation();
  if (!conversation) {
    await nextTick();
    conversation = ports.conversation();
  }
  if (!conversation && ports.api()) {
    for (let attempt = 0; attempt < 20 && !conversation; attempt += 1) {
      await pause(40);
      conversation = ports.conversation();
    }
  }
  if (!conversation) {
    uiMessage.warning(writingContextCoCreationT("handoffWorkspaceUnavailable"));
    return "unavailable";
  }

  if (!ports.sendReady() && ports.api()) {
    await nextTick();
    for (let attempt = 0; attempt < 10 && !ports.sendReady(); attempt += 1) {
      await pause(40);
    }
  }

  const prompt =
    input.prompt?.trim() ||
    buildWritingContextCoCreationPrompt(input.workspaceType);

  const selectedModelId = conversation.selectedModelId?.value ?? "";
  const configuredModels = conversation.configuredModels?.value ?? [];
  const hasActiveModel = Boolean(
    selectedModelId &&
    configuredModels.some(
      (model) => model.id === selectedModelId && model.enabled !== false
    )
  );
  const isBusyOrBlocked = Boolean(
    conversation.isBusy?.value || conversation.hasPendingEditReview?.value
  );
  const canAutoSend = Boolean(
    ports.api() && ports.sendReady() && hasActiveModel && !isBusyOrBlocked
  );

  if (canAutoSend) {
    const beforeCount = conversation.messages.value.length;
    conversation.draft.value = prompt;
    await nextTick();
    await ports.send();
    if (conversation.messages.value.length > beforeCount) {
      focusComposer();
      return "sent";
    }
    if (!conversation.draft.value) {
      conversation.draft.value = prompt;
    }
    uiMessage.info(writingContextCoCreationT("handoffDraftPrefilled"));
    focusComposer();
    return "prefilled";
  }

  conversation.draft.value = prompt;
  uiMessage.info(writingContextCoCreationT("handoffDraftPrefilled"));
  focusComposer();
  return "prefilled";
}
