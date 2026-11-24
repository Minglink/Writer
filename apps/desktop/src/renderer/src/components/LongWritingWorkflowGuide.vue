<script setup lang="ts">
import { computed, ref } from "vue";
import type { LongWorkspaceIndexSnapshot } from "@writer/contracts";
import {
  computeLongWorkflowSteps,
  longCraftT,
  resolveWebNovelCraftSkills
} from "../data/longWebNovelCraft";
import AppIcon from "./AppIcon.vue";

const props = defineProps<{
  bookTitle: string;
  genre: string;
  targetLabel?: string;
  workspaceIndex: LongWorkspaceIndexSnapshot | null;
  runtimeAvailable: boolean;
}>();

const emit = defineEmits<{
  fillPrompt: [prompt: string];
  openDraft: [];
}>();

const expanded = ref(false);
const steps = computed(() =>
  computeLongWorkflowSteps(props.bookTitle, props.genre, props.workspaceIndex)
);
const doneCount = computed(() => steps.value.filter((s) => s.done).length);
const hasWrittenDraft = computed(
  () =>
    props.workspaceIndex?.chapters.some(
      (entry) => entry.bodyStatus !== "empty"
    ) ?? false
);
const craftSkills = computed(() =>
  resolveWebNovelCraftSkills(props.bookTitle, props.genre)
);
const planPrompt = computed(() => steps.value[0]?.prompt ?? "");
</script>

<template>
  <div class="long-craft-guide">
    <header class="long-craft-header">
      <span class="long-craft-seal" aria-hidden="true">
        <AppIcon name="logo" :size="18" />
      </span>
      <div class="long-craft-heading">
        <span class="long-craft-eyebrow">{{ longCraftT("eyebrow") }}</span>
        <div class="long-craft-book-row">
          <h1>{{ bookTitle }}</h1>
          <span v-if="genre" class="long-craft-genre-pill">{{ genre }}</span>
        </div>
        <p v-if="targetLabel" class="long-craft-target">
          {{ longCraftT("targetScope", { target: targetLabel }) }}
        </p>
      </div>
    </header>

    <div class="long-craft-primary-actions">
      <button
        type="button"
        class="long-craft-primary-btn"
        @click="emit('openDraft')"
      >
        {{
          hasWrittenDraft
            ? longCraftT("continueWriting")
            : longCraftT("startWriting")
        }}
      </button>
      <button
        type="button"
        class="long-craft-secondary-btn"
        :disabled="!runtimeAvailable"
        @click="emit('fillPrompt', planPrompt)"
      >
        {{ longCraftT("planBook") }}
      </button>
    </div>

    <div class="long-craft-disclosure">
      <button
        type="button"
        class="long-craft-toggle"
        :aria-expanded="expanded"
        @click="expanded = !expanded"
      >
        <span>
          {{
            expanded ? longCraftT("collapseGuide") : longCraftT("expandGuide")
          }}
        </span>
        <span class="long-craft-toggle-meta">
          {{
            longCraftT("progressSummary", {
              done: doneCount,
              total: steps.length
            })
          }}
        </span>
      </button>

      <div v-if="expanded" class="long-craft-drawer">
        <section class="long-craft-section">
          <div class="long-craft-section-head">
            <h2>{{ longCraftT("workflowTitle") }}</h2>
            <p>{{ longCraftT("workflowHint") }}</p>
          </div>
          <div class="long-craft-steps">
            <button
              v-for="step in steps"
              :key="step.id"
              type="button"
              class="long-craft-step"
              :class="{ 'is-active': step.active, 'is-done': step.done }"
              :disabled="!runtimeAvailable"
              @click="emit('fillPrompt', step.prompt)"
            >
              <span class="long-craft-step-index">{{ step.order }}</span>
              <span class="long-craft-step-copy">
                <strong>{{ step.title }}</strong>
                <small>{{ step.summary }}</small>
              </span>
              <span class="long-craft-step-status">
                {{ step.active ? longCraftT("statusNext") : step.statusLabel }}
              </span>
            </button>
          </div>
        </section>

        <section class="long-craft-section">
          <div class="long-craft-section-head">
            <h2>{{ longCraftT("toolkitTitle") }}</h2>
            <p>{{ longCraftT("toolkitHint") }}</p>
          </div>
          <div class="long-craft-skills">
            <button
              v-for="skill in craftSkills"
              :key="skill.id"
              type="button"
              class="long-craft-skill-chip"
              :title="skill.description"
              :disabled="!runtimeAvailable"
              @click="emit('fillPrompt', skill.prompt)"
            >
              {{ skill.title }}
            </button>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>

<style scoped>
.long-craft-guide {
  display: grid;
  gap: 14px;
  width: min(560px, calc(100% - 28px));
  margin: auto;
  padding: 20px 0 12px;
}

.long-craft-header {
  display: flex;
  align-items: center;
  gap: 12px;
}

.long-craft-seal {
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  width: 36px;
  height: 36px;
  border-radius: 9px;
  background: var(--text-primary);
  color: var(--surface-main);
}

.long-craft-heading {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.long-craft-eyebrow {
  color: var(--text-tertiary);
  font-size: 0.678571rem;
  font-weight: 600;
  letter-spacing: 0.1em;
}

.long-craft-book-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.long-craft-book-row h1 {
  margin: 0;
  color: var(--text-primary);
  font-family: var(--editor-font);
  font-size: 1.28571rem;
  font-weight: 620;
}

.long-craft-genre-pill {
  padding: 1px 7px;
  border: 1px solid var(--theme-line);
  border-radius: 999px;
  background: var(--surface-raised);
  color: var(--text-secondary);
  font-size: 0.714286rem;
}

.long-craft-target {
  margin: 0;
  color: var(--text-tertiary);
  font-size: 0.785714rem;
}

.long-craft-primary-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.long-craft-primary-btn,
.long-craft-secondary-btn {
  min-height: 34px;
  padding: 0 14px;
  border-radius: 8px;
  font-size: 0.857143rem;
  font-weight: 560;
  cursor: pointer;
}

.long-craft-primary-btn {
  background: var(--neutral-solid);
  color: var(--surface-main);
}

:global(html[data-theme="dark"]) .long-craft-primary-btn {
  background: var(--accent);
  color: var(--accent-contrast);
}

.long-craft-secondary-btn {
  border: 1px solid var(--theme-line);
  background: var(--surface-raised);
  color: var(--text-primary);
}

.long-craft-secondary-btn:hover:not(:disabled) {
  background: var(--surface-hover);
}

.long-craft-disclosure {
  border: 1px solid var(--theme-line-soft);
  border-radius: 10px;
  background: var(--surface-raised);
  overflow: hidden;
}

.long-craft-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  width: 100%;
  padding: 9px 12px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 0.821429rem;
  font-weight: 560;
  text-align: left;
  cursor: pointer;
}

.long-craft-toggle:hover {
  background: var(--surface-hover);
  color: var(--text-primary);
}

.long-craft-toggle-meta {
  color: var(--text-tertiary);
  font-size: 0.75rem;
  font-weight: 500;
}

.long-craft-drawer {
  display: grid;
  gap: 14px;
  padding: 12px;
  border-top: 1px solid var(--theme-line-soft);
  background: var(--surface-main);
}

.long-craft-section {
  display: grid;
  gap: 8px;
}

.long-craft-section-head {
  display: grid;
  gap: 2px;
}

.long-craft-section-head h2 {
  margin: 0;
  color: var(--text-primary);
  font-size: 0.857143rem;
  font-weight: 600;
}

.long-craft-section-head p {
  margin: 0;
  color: var(--text-tertiary);
  font-size: 0.75rem;
}

.long-craft-steps {
  display: grid;
  gap: 6px;
}

.long-craft-step {
  display: grid;
  grid-template-columns: 20px minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  padding: 7px 9px;
  border: 1px solid var(--theme-line-soft);
  border-radius: 8px;
  background: var(--surface-raised);
  color: var(--text-primary);
  text-align: left;
  cursor: pointer;
}

.long-craft-step:hover:not(:disabled) {
  border-color: var(--theme-line);
  background: var(--surface-muted);
}

.long-craft-step.is-active {
  border-color: color-mix(in srgb, var(--accent) 55%, var(--theme-line));
}

.long-craft-step-index {
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  border-radius: 5px;
  background: var(--surface-muted);
  color: var(--text-secondary);
  font-size: 0.714286rem;
  font-weight: 620;
}

.long-craft-step.is-active .long-craft-step-index {
  background: var(--accent);
  color: var(--accent-contrast);
}

.long-craft-step-copy {
  display: grid;
  min-width: 0;
}

.long-craft-step-copy strong {
  font-size: 0.821429rem;
  font-weight: 580;
}

.long-craft-step-copy small {
  overflow: hidden;
  color: var(--text-secondary);
  font-size: 0.714286rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.long-craft-step-status {
  color: var(--text-tertiary);
  font-size: 0.714286rem;
  white-space: nowrap;
}

.long-craft-step.is-active .long-craft-step-status {
  color: var(--accent);
  font-weight: 560;
}

.long-craft-skills {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.long-craft-skill-chip {
  padding: 5px 10px;
  border: 1px solid var(--theme-line);
  border-radius: 999px;
  background: var(--surface-raised);
  color: var(--text-secondary);
  font-size: 0.785714rem;
  cursor: pointer;
}

.long-craft-skill-chip:hover:not(:disabled) {
  border-color: color-mix(in srgb, var(--accent) 45%, var(--theme-line));
  color: var(--text-primary);
}

.long-craft-secondary-btn:disabled,
.long-craft-step:disabled,
.long-craft-skill-chip:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
</style>
