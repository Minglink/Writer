<script setup lang="ts">
import { computed, ref, shallowRef, watch } from "vue";
import {
  LONG_BOOK_GENRE_CHANNELS,
  LONG_WEB_NOVEL_PACING_MODES,
  SCRIPT_BOOK_GENRES,
  SHORT_BOOK_GENRE_CHANNELS,
  SHORT_WEB_NOVEL_PACING_MODES,
  WEB_NOVEL_CHANNEL_TROPES,
  resolveLongBookFrameworkPreset,
  type BookGenreChannel,
  type LongWebNovelPacingMode,
  type ScriptBook,
  type ScriptBookGenre,
  type ShortBook,
  type ShortBookGenre,
  type ShortWebNovelPacingMode
} from "@writer/contracts/renderer";
import {
  longCraftT,
  resolveShortWebNovelBlueprint
} from "../data/longWebNovelCraft";
import {
  createScopedTranslator,
  locale,
  registerFeatureMessages
} from "../i18n";
import { formatError } from "../i18n/errors";
import { getAcademicLifecyclePort } from "../stores/academicWorkspaceDialog";
import { useCatalogIndexStore } from "../stores/catalogIndexStore";
import { useLongWorkspaceStore } from "../stores/longWorkspaceStore";
import {
  replaceLongBookSummary,
  resolveLongWorkspaceApi
} from "../types/longWorkspace";
import { uiMessage } from "../ui-feedback";
import { genreLabel } from "./genreLabels";
import {
  buildPositioningTransitionPrompt,
  handoffWritingContextToAgent,
  type BookPositioningSnapshot
} from "./writingContextCoCreationHandoff";

const MAX_TROPES = 6;

const bookT = createScopedTranslator("components.createBookDialog");
const panelT = registerFeatureMessages("components.bookPositioningPanel", {
  "zh-CN": {
    loadingPositioning: "正在读取作品定位…",
    shortGenreLabel: "短篇题材",
    scriptGenreLabel: "剧本题材",
    currentGenreBadge: "当前题材：{genre}",
    tropesHeading: "热门流派 · 人设 · 情节标签（可选，最多 6 项）",
    tropesSelectedCount: "已选 {count}/6",
    tropeLimitReached: "最多选择 6 个流派标签，保持主线聚焦不杂糅",
    frameworkPresetLabel: "适配框架",
    frameworkCoreDriveLabel: "核心驱动",
    categorySeparator: " · ",
    transitionNoteLabel: "转型与微调备注（选填）",
    transitionNotePlaceholder:
      "例如：从下一章进秘境副本开始切入规则怪谈风，保留前期修仙境界与人物设定，不要改动已写章节…",
    transitionNoteHint:
      "既往已写正文、人物与设定将一字不动；智能体将结合此备注生成 AGENTS.md 平滑过渡 Diff 审阅卡与后续衔接建议。",
    saveGenre: "保存题材",
    savePositioningOnly: "仅保存定位",
    saveAndTransition: "保存并交由智能体平滑过渡",
    saving: "保存中…",
    transitioning: "正在交接智能体…",
    genreSaved: "剧本题材已保存",
    positioningSaved: "网文定位已保存",
    positioningUnavailable: "当前无法访问作品目录服务，请稍后重试。",
    saveFailed: "保存作品定位失败，请稍后重试。"
  },
  "en-US": {
    loadingPositioning: "Reading book positioning…",
    shortGenreLabel: "Short-story genre",
    scriptGenreLabel: "Screenplay genre",
    currentGenreBadge: "Current genre: {genre}",
    tropesHeading: "Tropes · Personas · Plot tags (optional, up to 6)",
    tropesSelectedCount: "{count}/6 selected",
    tropeLimitReached: "Select up to 6 trope tags to keep the premise focused",
    frameworkPresetLabel: "Preset",
    frameworkCoreDriveLabel: "Core drive",
    categorySeparator: " · ",
    transitionNoteLabel: "Transition & Tuning Note (Optional)",
    transitionNotePlaceholder:
      "e.g., Pivot into eerie rule-horror starting with the next realm arc while keeping earlier cultivation realms, characters, and completed chapters untouched…",
    transitionNoteHint:
      "Completed chapters, characters, and lore stay untouched; the agent will use this note to propose a reviewable AGENTS.md transition diff and continuity plan.",
    saveGenre: "Save Genre",
    savePositioningOnly: "Save Positioning Only",
    saveAndTransition: "Save & Smooth Transition with Agent",
    saving: "Saving…",
    transitioning: "Handing off to Agent…",
    genreSaved: "Screenplay genre saved",
    positioningSaved: "Web-novel positioning saved",
    positioningUnavailable:
      "Book catalog service is currently unavailable. Try again shortly.",
    saveFailed: "Could not save book positioning. Try again."
  }
});

const props = withDefaults(
  defineProps<{
    bookType: "long" | "short" | "script";
    bookId: string | null;
    book?: ShortBook | ScriptBook | null;
    disabled?: boolean;
    flushContext?: (() => Promise<boolean>) | undefined;
  }>(),
  {
    book: null,
    disabled: false,
    flushContext: undefined
  }
);

const emit = defineEmits<{
  requestClose: [];
}>();

const longWorkspaceStore = useLongWorkspaceStore();
const catalogIndexStore = useCatalogIndexStore();

const localSavedBook = shallowRef<ShortBook | ScriptBook | null>(null);
const saving = ref(false);
const savingAction = ref<"save-only" | "transition" | null>(null);
const handoffPending = ref(false);

const channel = ref<BookGenreChannel>("male");
const draftGenre = ref("");
const draftLongPacing = ref<LongWebNovelPacingMode | null>(null);
const draftShortPacing = ref<ShortWebNovelPacingMode | null>(null);
const draftTropes = ref<string[]>([]);
const transitionNote = ref("");

const targetLongSummary = computed(() => {
  if (props.bookType !== "long") return null;
  if (props.bookId) {
    return (
      longWorkspaceStore.longBooks.find((item) => item.id === props.bookId) ??
      (longWorkspaceStore.activeBookSummary?.id === props.bookId
        ? longWorkspaceStore.activeBookSummary
        : null)
    );
  }
  return longWorkspaceStore.activeBookSummary;
});

const catalogBook = computed<ShortBook | ScriptBook | null>(() => {
  if (props.bookType === "long" || !props.bookId) return null;
  const found = catalogIndexStore.snapshot?.books.find(
    (item) => item.id === props.bookId
  );
  if (
    found &&
    (found.bookType === "short" || found.bookType === "script") &&
    found.bookType === props.bookType
  ) {
    return found;
  }
  return null;
});

watch(
  () => [
    props.bookId,
    props.bookType,
    props.book?.id,
    props.book?.projectRevision,
    props.book?.updatedAt
  ],
  () => {
    localSavedBook.value = null;
  }
);

watch(catalogBook, (next, previous) => {
  if (next && next !== previous && !saving.value) {
    localSavedBook.value = null;
  }
});

const targetCreativeBook = computed<ShortBook | ScriptBook | null>(() => {
  if (props.bookType === "long") return null;
  const local =
    localSavedBook.value &&
    (!props.bookId || localSavedBook.value.id === props.bookId) &&
    localSavedBook.value.bookType === props.bookType
      ? localSavedBook.value
      : null;
  const fromCatalog = catalogBook.value;
  if (local && fromCatalog) {
    const localRev = local.projectRevision ?? -1;
    const catalogRev = fromCatalog.projectRevision ?? -1;
    return catalogRev >= localRev ? fromCatalog : local;
  }
  return (
    local ??
    fromCatalog ??
    (props.book && props.book.bookType === props.bookType ? props.book : null)
  );
});

const hasTargetBook = computed(() =>
  props.bookType === "long"
    ? targetLongSummary.value !== null
    : targetCreativeBook.value !== null
);

const savedGenre = computed(() => {
  if (props.bookType === "long") {
    return targetLongSummary.value?.genre ?? "";
  }
  return targetCreativeBook.value?.genre ?? "";
});

const savedLongPacing = computed<LongWebNovelPacingMode | null>(() =>
  props.bookType === "long"
    ? (targetLongSummary.value?.pacingMode ?? null)
    : null
);

const savedShortPacing = computed<ShortWebNovelPacingMode | null>(() =>
  props.bookType === "short" && targetCreativeBook.value?.bookType === "short"
    ? (targetCreativeBook.value.pacingMode ?? null)
    : null
);

const savedTropes = computed<readonly string[]>(() => {
  if (props.bookType === "long") {
    return targetLongSummary.value?.tropes ?? [];
  }
  if (
    props.bookType === "short" &&
    targetCreativeBook.value?.bookType === "short"
  ) {
    return targetCreativeBook.value.tropes ?? [];
  }
  return [];
});

function inferGenreChannel(
  bookType: "long" | "short",
  genre: string,
  pacingMode: LongWebNovelPacingMode | ShortWebNovelPacingMode | null
): BookGenreChannel {
  const channels: Record<BookGenreChannel, readonly string[]> =
    bookType === "long" ? LONG_BOOK_GENRE_CHANNELS : SHORT_BOOK_GENRE_CHANNELS;
  const inFemale = channels.female.includes(genre);
  const inMale = channels.male.includes(genre);
  if (
    (inFemale && !inMale) ||
    (inFemale && pacingMode === "jinjiang") ||
    (!inMale &&
      (LONG_BOOK_GENRE_CHANNELS.female as readonly string[]).includes(genre))
  ) {
    return "female";
  }
  return "male";
}

function sameStringArray(
  left: readonly string[],
  right: readonly string[]
): boolean {
  return (
    left.length === right.length &&
    left.every((item, index) => item === right[index])
  );
}

function positioningSignature(
  genre: string,
  pacing: string | null,
  tropes: readonly string[]
): string {
  return `${genre}\u0000${pacing ?? ""}\u0000${tropes.join("\u0001")}`;
}

let lastSyncedBookIdentity = "";
let lastSyncedSignature: string | null = null;

function currentSavedSignature(): string {
  const pacing =
    props.bookType === "long"
      ? savedLongPacing.value
      : props.bookType === "short"
        ? savedShortPacing.value
        : null;
  return positioningSignature(savedGenre.value, pacing, savedTropes.value);
}

function currentDraftSignature(): string {
  const pacing =
    props.bookType === "long"
      ? draftLongPacing.value
      : props.bookType === "short"
        ? draftShortPacing.value
        : null;
  return positioningSignature(draftGenre.value, pacing, draftTropes.value);
}

function syncDraftFromSaved(preserveChannel = false): void {
  if (!hasTargetBook.value) return;
  draftGenre.value = savedGenre.value;
  draftLongPacing.value = savedLongPacing.value;
  draftShortPacing.value = savedShortPacing.value;
  draftTropes.value = [...savedTropes.value];
  if (props.bookType !== "script") {
    const channels: Record<BookGenreChannel, readonly string[]> =
      props.bookType === "long"
        ? LONG_BOOK_GENRE_CHANNELS
        : SHORT_BOOK_GENRE_CHANNELS;
    if (
      !preserveChannel ||
      !channels[channel.value].includes(savedGenre.value)
    ) {
      channel.value = inferGenreChannel(
        props.bookType,
        savedGenre.value,
        props.bookType === "long"
          ? savedLongPacing.value
          : savedShortPacing.value
      );
    }
  }
  lastSyncedSignature = currentSavedSignature();
}

watch(
  () => {
    const resolvedId =
      props.bookId ??
      targetLongSummary.value?.id ??
      targetCreativeBook.value?.id ??
      "";
    return [
      `${props.bookType}:${resolvedId}`,
      hasTargetBook.value,
      currentSavedSignature()
    ] as const;
  },
  ([identity, loaded, savedSig]) => {
    if (identity !== lastSyncedBookIdentity) {
      lastSyncedBookIdentity = identity;
      lastSyncedSignature = null;
      transitionNote.value = "";
      if (loaded) {
        syncDraftFromSaved(false);
      }
      return;
    }
    if (!loaded) return;
    if (
      lastSyncedSignature === null ||
      currentDraftSignature() === lastSyncedSignature
    ) {
      syncDraftFromSaved(lastSyncedSignature !== null);
    } else {
      lastSyncedSignature = savedSig;
    }
  },
  { immediate: true }
);

const isDirty = computed(() => {
  if (!hasTargetBook.value) return false;
  if (props.bookType === "script") {
    return draftGenre.value !== savedGenre.value;
  }
  if (props.bookType === "long") {
    return (
      draftGenre.value !== savedGenre.value ||
      (draftLongPacing.value ?? null) !== (savedLongPacing.value ?? null) ||
      !sameStringArray(draftTropes.value, savedTropes.value)
    );
  }
  return (
    draftGenre.value !== savedGenre.value ||
    (draftShortPacing.value ?? null) !== (savedShortPacing.value ?? null) ||
    !sameStringArray(draftTropes.value, savedTropes.value)
  );
});

const controlsDisabled = computed(
  () => props.disabled || saving.value || handoffPending.value
);

const scriptGenreOptions = computed<readonly string[]>(() => {
  const current = savedGenre.value.trim();
  if (current && !(SCRIPT_BOOK_GENRES as readonly string[]).includes(current)) {
    return [current, ...SCRIPT_BOOK_GENRES];
  }
  return SCRIPT_BOOK_GENRES;
});

const displayedGenreOptions = computed<readonly string[]>(() => {
  if (props.bookType === "script") return scriptGenreOptions.value;
  return props.bookType === "long"
    ? LONG_BOOK_GENRE_CHANNELS[channel.value]
    : SHORT_BOOK_GENRE_CHANNELS[channel.value];
});

const showOutOfChannelGenreBadge = computed(
  () =>
    props.bookType !== "script" &&
    Boolean(draftGenre.value) &&
    !displayedGenreOptions.value.includes(draftGenre.value)
);

const LONG_PACING_KEYS: Readonly<
  Record<
    LongWebNovelPacingMode,
    {
      readonly label: "pacingFanqie" | "pacingQidian" | "pacingJinjiang";
      readonly desc:
        "pacingFanqieDesc" | "pacingQidianDesc" | "pacingJinjiangDesc";
    }
  >
> = {
  fanqie: { label: "pacingFanqie", desc: "pacingFanqieDesc" },
  qidian: { label: "pacingQidian", desc: "pacingQidianDesc" },
  jinjiang: { label: "pacingJinjiang", desc: "pacingJinjiangDesc" }
};

const SHORT_PACING_KEYS: Readonly<
  Record<
    ShortWebNovelPacingMode,
    {
      readonly label: "pacingViralShort" | "pacingRefinedShort";
      readonly desc: "pacingViralShortDesc" | "pacingRefinedShortDesc";
    }
  >
> = {
  viral_short: { label: "pacingViralShort", desc: "pacingViralShortDesc" },
  refined_short: {
    label: "pacingRefinedShort",
    desc: "pacingRefinedShortDesc"
  }
};

const longPacingOptions = computed(() =>
  LONG_WEB_NOVEL_PACING_MODES.map((mode) => ({
    value: mode,
    label: bookT(LONG_PACING_KEYS[mode].label),
    description: bookT(LONG_PACING_KEYS[mode].desc)
  }))
);

const shortPacingOptions = computed(() =>
  SHORT_WEB_NOVEL_PACING_MODES.map((mode) => ({
    value: mode,
    label: bookT(SHORT_PACING_KEYS[mode].label),
    description: bookT(SHORT_PACING_KEYS[mode].desc)
  }))
);

function toggleLongPacing(mode: LongWebNovelPacingMode): void {
  draftLongPacing.value = draftLongPacing.value === mode ? null : mode;
}

function toggleShortPacing(mode: ShortWebNovelPacingMode): void {
  draftShortPacing.value = draftShortPacing.value === mode ? null : mode;
}

const ALL_CRAFT_RULES_BY_TAG: ReadonlyMap<string, string> = new Map(
  [...WEB_NOVEL_CHANNEL_TROPES.male, ...WEB_NOVEL_CHANNEL_TROPES.female].map(
    (item) => [item.tag, item.craftRule]
  )
);

const selectedTropeSet = computed(() => new Set(draftTropes.value));

const displayedTropeOptions = computed(() => {
  const presets = WEB_NOVEL_CHANNEL_TROPES[channel.value];
  const presetTagSet = new Set(presets.map((item) => item.tag));
  const extraSelected = draftTropes.value
    .filter((tag) => !presetTagSet.has(tag))
    .map((tag) => ({
      tag,
      craftRule: ALL_CRAFT_RULES_BY_TAG.get(tag)
    }));
  return [...presets, ...extraSelected];
});

function toggleTrope(tag: string): void {
  if (selectedTropeSet.value.has(tag)) {
    draftTropes.value = draftTropes.value.filter((item) => item !== tag);
    return;
  }
  if (draftTropes.value.length >= MAX_TROPES) {
    uiMessage.warning(panelT("tropeLimitReached"));
    return;
  }
  draftTropes.value = [...draftTropes.value, tag];
}

const longFrameworkPreset = computed(() =>
  resolveLongBookFrameworkPreset(draftGenre.value)
);

const longFrameworkCategoriesText = computed(() =>
  longFrameworkPreset.value.worldCategories
    .map(([, title]) => title)
    .join(panelT("categorySeparator"))
);

const shortGenreBlueprint = computed(() =>
  resolveShortWebNovelBlueprint(draftGenre.value)
);

async function persistPositioning(
  action: "save-only" | "transition"
): Promise<boolean> {
  if (props.disabled || saving.value) return false;

  if (props.bookType === "long") {
    const bookId = props.bookId ?? targetLongSummary.value?.id ?? null;
    if (!bookId) return false;
    const api = resolveLongWorkspaceApi();
    if (!api) {
      uiMessage.warning(panelT("positioningUnavailable"));
      return false;
    }
    saving.value = true;
    savingAction.value = action;
    try {
      const updated = await api.updatePositioning({
        bookId,
        genre: draftGenre.value,
        pacingMode: draftLongPacing.value ?? null,
        tropes: [...draftTropes.value]
      });
      if (longWorkspaceStore.activeBookId === updated.book.id) {
        longWorkspaceStore.publishWorkspace({
          bookId: updated.book.id,
          workspaceIndex: updated.book.workspaceIndex,
          summary: updated.summary
        });
      } else {
        longWorkspaceStore.longBooks = replaceLongBookSummary(
          longWorkspaceStore.longBooks,
          updated.summary
        );
        longWorkspaceStore.invalidateWorkspace(updated.book.id);
      }
      syncDraftFromSaved(true);
      return true;
    } catch (error) {
      uiMessage.error(formatError(error, panelT("saveFailed")));
      return false;
    } finally {
      saving.value = false;
      savingAction.value = null;
    }
  }

  const targetBook = targetCreativeBook.value;
  if (!targetBook) return false;
  const port = getAcademicLifecyclePort();
  const api =
    port?.api() ??
    (typeof window !== "undefined" ? window.writer?.catalog : undefined);
  if (!api) {
    uiMessage.warning(panelT("positioningUnavailable"));
    return false;
  }
  saving.value = true;
  savingAction.value = action;
  try {
    if (port && !(await port.prepareBookMutation(targetBook.id))) {
      return false;
    }
    const latestBook =
      port?.book(targetBook.id) ??
      catalogIndexStore.snapshot?.books.find(
        (item) => item.id === targetBook.id
      ) ??
      localSavedBook.value ??
      targetBook;
    if (port) port.catalogMutationPending.value = true;
    try {
      const savedBook = await api.updateBook({
        bookId: targetBook.id,
        baseProjectRevision: latestBook.projectRevision,
        genre: draftGenre.value as ShortBookGenre & ScriptBookGenre,
        ...(props.bookType === "short"
          ? {
              pacingMode: draftShortPacing.value ?? null,
              tropes: [...draftTropes.value]
            }
          : {})
      });
      if (savedBook.bookType === "short" || savedBook.bookType === "script") {
        localSavedBook.value = savedBook;
      }
      if (port) {
        await port.refresh();
      } else if (typeof api.index === "function") {
        await catalogIndexStore.ensureSnapshot(() => api.index());
      }
    } finally {
      if (port) port.catalogMutationPending.value = false;
    }
    syncDraftFromSaved(true);
    return true;
  } catch (error) {
    uiMessage.error(formatError(error, panelT("saveFailed")));
    return false;
  } finally {
    saving.value = false;
    savingAction.value = null;
  }
}

async function saveOnly(): Promise<void> {
  if (!isDirty.value) return;
  const ok = await persistPositioning("save-only");
  if (!ok) return;
  uiMessage.success(
    panelT(props.bookType === "script" ? "genreSaved" : "positioningSaved")
  );
}

async function saveAndSmoothTransition(): Promise<void> {
  if (
    props.bookType === "script" ||
    !props.bookId ||
    props.disabled ||
    saving.value ||
    handoffPending.value ||
    !hasTargetBook.value
  ) {
    return;
  }

  const bookType = props.bookType;
  const bookId = props.bookId;
  const before: BookPositioningSnapshot = {
    genre: savedGenre.value,
    pacingMode:
      bookType === "long" ? savedLongPacing.value : savedShortPacing.value,
    tropes: [...savedTropes.value]
  };
  const after: BookPositioningSnapshot = {
    genre: draftGenre.value,
    pacingMode:
      bookType === "long" ? draftLongPacing.value : draftShortPacing.value,
    tropes: [...draftTropes.value]
  };
  const note = transitionNote.value.trim();

  if (isDirty.value && !(await persistPositioning("transition"))) {
    return;
  }
  if (props.flushContext && !(await props.flushContext())) {
    return;
  }

  transitionNote.value = "";
  handoffPending.value = true;
  try {
    emit("requestClose");
    const prompt = buildPositioningTransitionPrompt({
      bookType,
      before,
      after,
      ...(note ? { transitionNote: note } : {})
    });
    await handoffWritingContextToAgent({
      bookId,
      workspaceType: bookType,
      prompt
    });
  } finally {
    handoffPending.value = false;
  }
}
</script>

<template>
  <p v-if="!hasTargetBook" class="dialog-description" role="status">
    {{ panelT("loadingPositioning") }}
  </p>

  <div v-else class="book-positioning-panel">
    <section class="book-positioning-section">
      <fieldset
        class="book-positioning-field"
        aria-labelledby="book-positioning-genre-heading"
      >
        <div class="book-positioning-header">
          <span
            id="book-positioning-genre-heading"
            class="book-positioning-legend"
          >
            {{
              bookType === "long"
                ? bookT("novelGenre")
                : bookType === "script"
                  ? panelT("scriptGenreLabel")
                  : panelT("shortGenreLabel")
            }}
          </span>

          <div v-if="bookType !== 'script'" class="book-positioning-header-end">
            <span
              v-if="showOutOfChannelGenreBadge"
              class="book-positioning-current-badge"
            >
              {{
                panelT("currentGenreBadge", {
                  genre: genreLabel(draftGenre)
                })
              }}
            </span>
            <div
              class="book-positioning-channel-switch"
              role="radiogroup"
              :aria-label="bookT('genreChannel')"
            >
              <label
                class="book-positioning-channel-option"
                :class="{ 'is-selected': channel === 'male' }"
              >
                <input
                  v-model="channel"
                  type="radio"
                  name="bookPositioningChannel"
                  value="male"
                  :disabled="controlsDisabled"
                />
                <span>{{ bookT("channelMale") }}</span>
              </label>
              <label
                class="book-positioning-channel-option"
                :class="{ 'is-selected': channel === 'female' }"
              >
                <input
                  v-model="channel"
                  type="radio"
                  name="bookPositioningChannel"
                  value="female"
                  :disabled="controlsDisabled"
                />
                <span>{{ bookT("channelFemale") }}</span>
              </label>
            </div>
          </div>
        </div>

        <div class="book-positioning-genre-grid">
          <label
            v-for="option in displayedGenreOptions"
            :key="option"
            class="book-positioning-genre-chip"
            :class="{ 'is-selected': draftGenre === option }"
          >
            <input
              v-model="draftGenre"
              type="radio"
              name="bookPositioningGenre"
              :value="option"
              :disabled="controlsDisabled"
            />
            <span>{{ genreLabel(option) }}</span>
          </label>
        </div>
      </fieldset>

      <fieldset
        v-if="bookType === 'long' || bookType === 'short'"
        class="book-positioning-field"
        aria-labelledby="book-positioning-pacing-heading"
      >
        <span
          id="book-positioning-pacing-heading"
          class="book-positioning-legend"
        >
          {{ bookT("pacingStyle") }}
        </span>
        <div v-if="bookType === 'long'" class="book-positioning-pacing-grid">
          <button
            v-for="option in longPacingOptions"
            :key="option.value"
            type="button"
            class="book-positioning-pacing-card"
            :class="{ 'is-selected': draftLongPacing === option.value }"
            :aria-pressed="draftLongPacing === option.value"
            :disabled="controlsDisabled"
            @click="toggleLongPacing(option.value)"
          >
            <strong>{{ option.label }}</strong>
            <small>{{ option.description }}</small>
          </button>
        </div>
        <div v-else class="book-positioning-pacing-grid is-two-col">
          <button
            v-for="option in shortPacingOptions"
            :key="option.value"
            type="button"
            class="book-positioning-pacing-card"
            :class="{ 'is-selected': draftShortPacing === option.value }"
            :aria-pressed="draftShortPacing === option.value"
            :disabled="controlsDisabled"
            @click="toggleShortPacing(option.value)"
          >
            <strong>{{ option.label }}</strong>
            <small>{{ option.description }}</small>
          </button>
        </div>
      </fieldset>

      <fieldset
        v-if="bookType === 'long' || bookType === 'short'"
        class="book-positioning-field"
        aria-labelledby="book-positioning-tropes-heading"
      >
        <div class="book-positioning-header">
          <span
            id="book-positioning-tropes-heading"
            class="book-positioning-legend"
          >
            {{ panelT("tropesHeading") }}
          </span>
          <span class="book-positioning-tropes-count">
            {{
              panelT("tropesSelectedCount", {
                count: draftTropes.length
              })
            }}
          </span>
        </div>
        <div class="book-positioning-trope-chips">
          <button
            v-for="item in displayedTropeOptions"
            :key="item.tag"
            type="button"
            class="book-positioning-trope-chip"
            :class="{ 'is-selected': selectedTropeSet.has(item.tag) }"
            :title="locale === 'zh-CN' ? item.craftRule : undefined"
            :aria-pressed="selectedTropeSet.has(item.tag)"
            :disabled="controlsDisabled"
            @click="toggleTrope(item.tag)"
          >
            {{ item.tag }}
          </button>
        </div>
      </fieldset>

      <section
        v-if="bookType === 'long'"
        class="book-positioning-blueprint"
        aria-live="polite"
      >
        <strong class="book-positioning-blueprint-title">
          {{ longCraftT("blueprintTitle") }} · {{ genreLabel(draftGenre) }}
        </strong>
        <dl class="book-positioning-blueprint-list">
          <div>
            <dt>{{ panelT("frameworkPresetLabel") }}</dt>
            <dd>{{ longFrameworkPreset.name }}</dd>
          </div>
          <div>
            <dt>{{ panelT("frameworkCoreDriveLabel") }}</dt>
            <dd>{{ longFrameworkPreset.coreDrive }}</dd>
          </div>
          <div>
            <dt>{{ longCraftT("blueprintFrameworkLabel") }}</dt>
            <dd>{{ longFrameworkCategoriesText }}</dd>
          </div>
        </dl>
      </section>

      <section
        v-else-if="bookType === 'short'"
        class="book-positioning-blueprint"
        aria-live="polite"
      >
        <strong class="book-positioning-blueprint-title">
          {{ bookT("shortBlueprintTitle") }} · {{ genreLabel(draftGenre) }}
        </strong>
        <dl class="book-positioning-blueprint-list">
          <div>
            <dt>{{ bookT("shortHookLabel") }}</dt>
            <dd>{{ shortGenreBlueprint.leadInHook }}</dd>
          </div>
          <div>
            <dt>{{ bookT("shortConflictLabel") }}</dt>
            <dd>{{ shortGenreBlueprint.conflictAndAce }}</dd>
          </div>
          <div>
            <dt>{{ bookT("shortTwistLabel") }}</dt>
            <dd>{{ shortGenreBlueprint.coreTwist }}</dd>
          </div>
        </dl>
      </section>

      <label
        v-if="bookType === 'long' || bookType === 'short'"
        class="book-positioning-note-field"
      >
        <span class="book-positioning-legend">
          {{ panelT("transitionNoteLabel") }}
        </span>
        <textarea
          v-model="transitionNote"
          rows="3"
          maxlength="1000"
          :placeholder="panelT('transitionNotePlaceholder')"
          :disabled="controlsDisabled"
        />
        <small class="book-positioning-note-hint">
          {{ panelT("transitionNoteHint") }}
        </small>
      </label>
    </section>

    <div class="dialog-actions book-positioning-actions">
      <button
        v-if="bookType === 'script'"
        class="dialog-primary-button"
        type="button"
        :disabled="!isDirty || saving || disabled"
        @click="saveOnly"
      >
        {{ saving ? panelT("saving") : panelT("saveGenre") }}
      </button>

      <template v-else>
        <button
          class="dialog-secondary-button"
          type="button"
          :disabled="!isDirty || saving || handoffPending || disabled"
          @click="saveOnly"
        >
          {{
            saving && savingAction === "save-only"
              ? panelT("saving")
              : panelT("savePositioningOnly")
          }}
        </button>
        <button
          class="dialog-primary-button"
          type="button"
          :disabled="saving || handoffPending || disabled || !bookId"
          @click="saveAndSmoothTransition"
        >
          {{
            (saving && savingAction === "transition") || handoffPending
              ? panelT("transitioning")
              : panelT("saveAndTransition")
          }}
        </button>
      </template>
    </div>
  </div>
</template>

<style scoped>
.book-positioning-panel {
  display: grid;
  gap: 14px;
  min-width: 0;
}

.book-positioning-section {
  display: grid;
  gap: 14px;
  min-width: 0;
  padding: 15px;
  border: 1px solid var(--theme-line-soft);
  border-radius: 10px;
  background: var(--surface-raised);
}

.book-positioning-field {
  display: grid;
  gap: 8px;
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
}

.book-positioning-header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px 10px;
}

.book-positioning-header-end {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.book-positioning-legend {
  color: var(--text-secondary);
  font-size: 0.785714rem;
  font-weight: 570;
}

.book-positioning-current-badge {
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  padding: 0 9px;
  border: 1px solid color-mix(in srgb, var(--accent) 30%, var(--theme-line));
  border-radius: 999px;
  background: var(--accent-soft);
  color: var(--text-primary);
  font-size: 0.75rem;
  font-weight: 580;
}

.book-positioning-channel-switch {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 3px;
  border: 1px solid var(--theme-line);
  border-radius: 10px;
  background: var(--surface-muted);
}

.book-positioning-channel-option {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 28px;
  padding: 0 12px;
  border-radius: 7px;
  color: var(--text-secondary);
  font-size: 0.785714rem;
  line-height: 1;
  cursor: pointer;
  user-select: none;
}

.book-positioning-channel-option:hover {
  color: var(--text-primary);
}

.book-positioning-channel-option.is-selected {
  background: var(--accent-soft);
  color: var(--text-primary);
  font-weight: 600;
}

.book-positioning-channel-option:has(input:focus-visible),
.book-positioning-genre-chip:has(input:focus-visible) {
  outline: 2px solid color-mix(in srgb, var(--accent) 55%, transparent);
  outline-offset: 1px;
}

.book-positioning-channel-option:has(input:disabled),
.book-positioning-genre-chip:has(input:disabled) {
  opacity: 0.55;
  cursor: not-allowed;
}

.book-positioning-channel-option input,
.book-positioning-genre-chip input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}

.book-positioning-genre-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
  gap: 7px;
}

.book-positioning-genre-chip {
  position: relative;
  display: grid;
  place-items: center;
  min-height: 34px;
  padding: 4px 8px;
  border: 1px solid var(--theme-line);
  border-radius: 8px;
  background: var(--surface-main);
  color: var(--text-secondary);
  font-size: 0.821429rem;
  text-align: center;
  cursor: pointer;
  user-select: none;
}

.book-positioning-genre-chip:hover {
  background: var(--surface-hover);
  color: var(--text-primary);
}

.book-positioning-genre-chip.is-selected {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--text-primary);
  font-weight: 620;
}

.book-positioning-pacing-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.book-positioning-pacing-grid.is-two-col {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.book-positioning-pacing-card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  padding: 9px 11px;
  border: 1px solid var(--theme-line);
  border-radius: 9px;
  background: var(--surface-main);
  text-align: left;
  cursor: pointer;
}

.book-positioning-pacing-card:hover:not(:disabled) {
  background: var(--surface-muted);
}

.book-positioning-pacing-card.is-selected {
  border-color: var(--accent);
  background: var(--accent-soft);
}

.book-positioning-pacing-card strong {
  color: var(--text-primary);
  font-size: 0.8125rem;
  font-weight: 600;
}

.book-positioning-pacing-card small {
  color: var(--text-secondary);
  font-size: 0.714286rem;
  line-height: 1.45;
}

.book-positioning-tropes-count {
  color: var(--text-tertiary);
  font-size: 0.714286rem;
}

.book-positioning-trope-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.book-positioning-trope-chip {
  min-height: 28px;
  padding: 0 10px;
  border: 1px solid var(--theme-line);
  border-radius: 999px;
  background: var(--surface-main);
  color: var(--text-secondary);
  font-size: 0.785714rem;
  cursor: pointer;
}

.book-positioning-trope-chip:hover:not(:disabled) {
  background: var(--surface-hover);
  color: var(--text-primary);
}

.book-positioning-trope-chip.is-selected {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--text-primary);
  font-weight: 600;
}

.book-positioning-pacing-card:disabled,
.book-positioning-trope-chip:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.book-positioning-blueprint {
  display: grid;
  gap: 8px;
  padding: 12px 14px;
  border: 1px solid var(--theme-line-soft);
  border-radius: 10px;
  background: var(--surface-muted);
}

.book-positioning-blueprint-title {
  color: var(--text-primary);
  font-size: 0.821429rem;
  font-weight: 600;
}

.book-positioning-blueprint-list {
  display: grid;
  gap: 6px;
  margin: 0;
}

.book-positioning-blueprint-list > div {
  display: grid;
  grid-template-columns: minmax(64px, auto) minmax(0, 1fr);
  gap: 8px 12px;
  align-items: baseline;
}

.book-positioning-blueprint-list dt {
  color: var(--text-tertiary);
  font-size: 0.75rem;
  font-weight: 560;
}

.book-positioning-blueprint-list dd {
  margin: 0;
  color: var(--text-secondary);
  font-size: 0.785714rem;
  line-height: 1.5;
}

.book-positioning-note-field {
  display: grid;
  gap: 6px;
  min-width: 0;
}

.book-positioning-note-field textarea {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--theme-line);
  border-radius: 9px;
  background: var(--surface-main);
  color: var(--text-primary);
  font-family: var(--editor-font);
  font-size: 0.857143rem;
  line-height: 1.65;
  resize: vertical;
}

.book-positioning-note-field textarea::placeholder {
  color: var(--text-tertiary);
}

.book-positioning-note-field textarea:focus {
  border-color: color-mix(in srgb, var(--accent) 28%, var(--theme-line));
  box-shadow: 0 0 0 3px var(--accent-soft);
  outline: 0;
}

.book-positioning-note-field textarea:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.book-positioning-note-hint {
  color: var(--text-tertiary);
  font-size: 0.75rem;
  line-height: 1.5;
}

.book-positioning-actions {
  position: sticky;
  bottom: 0;
  z-index: 2;
  flex-wrap: wrap;
  margin-top: 0;
  padding: 12px 0 4px;
  border-top: 1px solid var(--theme-line-soft);
  background: var(--surface-main);
  box-shadow: 0 24px 0 var(--surface-main);
}

@media (max-width: 780px) {
  .book-positioning-pacing-grid,
  .book-positioning-pacing-grid.is-two-col {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
