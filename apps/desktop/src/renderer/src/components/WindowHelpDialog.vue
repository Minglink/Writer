<script setup lang="ts">
import { createScopedTranslator } from "../i18n";
import { onBeforeUnmount, onMounted, ref } from "vue";
import AppIcon from "./AppIcon.vue";
import WriterWordmark from "./WriterWordmark.vue";

const t = createScopedTranslator("components.windowHelpDialog");
const emit = defineEmits<{ close: [] }>();
const close = ref<HTMLButtonElement | null>(null);
const appVersion = ref("0.1.0");
let previous: HTMLElement | null = null;

onMounted(() => {
  previous = document.activeElement as HTMLElement | null;
  close.value?.focus();
  const api = window.writer?.updates;
  if (api?.getState) {
    void api
      .getState()
      .then((state) => {
        if (state?.currentVersion && state.currentVersion !== "—") {
          appVersion.value = state.currentVersion;
        }
      })
      .catch(() => {});
  }
});

onBeforeUnmount(() => {
  previous?.focus();
});
</script>

<template>
  <Teleport to="body">
    <div class="dialog-backdrop" @mousedown.self="emit('close')">
      <section
        class="dialog-card window-help about-writer-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="window-help-title"
        @keydown.esc.stop="emit('close')"
        @keydown.tab.prevent="close?.focus()"
      >
        <header class="about-writer-hero">
          <div class="about-writer-seal" aria-hidden="true">
            <AppIcon name="logo" :size="33" />
          </div>
          <div class="about-writer-identity">
            <div class="about-writer-title-row">
              <h2
                id="window-help-title"
                class="about-writer-wordmark"
                aria-label="Writer"
              >
                <WriterWordmark aria-hidden="true" />
              </h2>
              <span class="about-writer-version">
                {{ t("versionLabel") }} v{{ appVersion }}
              </span>
            </div>
            <p class="about-writer-tagline">{{ t("localFirstTagline") }}</p>
          </div>
        </header>

        <div class="dialog-content about-writer-body">
          <p class="about-writer-lead">
            {{ t("deepWriteIsAWritingWorkspaceForLocalWorksAnd") }}
          </p>
          <ul class="about-writer-notes">
            <li>{{ t("createOrOpenAWorkFromFileThenChoose") }}</li>
            <li>{{ t("changePaneLayoutFromViewOrOpenAppearanceSettings") }}</li>
            <li>{{ t("pressF10ToFocusTheMenuUseArrowKeys") }}</li>
            <li>
              {{ t("closingTheWindowFollowsGeneralSettingsWhenTheTray") }}
            </li>
          </ul>
        </div>

        <footer class="dialog-footer about-writer-footer">
          <button
            ref="close"
            class="primary-button dialog-primary-button about-writer-close"
            type="button"
            @click="emit('close')"
          >
            {{ t("close") }}
          </button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.about-writer-dialog {
  padding: 0;
  overflow: hidden;
  border: 1px solid var(--theme-line);
  border-radius: 14px;
  background: var(--surface-main);
}

.about-writer-hero {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 24px 24px 20px;
  border-bottom: 1px solid var(--theme-line-soft);
  background: var(--surface-raised);
}

.about-writer-seal {
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  width: 48px;
  height: 48px;
  border-radius: 12px;
  background: var(--text-primary);
  color: var(--surface-main);
  box-shadow:
    inset 0 1px 0 color-mix(in srgb, var(--surface-main) 20%, transparent),
    0 2px 8px color-mix(in srgb, var(--theme-foreground) 14%, transparent);
}

.about-writer-identity {
  min-width: 0;
  display: grid;
  gap: 4px;
}

.about-writer-title-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}

.about-writer-wordmark {
  margin: 0;
  color: var(--text-primary);
  font-size: 1.57143rem;
}

.about-writer-version {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border: 1px solid var(--theme-line);
  border-radius: 999px;
  background: var(--surface-main);
  color: var(--text-secondary);
  font-size: 0.75rem;
  font-weight: 560;
  letter-spacing: 0.02em;
}

.about-writer-tagline {
  margin: 0;
  color: var(--text-secondary);
  font-size: 0.857143rem;
  line-height: 1.45;
}

.about-writer-body {
  display: grid;
  gap: 12px;
  padding: 18px 24px 20px;
}

.about-writer-lead {
  color: var(--text-primary);
  font-size: 0.928571rem;
  font-weight: 520;
  line-height: 1.65;
}

.about-writer-notes {
  display: grid;
  gap: 8px;
  padding: 12px 14px;
  border: 1px solid var(--theme-line-soft);
  border-radius: 10px;
  background: var(--surface-muted);
}

.about-writer-notes li {
  position: relative;
  padding-left: 12px;
  color: var(--text-secondary);
  font-size: 0.821429rem;
  line-height: 1.6;
}

.about-writer-notes li::before {
  position: absolute;
  top: 0.62em;
  left: 0;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--text-tertiary);
  content: "";
}

.about-writer-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 16px;
  padding: 14px 24px;
  border-top: 1px solid var(--theme-line-soft);
  background: var(--surface-raised);
}

.about-writer-close {
  min-height: 34px;
  padding: 0 18px;
  border-radius: 8px;
  font-size: 0.892857rem;
  font-weight: 560;
}
</style>
