<script setup lang="ts">
import { computed, ref } from "vue";
import {
  LONG_CHAPTER_NOTE_MAX_CHARS,
  type LongChapterNote
} from "@writer/contracts";
import { registerFeatureMessages } from "../i18n";
import {
  resolveChapterNoteQuote,
  type ChapterNoteAnchorResolution
} from "../utils/longChapterNoteAnchor";
import AppIcon from "./AppIcon.vue";

const t = registerFeatureMessages("longChapterNotes", {
  "zh-CN": {
    composerPlaceholder: "记一句本章想法、待核对细节或伏笔备忘…",
    saveNote: "记下",
    saving: "保存中…",
    empty: "本章还没有笔记。可直接在此记录，或在正文中选中原句点「记边注」。",
    noChapter: "先打开任意章节，即可记录和查看本章笔记。",
    locateQuote: "定位原文",
    locateMatch: "第 {index} 处",
    rebindQuote: "重绑当前选区",
    rebindHint: "请先在正文中选中一段文字",
    statusShifted: "原句已随增删移动",
    statusAmbiguous: "正文存在多处相同原句",
    statusMissing: "原句已删改，笔记已保留",
    edit: "编辑",
    delete: "删除",
    saveEdit: "保存",
    cancelEdit: "取消",
    freeNoteTag: "本章笔记",
    quoteNoteTag: "选区边注"
  },
  "en-US": {
    composerPlaceholder: "Jot down a chapter note, detail, or reminder…",
    saveNote: "Save",
    saving: "Saving…",
    empty:
      "No notes for this chapter yet. Write one here or select text and click Add note.",
    noChapter: "Open a chapter to add and review chapter notes.",
    locateQuote: "Locate quote",
    locateMatch: "Match #{index}",
    rebindQuote: "Rebind selection",
    rebindHint: "Select text in the draft first",
    statusShifted: "Quote moved after edits",
    statusAmbiguous: "Multiple identical matches found",
    statusMissing: "Original quote changed; note kept",
    edit: "Edit",
    delete: "Delete",
    saveEdit: "Save",
    cancelEdit: "Cancel",
    freeNoteTag: "Chapter note",
    quoteNoteTag: "Margin note"
  }
});

const props = defineProps<{
  activeChapterCardId: string | null;
  currentBodyFileId: string | null;
  currentBodyText: string;
  hasActiveSelection: boolean;
  notes: readonly LongChapterNote[];
  saving?: boolean | undefined;
  errorText?: string | undefined;
  locked?: boolean | undefined;
}>();

const emit = defineEmits<{
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

const draftContent = ref("");
const editingId = ref<string | null>(null);
const editingContent = ref("");

const chapterNotes = computed(() => {
  if (!props.activeChapterCardId) return [];
  return props.notes
    .filter((n) => n.chapterCardId === props.activeChapterCardId)
    .slice()
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map((note) => ({
      note,
      anchor: resolveAnchor(note)
    }));
});

function resolveAnchor(
  note: LongChapterNote
): ChapterNoteAnchorResolution | null {
  if (!note.quote) return null;
  if (
    !props.currentBodyFileId ||
    note.quote.fileId !== props.currentBodyFileId
  ) {
    return null;
  }
  return resolveChapterNoteQuote(props.currentBodyText, note.quote);
}

function submitFreeNote(): void {
  const trimmed = draftContent.value.trim();
  if (!trimmed || props.locked || props.saving || !props.activeChapterCardId) {
    return;
  }
  emit("addFreeNote", {
    content: trimmed,
    done: (succeeded) => {
      if (succeeded) {
        draftContent.value = "";
      }
    }
  });
}

function handleComposerKeydown(event: KeyboardEvent): void {
  if (
    event.key === "Enter" &&
    (event.metaKey || event.ctrlKey) &&
    !event.isComposing
  ) {
    event.preventDefault();
    submitFreeNote();
  }
}

function startEdit(note: LongChapterNote): void {
  editingId.value = note.id;
  editingContent.value = note.content;
}

function cancelEdit(): void {
  editingId.value = null;
  editingContent.value = "";
}

function commitEdit(id: string): void {
  const trimmed = editingContent.value.trim();
  if (!trimmed) return;
  emit("updateNote", {
    id,
    content: trimmed,
    done: (succeeded) => {
      if (succeeded) {
        editingId.value = null;
        editingContent.value = "";
      }
    }
  });
}
</script>

<template>
  <div class="long-chapter-notes-panel">
    <p v-if="!activeChapterCardId" class="long-chapter-notes-empty">
      {{ t("noChapter") }}
    </p>
    <template v-else>
      <div class="long-chapter-notes-composer">
        <textarea
          v-model="draftContent"
          class="long-chapter-notes-input"
          rows="2"
          :maxlength="LONG_CHAPTER_NOTE_MAX_CHARS"
          :placeholder="t('composerPlaceholder')"
          :disabled="locked || saving"
          @keydown="handleComposerKeydown"
        />
        <div class="long-chapter-notes-composer-actions">
          <span
            v-if="errorText"
            class="long-chapter-note-status is-missing"
            role="alert"
          >
            {{ errorText }}
          </span>
          <button
            type="button"
            class="long-chapter-notes-submit"
            :disabled="locked || saving || !draftContent.trim()"
            @click="submitFreeNote"
          >
            {{ saving ? t("saving") : t("saveNote") }}
          </button>
        </div>
      </div>

      <p v-if="chapterNotes.length === 0" class="long-chapter-notes-empty">
        {{ t("empty") }}
      </p>

      <ul v-else class="long-chapter-notes-list">
        <li
          v-for="{ note, anchor } in chapterNotes"
          :key="note.id"
          class="long-chapter-note-card"
        >
          <div class="long-chapter-note-meta">
            <span
              class="long-chapter-note-tag"
              :class="{ 'is-quote': Boolean(note.quote) }"
            >
              {{ note.quote ? t("quoteNoteTag") : t("freeNoteTag") }}
            </span>
            <div class="long-chapter-note-ops">
              <button
                type="button"
                class="long-chapter-note-icon-btn"
                :title="t('edit')"
                :disabled="locked || saving"
                @click="startEdit(note)"
              >
                {{ t("edit") }}
              </button>
              <button
                type="button"
                class="long-chapter-note-icon-btn is-danger"
                :title="t('delete')"
                :disabled="locked || saving"
                @click="emit('deleteNote', note.id)"
              >
                <AppIcon name="close" :size="12" />
              </button>
            </div>
          </div>

          <div v-if="note.quote" class="long-chapter-note-quote-box">
            <blockquote class="long-chapter-note-quote">
              “{{ note.quote.excerpt }}”
            </blockquote>
            <div v-if="anchor" class="long-chapter-note-anchor-row">
              <template v-if="anchor.status === 'exact'">
                <button
                  type="button"
                  class="long-chapter-note-locate-btn"
                  @click="
                    emit('locateQuote', {
                      start: anchor.start,
                      end: anchor.end
                    })
                  "
                >
                  {{ t("locateQuote") }}
                </button>
                <span
                  v-if="anchor.shifted"
                  class="long-chapter-note-status is-info"
                >
                  {{ t("statusShifted") }}
                </span>
              </template>
              <template v-else-if="anchor.status === 'ambiguous'">
                <span class="long-chapter-note-status is-warn">
                  {{ t("statusAmbiguous") }}
                </span>
                <div class="long-chapter-note-match-buttons">
                  <button
                    v-for="(m, idx) in anchor.matches.slice(0, 4)"
                    :key="`${m.start}-${m.end}`"
                    type="button"
                    class="long-chapter-note-locate-btn"
                    @click="emit('locateQuote', m)"
                  >
                    {{ t("locateMatch", { index: String(idx + 1) }) }}
                  </button>
                  <button
                    type="button"
                    class="long-chapter-note-locate-btn"
                    :disabled="!hasActiveSelection || locked || saving"
                    :title="hasActiveSelection ? '' : t('rebindHint')"
                    @click="emit('rebindQuote', note.id)"
                  >
                    {{ t("rebindQuote") }}
                  </button>
                </div>
              </template>
              <template v-else>
                <span class="long-chapter-note-status is-missing">
                  {{ t("statusMissing") }}
                </span>
                <button
                  type="button"
                  class="long-chapter-note-locate-btn"
                  :disabled="!hasActiveSelection || locked || saving"
                  :title="hasActiveSelection ? '' : t('rebindHint')"
                  @click="emit('rebindQuote', note.id)"
                >
                  {{ t("rebindQuote") }}
                </button>
              </template>
            </div>
          </div>

          <div v-if="editingId === note.id" class="long-chapter-note-edit-box">
            <textarea
              v-model="editingContent"
              class="long-chapter-notes-input"
              rows="2"
              :maxlength="LONG_CHAPTER_NOTE_MAX_CHARS"
            />
            <div class="long-chapter-notes-composer-actions">
              <button
                type="button"
                class="long-chapter-note-icon-btn"
                @click="cancelEdit"
              >
                {{ t("cancelEdit") }}
              </button>
              <button
                type="button"
                class="long-chapter-notes-submit"
                :disabled="!editingContent.trim()"
                @click="commitEdit(note.id)"
              >
                {{ t("saveEdit") }}
              </button>
            </div>
          </div>
          <p v-else class="long-chapter-note-body">{{ note.content }}</p>
        </li>
      </ul>
    </template>
  </div>
</template>

<style scoped>
.long-chapter-notes-panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.long-chapter-notes-composer {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.long-chapter-notes-input {
  width: 100%;
  resize: vertical;
  padding: 7px 9px;
  border: 1px solid var(--theme-line);
  border-radius: 7px;
  background: var(--surface-main);
  color: var(--ink-main);
  font: inherit;
  font-size: 13px;
  line-height: 1.5;
}

.long-chapter-notes-composer-actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
}

.long-chapter-notes-submit {
  height: 26px;
  padding: 0 11px;
  border: none;
  border-radius: 6px;
  background: var(--accent-main, #2563eb);
  color: #fff;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
}

.long-chapter-notes-submit:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.long-chapter-notes-empty {
  margin: 4px 0;
  font-size: 12.5px;
  line-height: 1.5;
  color: var(--ink-muted);
}

.long-chapter-notes-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.long-chapter-note-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 9px 10px;
  border: 1px solid var(--theme-line);
  border-radius: 8px;
  background: var(--surface-main);
}

.long-chapter-note-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.long-chapter-note-tag {
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--surface-subtle);
  color: var(--ink-muted);
}

.long-chapter-note-tag.is-quote {
  color: var(--accent-main, #2563eb);
}

.long-chapter-note-ops {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.long-chapter-note-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 22px;
  padding: 0 6px;
  border: 1px solid transparent;
  border-radius: 5px;
  background: transparent;
  color: var(--ink-muted);
  font-size: 11.5px;
  cursor: pointer;
}

.long-chapter-note-icon-btn:hover:not(:disabled) {
  background: var(--surface-subtle);
  color: var(--ink-main);
}

.long-chapter-note-quote-box {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 6px 8px;
  border-left: 2px solid var(--accent-main, #2563eb);
  border-radius: 0 5px 5px 0;
  background: var(--surface-subtle);
}

.long-chapter-note-quote {
  margin: 0;
  font-size: 12px;
  line-height: 1.45;
  color: var(--ink-muted);
}

.long-chapter-note-anchor-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.long-chapter-note-match-buttons {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 4px;
}

.long-chapter-note-locate-btn {
  height: 21px;
  padding: 0 7px;
  border: 1px solid var(--theme-line);
  border-radius: 5px;
  background: var(--surface-main);
  color: var(--ink-main);
  font-size: 11px;
  cursor: pointer;
}

.long-chapter-note-locate-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.long-chapter-note-status {
  font-size: 11px;
}

.long-chapter-note-status.is-info {
  color: var(--ink-muted);
}

.long-chapter-note-status.is-warn {
  color: #b45309;
}

.long-chapter-note-status.is-missing {
  color: #b91c1c;
}

.long-chapter-note-body {
  margin: 0;
  font-size: 13px;
  line-height: 1.55;
  color: var(--ink-main);
  white-space: pre-wrap;
  word-break: break-word;
}

.long-chapter-note-edit-box {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
</style>
