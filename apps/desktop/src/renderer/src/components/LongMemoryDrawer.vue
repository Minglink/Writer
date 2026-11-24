<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import type {
  LongChapterNote,
  LongWorkspaceIndexSnapshot
} from "@writer/contracts";
import { locale, registerFeatureMessages } from "../i18n";
import { resolveLongWorkspaceApi } from "../types/longWorkspace";
import {
  BOOK_MEMORY_SNIPPETS,
  buildLongChapterMemorySummary
} from "../utils/longChapterMemoryPack";
import AppIcon from "./AppIcon.vue";
import LongChapterNotesPanel from "./LongChapterNotesPanel.vue";

const t = registerFeatureMessages("longMemoryDrawer", {
  "zh-CN": {
    drawerLabel: "长篇写作笔记与记忆",
    tabNotes: "本章笔记",
    tabChapter: "本章记忆",
    tabBook: "本书记忆（AGENTS.md）",
    close: "关闭记忆面板",
    prevHandoffTitle: "上一章交接包",
    prevHandoffEmpty: "上一章暂无交接包内容。",
    noPrevChapter: "当前是第一章，暂无上一章交接包。",
    currentCardTitle: "本章章卡",
    currentCardEmpty: "本章章卡还是空的，可点右侧「记入章卡」快速记录。",
    jumpView: "打开查看",
    commitToCard: "记入章卡",
    openForeshadowingTitle: "待回收伏笔",
    noOpenForeshadowing: "当前没有待回收的伏笔记录。",
    archiveReadyTitle: "本章正文已落盘，尚未归档连续性账本",
    archiveAction: "整理并归档本章记忆",
    archiveCommitted: "本章已归档连续性账本",
    knowledgeHint:
      "知识边界提醒：写作时请区分「角色当前已知事实」与「作者规划在后续揭示的秘密」。",
    bookMemoryIntro:
      "这里记录本书长期生效的文风偏好、禁词、人物口癖与红线，每轮 AI 共创都会自动读取；可随时修改或撤销。",
    bookMemoryPlaceholder:
      "写下本书希望 AI 长期记住的规则，例如：叙述克制、不提前说破悬念、主角说话简短…",
    saveBookMemory: "保存本书记忆",
    saving: "保存中…",
    saved: "已保存",
    saveFailed: "保存失败，请稍后重试。",
    charsCount: "已用 {count} 字"
  },
  "en-US": {
    drawerLabel: "Long-form notes and memory",
    tabNotes: "Chapter notes",
    tabChapter: "Chapter memory",
    tabBook: "Book memory (AGENTS.md)",
    close: "Close memory drawer",
    prevHandoffTitle: "Previous chapter handoff",
    prevHandoffEmpty: "No handoff notes in the previous chapter yet.",
    noPrevChapter: "This is the first chapter; no previous handoff yet.",
    currentCardTitle: "Current chapter card",
    currentCardEmpty:
      "This chapter card is empty. Click Commit to card to jot a quick beat.",
    jumpView: "Open",
    commitToCard: "Commit to card",
    openForeshadowingTitle: "Open foreshadowing",
    noOpenForeshadowing: "No open foreshadowing items right now.",
    archiveReadyTitle: "Draft is saved on disk, pending continuity archive",
    archiveAction: "Archive chapter continuity",
    archiveCommitted: "Continuity ledger archived for this chapter",
    knowledgeHint:
      "Knowledge boundary: keep what the POV character knows now distinct from secrets planned for later.",
    bookMemoryIntro:
      "Book-level rules (voice, avoid-list, character quirks) automatically loaded on every co-creation turn. Editable and reversible anytime.",
    bookMemoryPlaceholder:
      "Add durable rules for this book, e.g. restrained prose, keep suspense unstated…",
    saveBookMemory: "Save book memory",
    saving: "Saving…",
    saved: "Saved",
    saveFailed: "Failed to save. Please try again.",
    charsCount: "{count} chars"
  }
});

const props = defineProps<{
  bookId: string;
  workspaceIndex: LongWorkspaceIndexSnapshot | null;
  activeChapterCardId: string | null;
  currentBodyFileId?: string | null;
  currentBodyText?: string;
  hasActiveSelection?: boolean;
  chapterNotes?: readonly LongChapterNote[];
  chapterNotesSaving?: boolean | undefined;
  chapterNotesError?: string | undefined;
  initialTab?: "notes" | "chapter" | "book";
  locked?: boolean;
}>();

const emit = defineEmits<{
  close: [];
  jumpToFile: [fileId: string];
  openCommitToCard: [];
  requestArchiveChapter: [chapterTitle: string];
  addFreeNote: [
    payload: { content: string; done: (succeeded: boolean) => void }
  ];
  updateNote: [
    payload: { id: string; content: string; done: (succeeded: boolean) => void }
  ];
  deleteNote: [id: string];
  locateQuote: [range: { start: number; end: number }];
  rebindQuote: [id: string];
}>();

const activeTab = ref<"notes" | "chapter" | "book">(
  props.initialTab ?? "notes"
);
const activeChapterNoteCount = computed(() => {
  if (!props.activeChapterCardId || !props.chapterNotes) return 0;
  return props.chapterNotes.filter(
    (note) => note.chapterCardId === props.activeChapterCardId
  ).length;
});
const prevHandoffExcerpt = ref("");
const currentCardExcerpt = ref("");
const bookMemoryContent = ref("");
const bookMemoryDirty = ref(false);
const bookMemorySaving = ref(false);
const bookMemorySavedFlash = ref(false);
const bookMemoryError = ref("");

const summary = computed(() =>
  buildLongChapterMemorySummary(props.workspaceIndex, props.activeChapterCardId)
);

function trimExcerpt(text: string, limit = 160): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  return cleaned.length > limit ? `${cleaned.slice(0, limit)}…` : cleaned;
}

async function loadChapterMemoryExcerpts(): Promise<void> {
  const api = resolveLongWorkspaceApi();
  if (!api?.readDocument || !props.bookId) return;
  const handoffId = summary.value.previousHandoffFileId;
  const cardId = summary.value.currentCardFileId;
  try {
    if (handoffId) {
      const res = await api.readDocument({
        bookId: props.bookId,
        fileId: handoffId,
        offset: 0,
        maxCharacters: 400
      });
      prevHandoffExcerpt.value = trimExcerpt(res.content);
    } else {
      prevHandoffExcerpt.value = "";
    }
  } catch {
    prevHandoffExcerpt.value = "";
  }
  try {
    if (cardId) {
      const res = await api.readDocument({
        bookId: props.bookId,
        fileId: cardId,
        offset: 0,
        maxCharacters: 400
      });
      currentCardExcerpt.value = trimExcerpt(res.content);
    } else {
      currentCardExcerpt.value = "";
    }
  } catch {
    currentCardExcerpt.value = "";
  }
}

async function loadBookMemory(): Promise<void> {
  const api = resolveLongWorkspaceApi();
  if (!api?.readAgentsMd || !props.bookId) return;
  bookMemoryError.value = "";
  try {
    const res = await api.readAgentsMd({ bookId: props.bookId });
    bookMemoryContent.value = res.content;
    bookMemoryDirty.value = false;
  } catch {
    bookMemoryContent.value = "";
  }
}

function appendSnippet(content: string): void {
  const base = bookMemoryContent.value.trimEnd();
  bookMemoryContent.value = base
    ? `${base}\n${content.trim()}\n`
    : `${content.trim()}\n`;
  bookMemoryDirty.value = true;
  bookMemorySavedFlash.value = false;
}

async function saveBookMemory(): Promise<void> {
  const api = resolveLongWorkspaceApi();
  if (!api?.writeAgentsMd || !props.bookId || bookMemorySaving.value) return;
  bookMemorySaving.value = true;
  bookMemoryError.value = "";
  try {
    await api.writeAgentsMd({
      bookId: props.bookId,
      content: bookMemoryContent.value
    });
    bookMemoryDirty.value = false;
    bookMemorySavedFlash.value = true;
  } catch {
    bookMemoryError.value = t("saveFailed");
  } finally {
    bookMemorySaving.value = false;
  }
}

watch(
  () => [props.bookId, props.activeChapterCardId] as const,
  () => {
    void loadChapterMemoryExcerpts();
  }
);

watch(
  () => props.bookId,
  () => {
    void loadBookMemory();
  }
);

onMounted(() => {
  void loadChapterMemoryExcerpts();
  void loadBookMemory();
});
</script>

<template>
  <section class="long-memory-drawer" :aria-label="t('drawerLabel')">
    <div class="long-memory-drawer-header">
      <div class="long-memory-drawer-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          class="long-memory-drawer-tab"
          :class="{ 'is-active': activeTab === 'notes' }"
          :aria-selected="activeTab === 'notes'"
          @click="activeTab = 'notes'"
        >
          {{ t("tabNotes")
          }}<template v-if="activeChapterNoteCount > 0">
            ({{ activeChapterNoteCount }})</template
          >
        </button>
        <button
          type="button"
          role="tab"
          class="long-memory-drawer-tab"
          :class="{ 'is-active': activeTab === 'chapter' }"
          :aria-selected="activeTab === 'chapter'"
          @click="activeTab = 'chapter'"
        >
          {{ t("tabChapter") }}
        </button>
        <button
          type="button"
          role="tab"
          class="long-memory-drawer-tab"
          :class="{ 'is-active': activeTab === 'book' }"
          :aria-selected="activeTab === 'book'"
          @click="activeTab = 'book'"
        >
          {{ t("tabBook") }}
        </button>
      </div>
      <button
        type="button"
        class="long-memory-drawer-close"
        :aria-label="t('close')"
        :title="t('close')"
        @click="emit('close')"
      >
        <AppIcon name="close" :size="14" />
      </button>
    </div>

    <div v-if="activeTab === 'notes'" class="long-memory-drawer-body">
      <LongChapterNotesPanel
        :active-chapter-card-id="activeChapterCardId"
        :current-body-file-id="currentBodyFileId ?? null"
        :current-body-text="currentBodyText ?? ''"
        :has-active-selection="Boolean(hasActiveSelection)"
        :notes="chapterNotes ?? []"
        :saving="chapterNotesSaving"
        :error-text="chapterNotesError"
        :locked="locked"
        @add-free-note="emit('addFreeNote', $event)"
        @update-note="emit('updateNote', $event)"
        @delete-note="emit('deleteNote', $event)"
        @locate-quote="emit('locateQuote', $event)"
        @rebind-quote="emit('rebindQuote', $event)"
      />
    </div>

    <div v-else-if="activeTab === 'chapter'" class="long-memory-drawer-body">
      <div class="long-memory-grid">
        <div class="long-memory-card">
          <div class="long-memory-card-head">
            <strong>
              {{ t("prevHandoffTitle") }}
              <span
                v-if="summary.previousChapterTitle"
                class="long-memory-muted"
              >
                · {{ summary.previousChapterTitle }}
              </span>
            </strong>
            <button
              v-if="summary.previousHandoffFileId"
              type="button"
              class="long-memory-link"
              @click="emit('jumpToFile', summary.previousHandoffFileId)"
            >
              {{ t("jumpView") }}
            </button>
          </div>
          <p class="long-memory-excerpt">
            {{
              summary.previousHandoffFileId
                ? prevHandoffExcerpt || t("prevHandoffEmpty")
                : t("noPrevChapter")
            }}
          </p>
        </div>

        <div class="long-memory-card">
          <div class="long-memory-card-head">
            <strong>
              {{ t("currentCardTitle") }}
              <span
                v-if="summary.currentChapterTitle"
                class="long-memory-muted"
              >
                · {{ summary.currentChapterTitle }}
              </span>
            </strong>
            <div class="long-memory-card-actions">
              <button
                v-if="summary.currentCardFileId && !locked"
                type="button"
                class="long-memory-link is-accent"
                @click="emit('openCommitToCard')"
              >
                {{ t("commitToCard") }}
              </button>
              <button
                v-if="summary.currentCardFileId"
                type="button"
                class="long-memory-link"
                @click="emit('jumpToFile', summary.currentCardFileId)"
              >
                {{ t("jumpView") }}
              </button>
            </div>
          </div>
          <p class="long-memory-excerpt">
            {{ currentCardExcerpt || t("currentCardEmpty") }}
          </p>
        </div>
      </div>

      <div class="long-memory-foreshadowing">
        <div class="long-memory-card-head">
          <strong>{{ t("openForeshadowingTitle") }}</strong>
          <span v-if="summary.isPendingArchive" class="long-memory-archive-row">
            <span class="long-memory-archive-note">{{
              t("archiveReadyTitle")
            }}</span>
            <button
              type="button"
              class="long-memory-archive-btn"
              :disabled="locked"
              @click="
                emit('requestArchiveChapter', summary.currentChapterTitle)
              "
            >
              {{ t("archiveAction") }}
            </button>
          </span>
          <span v-else-if="summary.isCommitted" class="long-memory-committed">
            {{ t("archiveCommitted") }}
          </span>
        </div>
        <div
          v-if="summary.openForeshadowings.length > 0"
          class="long-memory-pills"
        >
          <span
            v-for="item in summary.openForeshadowings"
            :key="item.id"
            class="long-memory-pill"
          >
            {{ item.title }}
          </span>
        </div>
        <p v-else class="long-memory-excerpt">
          {{ t("noOpenForeshadowing") }}
        </p>
      </div>

      <p class="long-memory-boundary-note">{{ t("knowledgeHint") }}</p>
    </div>

    <div v-else class="long-memory-drawer-body">
      <p class="long-memory-boundary-note">{{ t("bookMemoryIntro") }}</p>
      <div class="long-memory-snippets">
        <button
          v-for="snippet in BOOK_MEMORY_SNIPPETS"
          :key="snippet.id"
          type="button"
          class="long-memory-snippet-btn"
          :disabled="locked"
          @click="
            appendSnippet(
              locale === 'en-US' ? snippet.contentEn : snippet.contentZh
            )
          "
        >
          {{ locale === "en-US" ? snippet.labelEn : snippet.labelZh }}
        </button>
      </div>
      <textarea
        v-model="bookMemoryContent"
        class="long-memory-textarea"
        rows="5"
        :placeholder="t('bookMemoryPlaceholder')"
        :disabled="locked"
        @input="
          bookMemoryDirty = true;
          bookMemorySavedFlash = false;
        "
      />
      <div class="long-memory-book-footer">
        <span class="long-memory-muted">
          {{ t("charsCount", { count: String(bookMemoryContent.length) }) }}
        </span>
        <span v-if="bookMemoryError" class="long-memory-error">
          {{ bookMemoryError }}
        </span>
        <span v-else-if="bookMemorySavedFlash" class="long-memory-committed">
          {{ t("saved") }}
        </span>
        <button
          type="button"
          class="long-memory-save-btn"
          :disabled="locked || bookMemorySaving || !bookMemoryDirty"
          @click="saveBookMemory"
        >
          {{ bookMemorySaving ? t("saving") : t("saveBookMemory") }}
        </button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.long-memory-drawer {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--theme-line-soft);
  background: var(--surface-raised, var(--surface-main));
}

.long-memory-drawer-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.long-memory-drawer-tabs {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.long-memory-drawer-tab {
  padding: 3px 10px;
  border: 1px solid var(--theme-line-soft);
  border-radius: 999px;
  background: var(--surface-main);
  color: var(--text-secondary);
  font-size: 0.785714rem;
  cursor: pointer;
}

.long-memory-drawer-tab.is-active {
  border-color: color-mix(in srgb, var(--accent) 45%, var(--theme-line-soft));
  background: color-mix(in srgb, var(--accent) 12%, var(--surface-main));
  color: var(--accent);
  font-weight: 500;
}

.long-memory-drawer-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
}

.long-memory-drawer-close:hover {
  background: var(--surface-hover);
  color: var(--text-primary);
}

.long-memory-drawer-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.long-memory-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.long-memory-card,
.long-memory-foreshadowing {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 10px;
  border: 1px solid var(--theme-line-soft);
  border-radius: 7px;
  background: var(--surface-main);
}

.long-memory-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 0.785714rem;
  color: var(--text-primary);
}

.long-memory-card-actions {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.long-memory-muted {
  font-weight: 400;
  color: var(--text-tertiary);
}

.long-memory-link {
  border: none;
  background: transparent;
  padding: 0;
  font-size: 0.785714rem;
  color: var(--text-secondary);
  cursor: pointer;
}

.long-memory-link:hover,
.long-memory-link.is-accent {
  color: var(--accent);
}

.long-memory-excerpt {
  margin: 0;
  font-size: 0.785714rem;
  line-height: 1.5;
  color: var(--text-secondary);
}

.long-memory-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.long-memory-pill {
  padding: 2px 8px;
  border: 1px solid var(--theme-line-soft);
  border-radius: 999px;
  background: var(--surface-raised, var(--surface-main));
  font-size: 0.714286rem;
  color: var(--text-secondary);
}

.long-memory-archive-row {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.long-memory-archive-note {
  font-size: 0.714286rem;
  color: var(--text-tertiary);
}

.long-memory-archive-btn {
  padding: 2px 9px;
  border: 1px solid
    color-mix(in srgb, var(--accent) 45%, var(--theme-line-soft));
  border-radius: 6px;
  background: color-mix(in srgb, var(--accent) 12%, var(--surface-main));
  color: var(--accent);
  font-size: 0.714286rem;
  font-weight: 500;
  cursor: pointer;
}

.long-memory-committed {
  font-size: 0.714286rem;
  color: var(--success);
}

.long-memory-boundary-note {
  margin: 0;
  font-size: 0.714286rem;
  color: var(--text-tertiary);
}

.long-memory-snippets {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.long-memory-snippet-btn {
  padding: 2px 9px;
  border: 1px solid var(--theme-line-soft);
  border-radius: 999px;
  background: var(--surface-main);
  color: var(--text-secondary);
  font-size: 0.714286rem;
  cursor: pointer;
}

.long-memory-snippet-btn:hover:not(:disabled) {
  border-color: var(--theme-line);
  color: var(--text-primary);
}

.long-memory-textarea {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--theme-line);
  border-radius: 7px;
  background: var(--surface-main);
  color: var(--text-primary);
  font-size: 0.857143rem;
  line-height: 1.55;
  resize: vertical;
  outline: none;
}

.long-memory-textarea:focus {
  border-color: var(--accent);
}

.long-memory-book-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
}

.long-memory-book-footer > .long-memory-muted {
  margin-right: auto;
  font-size: 0.785714rem;
}

.long-memory-error {
  font-size: 0.785714rem;
  color: var(--danger);
}

.long-memory-save-btn {
  height: 28px;
  padding: 0 12px;
  border: 1px solid var(--accent);
  border-radius: 6px;
  background: var(--accent);
  color: var(--accent-ink, #fff);
  font-size: 0.785714rem;
  font-weight: 500;
  cursor: pointer;
}

.long-memory-save-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
