<script setup lang="ts">
import { ref } from "vue";
import { registerFeatureMessages } from "../i18n";
import type { EmptyCardBrainstormStyle } from "../utils/longCoCreationPrompts";
import AppIcon from "./AppIcon.vue";

const t = registerFeatureMessages("longEmptyChapterCoCreationCard", {
  "zh-CN": {
    title: "一起想故事",
    subtitle: "仅在会话推演，不自动改写章卡；也可以直接下方落笔。",
    placeholder: "写一个画面或卡点，例如：我想写一个回自己家还得敲门的人…",
    askOne: "只问我一个问题",
    twoPaths: "给两条带代价的走向",
    dismiss: "收起提示"
  },
  "en-US": {
    title: "Brainstorm together",
    subtitle: "Read-only discussion in chat; you can also start typing below.",
    placeholder:
      "Start with a single image or blocker, e.g. someone who has to knock on their own door…",
    askOne: "Ask me 1 question",
    twoPaths: "2 directions with stakes",
    dismiss: "Dismiss"
  }
});

defineProps<{
  disabled?: boolean;
}>();

const emit = defineEmits<{
  brainstorm: [payload: { spark: string; style: EmptyCardBrainstormStyle }];
  dismiss: [];
}>();

const sparkText = ref("");

function trigger(style: EmptyCardBrainstormStyle): void {
  emit("brainstorm", {
    spark: sparkText.value.trim(),
    style
  });
}
</script>

<template>
  <section class="long-empty-card-cocreate" :aria-label="t('title')">
    <div class="long-empty-card-cocreate-head">
      <div class="long-empty-card-cocreate-titles">
        <strong>{{ t("title") }}</strong>
        <span>{{ t("subtitle") }}</span>
      </div>
      <button
        type="button"
        class="long-empty-card-cocreate-dismiss"
        :aria-label="t('dismiss')"
        :title="t('dismiss')"
        @click="emit('dismiss')"
      >
        <AppIcon name="close" :size="13" />
      </button>
    </div>

    <div class="long-empty-card-cocreate-row">
      <input
        v-model="sparkText"
        type="text"
        class="long-empty-card-cocreate-input"
        :placeholder="t('placeholder')"
        :disabled="disabled"
        @keydown.enter.prevent="trigger('ask_one')"
      />
      <div class="long-empty-card-cocreate-actions">
        <button
          type="button"
          class="long-empty-card-cocreate-btn is-primary"
          :disabled="disabled"
          @click="trigger('ask_one')"
        >
          {{ t("askOne") }}
        </button>
        <button
          type="button"
          class="long-empty-card-cocreate-btn"
          :disabled="disabled"
          @click="trigger('two_paths')"
        >
          {{ t("twoPaths") }}
        </button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.long-empty-card-cocreate {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--theme-line-soft);
  background: var(--surface-raised, var(--surface-main));
}

.long-empty-card-cocreate-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.long-empty-card-cocreate-titles {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}

.long-empty-card-cocreate-titles strong {
  font-size: 0.857143rem;
  font-weight: 600;
  color: var(--text-primary);
}

.long-empty-card-cocreate-titles span {
  font-size: 0.785714rem;
  color: var(--text-tertiary);
}

.long-empty-card-cocreate-dismiss {
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

.long-empty-card-cocreate-dismiss:hover {
  background: var(--surface-hover);
  color: var(--text-primary);
}

.long-empty-card-cocreate-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.long-empty-card-cocreate-input {
  flex: 1 1 240px;
  height: 30px;
  padding: 0 10px;
  border: 1px solid var(--theme-line);
  border-radius: 7px;
  background: var(--surface-main);
  color: var(--text-primary);
  font-size: 0.857143rem;
  outline: none;
}

.long-empty-card-cocreate-input:focus {
  border-color: var(--accent);
}

.long-empty-card-cocreate-actions {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.long-empty-card-cocreate-btn {
  height: 30px;
  padding: 0 11px;
  border: 1px solid var(--theme-line);
  border-radius: 7px;
  background: var(--surface-main);
  color: var(--text-primary);
  font-size: 0.785714rem;
  font-weight: 500;
  white-space: nowrap;
  cursor: pointer;
  transition:
    border-color 120ms ease,
    background-color 120ms ease,
    color 120ms ease;
}

.long-empty-card-cocreate-btn:hover:not(:disabled) {
  background: var(--surface-hover);
}

.long-empty-card-cocreate-btn.is-primary {
  border-color: color-mix(in srgb, var(--accent) 40%, var(--theme-line-soft));
  background: color-mix(in srgb, var(--accent) 12%, var(--surface-main));
  color: var(--accent);
}

.long-empty-card-cocreate-btn.is-primary:hover:not(:disabled) {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 18%, var(--surface-main));
}
</style>
