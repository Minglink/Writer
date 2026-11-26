<script setup lang="ts">
import { computed, ref } from "vue";
import {
  createScopedTranslator,
  locale,
  registerFeatureMessages
} from "../i18n";
import {
  LONG_CHAPTER_TARGET_PRESETS,
  longTemplateT,
  nextChapterTargetPreset,
  type LongChapterTargetPreset
} from "../data/longWebNovelTemplates";

const saveStateT = registerFeatureMessages("longEditorSaveState", {
  "zh-CN": {
    saved: "已保存",
    saving: "保存中…",
    unsaved: "未保存"
  },
  "en-US": {
    saved: "Saved",
    saving: "Saving…",
    unsaved: "Unsaved"
  }
});

const t = createScopedTranslator("components.longEditorFooterMeta");
const STORAGE_KEY = "writer.longChapterTargetChars";

const props = defineProps<{
  isChapterBody: boolean;
  characterCount: number;
  autoSaveEnabled: boolean;
  readOnly?: boolean;
  saveState?: "saved" | "saving" | "unsaved" | null;
}>();

const saveStateLabel = computed(() => {
  if (!props.saveState) {
    return "";
  }
  return saveStateT(props.saveState);
});

function loadTarget(): LongChapterTargetPreset {
  try {
    const raw = Number(window.localStorage.getItem(STORAGE_KEY));
    if (LONG_CHAPTER_TARGET_PRESETS.includes(raw as LongChapterTargetPreset)) {
      return raw as LongChapterTargetPreset;
    }
  } catch {
    // Ignore storage read errors in restricted environments.
  }
  return 3000;
}

const chapterTarget = ref<LongChapterTargetPreset>(loadTarget());

function cycleTarget(): void {
  const next = nextChapterTargetPreset(chapterTarget.value);
  chapterTarget.value = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, String(next));
  } catch {
    // Ignore storage write errors.
  }
}

const reachedTarget = computed(
  () => props.characterCount >= chapterTarget.value
);
const targetLabel = computed(() => {
  const targetText = chapterTarget.value.toLocaleString(locale.value) ?? "";
  if (reachedTarget.value) {
    return longTemplateT("targetReached", { target: targetText });
  }
  const remaining = Math.max(
    0,
    chapterTarget.value - props.characterCount
  ).toLocaleString(locale.value);
  return longTemplateT("targetRemaining", {
    target: targetText,
    remaining: remaining ?? ""
  });
});
</script>

<template>
  <span class="long-footer-meta">
    <span>
      {{
        t(isChapterBody ? "chapterCharactersMessage" : "charactersMessage", {
          arg0: characterCount.toLocaleString(locale) ?? ""
        })
      }}
    </span>
    <button
      v-if="isChapterBody"
      type="button"
      class="long-footer-target-pill"
      :class="{ 'is-reached': reachedTarget }"
      :title="longTemplateT('targetButtonTitle')"
      @click="cycleTarget"
    >
      {{ targetLabel }}
    </button>
    <span v-if="!readOnly">
      {{
        t("autosaveMessage", {
          arg0: (autoSaveEnabled ? t("on") : t("off")) ?? ""
        })
      }}
    </span>
    <span
      v-if="saveState"
      class="long-footer-save-state"
      :class="`is-${saveState}`"
      role="status"
      aria-live="polite"
    >
      {{ saveStateLabel }}
    </span>
  </span>
</template>

<style scoped>
.long-footer-meta {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
}

.long-footer-meta > span {
  overflow: hidden;
  text-overflow: ellipsis;
}

.long-footer-target-pill {
  flex: 0 0 auto;
  padding: 1px 7px;
  border: 1px solid var(--theme-line-soft);
  border-radius: 999px;
  background: var(--surface-main);
  color: var(--text-tertiary);
  font-size: 0.714286rem;
  line-height: 1.45;
  cursor: pointer;
  transition:
    border-color 120ms ease,
    color 120ms ease;
}

.long-footer-target-pill:hover {
  border-color: var(--theme-line);
  color: var(--text-primary);
}

.long-footer-target-pill.is-reached {
  border-color: color-mix(in srgb, var(--success) 45%, var(--theme-line-soft));
  background: var(--success-soft);
  color: var(--success);
}

.long-footer-save-state {
  flex: 0 0 auto;
  padding: 1px 7px;
  border-radius: 999px;
  font-size: 0.714286rem;
  line-height: 1.45;
  border: 1px solid var(--theme-line-soft);
  background: var(--surface-main);
  color: var(--text-secondary);
}

.long-footer-save-state.is-saved {
  border-color: color-mix(in srgb, var(--success) 40%, var(--theme-line-soft));
  background: var(--success-soft);
  color: var(--success);
}

.long-footer-save-state.is-saving {
  border-color: color-mix(in srgb, var(--accent) 40%, var(--theme-line-soft));
  background: color-mix(in srgb, var(--accent) 10%, var(--surface-main));
  color: var(--accent);
}

.long-footer-save-state.is-unsaved {
  border-color: color-mix(in srgb, var(--warning) 45%, var(--theme-line-soft));
  background: color-mix(in srgb, var(--warning) 10%, var(--surface-main));
  color: var(--warning);
}
</style>
