<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import type { LongCoCreationMode } from "@writer/contracts";
import { registerFeatureMessages } from "../i18n";
import AppIcon from "./AppIcon.vue";

const t = registerFeatureMessages("longSelectionCoCreationBar", {
  "zh-CN": {
    toolbarLabel: "选区共创与边注动作",
    marginNote: "记边注",
    marginNoteTitle: "在这段原句旁留一句本章笔记，保存后焦点交回正文",
    marginNotePlaceholder: "写下一句想法、待定细节或修改备忘…",
    badgeMarginNote: "本章边注",
    saveNote: "保存",
    critique: "读读这段",
    critiqueTitle: "只读反馈：先当读者给 1–2 条对准原句的边注，不改正文",
    brainstorm: "想下一幕",
    brainstormTitle: "只读推演：给追问或两条带代价的走向，不改正文",
    tryRewrite: "试改此处",
    tryRewriteTitle: "强制手动差异预览：仅试改选中原句，确认后才落盘",
    critiquePlaceholder: "写一句希望读者感受到的效果（可留空直接读）…",
    brainstormPlaceholder: "写下卡点或想守住的悬念（可留空直接推演）…",
    tryRewritePlaceholder: "写下希望达到的局部效果（例如：删掉说破的那句）…",
    badgeReadOnly: "只读",
    badgeManualDiff: "手动差异预览",
    send: "发送",
    back: "返回"
  },
  "en-US": {
    toolbarLabel: "Selection co-creation and note actions",
    marginNote: "Add note",
    marginNoteTitle: "Save a margin note for this quote and return to editing",
    marginNotePlaceholder: "Jot down a thought, reminder, or open detail…",
    badgeMarginNote: "Chapter note",
    saveNote: "Save",
    critique: "Read this",
    critiqueTitle: "Read-only reader margin notes without editing text",
    brainstorm: "Next scene",
    brainstormTitle: "Read-only next-scene ideas with stakes, no edits",
    tryRewrite: "Try rewrite",
    tryRewriteTitle: "Forced manual diff preview for this selection only",
    critiquePlaceholder: "Intended reader feel (optional)…",
    brainstormPlaceholder: "Blocker or suspense to keep (optional)…",
    tryRewritePlaceholder: "Desired local adjustment (optional)…",
    badgeReadOnly: "Read-only",
    badgeManualDiff: "Manual diff",
    send: "Send",
    back: "Back"
  }
});

const props = defineProps<{
  visible: boolean;
  topPx: number;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  submit: [payload: { mode: LongCoCreationMode; intent: string }];
  addNote: [payload: { content: string; done: (succeeded: boolean) => void }];
  close: [];
}>();

type SelectionActionMode = LongCoCreationMode | "note";

const activeMode = ref<SelectionActionMode | null>(null);
const intentText = ref("");
const intentInput = ref<HTMLInputElement | null>(null);

const placeholder = computed(() => {
  if (activeMode.value === "note") return t("marginNotePlaceholder");
  if (activeMode.value === "brainstorm") return t("brainstormPlaceholder");
  if (activeMode.value === "try_rewrite") return t("tryRewritePlaceholder");
  return t("critiquePlaceholder");
});

const modeBadge = computed(() => {
  if (activeMode.value === "note") return t("badgeMarginNote");
  return activeMode.value === "try_rewrite"
    ? t("badgeManualDiff")
    : t("badgeReadOnly");
});

function openMode(mode: SelectionActionMode): void {
  if (props.disabled) return;
  activeMode.value = mode;
  intentText.value = "";
  void nextTick(() => {
    intentInput.value?.focus();
  });
}

function resetMode(): void {
  activeMode.value = null;
  intentText.value = "";
}

function submitCurrent(): void {
  if (!activeMode.value || props.disabled) return;
  const mode = activeMode.value;
  const intent = intentText.value.trim();
  if (mode === "note") {
    if (!intent) return;
    emit("addNote", {
      content: intent,
      done: (succeeded) => {
        if (succeeded) {
          resetMode();
        }
      }
    });
    return;
  }
  resetMode();
  emit("submit", { mode, intent });
}

function handleIntentKeydown(event: KeyboardEvent): void {
  if (event.key === "Enter" && !event.isComposing) {
    event.preventDefault();
    submitCurrent();
    return;
  }
  if (event.key === "Escape") {
    event.preventDefault();
    resetMode();
    emit("close");
  }
}

watch(
  () => props.visible,
  (visible) => {
    if (!visible) {
      resetMode();
    }
  }
);
</script>

<template>
  <div
    v-if="visible"
    class="long-selection-cocreate-bar"
    :class="{ 'is-expanded': activeMode !== null }"
    :style="{ top: `${topPx}px` }"
    role="toolbar"
    :aria-label="t('toolbarLabel')"
  >
    <template v-if="!activeMode">
      <button
        type="button"
        class="long-selection-cocreate-btn is-primary"
        :title="t('marginNoteTitle')"
        :disabled="disabled"
        @mousedown.prevent
        @click="openMode('note')"
      >
        {{ t("marginNote") }}
      </button>
      <button
        type="button"
        class="long-selection-cocreate-btn"
        :title="t('critiqueTitle')"
        :disabled="disabled"
        @mousedown.prevent
        @click="openMode('critique')"
      >
        {{ t("critique") }}
      </button>
      <button
        type="button"
        class="long-selection-cocreate-btn"
        :title="t('brainstormTitle')"
        :disabled="disabled"
        @mousedown.prevent
        @click="openMode('brainstorm')"
      >
        {{ t("brainstorm") }}
      </button>
      <button
        type="button"
        class="long-selection-cocreate-btn"
        :title="t('tryRewriteTitle')"
        :disabled="disabled"
        @mousedown.prevent
        @click="openMode('try_rewrite')"
      >
        {{ t("tryRewrite") }}
      </button>
    </template>

    <template v-else>
      <span
        class="long-selection-cocreate-badge"
        :class="{ 'is-manual': activeMode === 'try_rewrite' }"
      >
        {{ modeBadge }}
      </span>
      <input
        ref="intentInput"
        v-model="intentText"
        type="text"
        class="long-selection-cocreate-input"
        :placeholder="placeholder"
        @keydown="handleIntentKeydown"
      />
      <button
        type="button"
        class="long-selection-cocreate-send"
        :disabled="disabled || (activeMode === 'note' && !intentText.trim())"
        @mousedown.prevent
        @click="submitCurrent"
      >
        {{ activeMode === "note" ? t("saveNote") : t("send") }}
      </button>
      <button
        type="button"
        class="long-selection-cocreate-close"
        :aria-label="t('back')"
        :title="t('back')"
        @mousedown.prevent
        @click="resetMode"
      >
        <AppIcon name="close" :size="12" />
      </button>
    </template>
  </div>
</template>

<style scoped>
.long-selection-cocreate-bar {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  z-index: 20;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: min(560px, calc(100% - 24px));
  padding: 4px 6px;
  border: 1px solid var(--theme-line);
  border-radius: 9px;
  background: var(--surface-raised, var(--surface-main));
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.14);
}

.long-selection-cocreate-bar.is-expanded {
  width: min(520px, calc(100% - 24px));
  gap: 6px;
  padding: 5px 7px;
}

.long-selection-cocreate-btn {
  flex: 0 0 auto;
  height: 26px;
  padding: 0 10px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: var(--text-primary);
  font-size: 0.785714rem;
  font-weight: 500;
  white-space: nowrap;
  cursor: pointer;
  transition:
    background-color 120ms ease,
    border-color 120ms ease,
    color 120ms ease;
}

.long-selection-cocreate-btn:hover:not(:disabled) {
  background: var(--surface-hover);
  border-color: var(--theme-line-soft);
}

.long-selection-cocreate-btn.is-primary {
  background: color-mix(in srgb, var(--accent) 12%, var(--surface-main));
  border-color: color-mix(in srgb, var(--accent) 35%, var(--theme-line-soft));
  color: var(--accent);
}

.long-selection-cocreate-btn.is-primary:hover:not(:disabled) {
  background: color-mix(in srgb, var(--accent) 18%, var(--surface-main));
  border-color: var(--accent);
}

.long-selection-cocreate-badge {
  flex: 0 0 auto;
  padding: 2px 6px;
  border-radius: 5px;
  font-size: 0.714286rem;
  background: color-mix(in srgb, var(--accent) 12%, var(--surface-main));
  color: var(--accent);
  white-space: nowrap;
}

.long-selection-cocreate-badge.is-manual {
  background: color-mix(in srgb, var(--warning) 12%, var(--surface-main));
  color: var(--warning);
}

.long-selection-cocreate-input {
  flex: 1 1 auto;
  min-width: 120px;
  height: 26px;
  padding: 0 8px;
  border: 1px solid var(--theme-line-soft);
  border-radius: 6px;
  background: var(--surface-main);
  color: var(--text-primary);
  font-size: 0.785714rem;
  outline: none;
}

.long-selection-cocreate-input:focus {
  border-color: var(--accent);
}

.long-selection-cocreate-send {
  flex: 0 0 auto;
  height: 26px;
  padding: 0 10px;
  border: 1px solid var(--accent);
  border-radius: 6px;
  background: var(--accent);
  color: var(--accent-ink, #fff);
  font-size: 0.785714rem;
  font-weight: 500;
  cursor: pointer;
}

.long-selection-cocreate-close {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
}

.long-selection-cocreate-close:hover {
  background: var(--surface-hover);
  color: var(--text-primary);
}
</style>
