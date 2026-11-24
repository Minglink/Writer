<script setup lang="ts">
import { nextTick, onMounted, ref } from "vue";
import { registerFeatureMessages } from "../i18n";
import { resolveLongWorkspaceApi } from "../types/longWorkspace";
import AppIcon from "./AppIcon.vue";

const t = registerFeatureMessages("longCommitToCardDialog", {
  "zh-CN": {
    title: "记入章卡 · {chapter}",
    hint: "把刚才定下的剧情决定或下一幕动作整理成一句话记入章卡；未被采用的构想留在会话中，不写入作品。",
    placeholder:
      "例如：林澈隔门喊出「钥匙在我这儿」，诱使送信人折返，埋下圆谎危机。",
    modeAppend: "追加到章卡末尾",
    modeReplace: "覆盖当前章卡",
    cancel: "取消",
    confirm: "确认写入章卡",
    saving: "写入中…",
    failed: "写入章卡失败，请先核对章卡最新版本。"
  },
  "en-US": {
    title: "Commit to card · {chapter}",
    hint: "Edit the exact decision you want to keep in this chapter card. Rejected ideas stay in chat and never touch the book.",
    placeholder:
      "e.g. Lin Che calls through the door to lure the courier back, creating a new cover-up risk.",
    modeAppend: "Append to chapter card",
    modeReplace: "Replace chapter card",
    cancel: "Cancel",
    confirm: "Write to card",
    saving: "Writing…",
    failed: "Failed to write to chapter card. Please check for updates."
  }
});

const props = defineProps<{
  bookId: string;
  chapterTitle: string;
  cardFileId: string;
}>();

const emit = defineEmits<{
  close: [];
  committed: [];
}>();

const noteText = ref("");
const writeMode = ref<"append" | "replace">("append");
const saving = ref(false);
const errorText = ref("");
const textareaRef = ref<HTMLTextAreaElement | null>(null);

async function submit(): Promise<void> {
  const trimmed = noteText.value.trim();
  if (!trimmed || saving.value) return;
  const api = resolveLongWorkspaceApi();
  if (!api?.readDocument || !api?.writeDocument) return;
  saving.value = true;
  errorText.value = "";
  try {
    const current = await api.readDocument({
      bookId: props.bookId,
      fileId: props.cardFileId,
      offset: 0,
      maxCharacters: 200_000
    });
    const nextContent =
      writeMode.value === "replace" || !current.content.trim()
        ? trimmed + "\n"
        : `${current.content.trimEnd()}\n\n- ${trimmed}\n`;
    await api.writeDocument({
      bookId: props.bookId,
      fileId: props.cardFileId,
      content: nextContent,
      expectedUpdatedAt: current.file.updatedAt
    });
    emit("committed");
    emit("close");
  } catch {
    errorText.value = t("failed");
  } finally {
    saving.value = false;
  }
}

onMounted(() => {
  void nextTick(() => {
    textareaRef.value?.focus();
  });
});
</script>

<template>
  <div
    class="long-commit-card-backdrop"
    role="dialog"
    aria-modal="true"
    :aria-label="t('title', { chapter: chapterTitle })"
    @keydown.esc.prevent="emit('close')"
  >
    <div class="long-commit-card-modal">
      <div class="long-commit-card-head">
        <h3>{{ t("title", { chapter: chapterTitle }) }}</h3>
        <button
          type="button"
          class="long-commit-card-close"
          :aria-label="t('cancel')"
          @click="emit('close')"
        >
          <AppIcon name="close" :size="14" />
        </button>
      </div>
      <p class="long-commit-card-hint">{{ t("hint") }}</p>
      <textarea
        ref="textareaRef"
        v-model="noteText"
        class="long-commit-card-textarea"
        rows="4"
        :placeholder="t('placeholder')"
      />
      <div class="long-commit-card-modes">
        <label>
          <input v-model="writeMode" type="radio" value="append" />
          {{ t("modeAppend") }}
        </label>
        <label>
          <input v-model="writeMode" type="radio" value="replace" />
          {{ t("modeReplace") }}
        </label>
      </div>
      <p v-if="errorText" class="long-commit-card-error">{{ errorText }}</p>
      <div class="long-commit-card-actions">
        <button
          type="button"
          class="long-commit-card-btn"
          :disabled="saving"
          @click="emit('close')"
        >
          {{ t("cancel") }}
        </button>
        <button
          type="button"
          class="long-commit-card-btn is-primary"
          :disabled="saving || !noteText.trim()"
          @click="submit"
        >
          {{ saving ? t("saving") : t("confirm") }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.long-commit-card-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1200;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(15, 23, 42, 0.38);
}

.long-commit-card-modal {
  width: min(500px, calc(100vw - 32px));
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px 18px;
  border: 1px solid var(--theme-line);
  border-radius: 12px;
  background: var(--surface-main);
  box-shadow: 0 18px 42px rgba(15, 23, 42, 0.22);
}

.long-commit-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.long-commit-card-head h3 {
  margin: 0;
  font-size: 1rem;
  font-weight: 600;
  color: var(--text-primary);
}

.long-commit-card-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
}

.long-commit-card-close:hover {
  background: var(--surface-hover);
  color: var(--text-primary);
}

.long-commit-card-hint {
  margin: 0;
  font-size: 0.785714rem;
  line-height: 1.5;
  color: var(--text-secondary);
}

.long-commit-card-textarea {
  width: 100%;
  padding: 9px 11px;
  border: 1px solid var(--theme-line);
  border-radius: 8px;
  background: var(--surface-raised, var(--surface-main));
  color: var(--text-primary);
  font-size: 0.857143rem;
  line-height: 1.6;
  resize: vertical;
  outline: none;
}

.long-commit-card-textarea:focus {
  border-color: var(--accent);
}

.long-commit-card-modes {
  display: flex;
  align-items: center;
  gap: 16px;
  font-size: 0.785714rem;
  color: var(--text-secondary);
}

.long-commit-card-modes label {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  cursor: pointer;
}

.long-commit-card-error {
  margin: 0;
  font-size: 0.785714rem;
  color: var(--danger);
}

.long-commit-card-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 2px;
}

.long-commit-card-btn {
  height: 32px;
  padding: 0 14px;
  border: 1px solid var(--theme-line);
  border-radius: 7px;
  background: var(--surface-main);
  color: var(--text-primary);
  font-size: 0.857143rem;
  cursor: pointer;
}

.long-commit-card-btn.is-primary {
  border-color: var(--accent);
  background: var(--accent);
  color: var(--accent-ink, #fff);
  font-weight: 500;
}

.long-commit-card-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
