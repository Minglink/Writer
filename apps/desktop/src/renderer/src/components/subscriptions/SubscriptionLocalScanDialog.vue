<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch
} from "vue";
import type {
  SubscriptionLocalCandidate,
  SubscriptionProviderId
} from "@writer/contracts/renderer";
import { subT } from "./subscriptionLabels";
import type { LocalScanDialogState } from "./useSubscriptionModelSettings";

const props = defineProps<{
  state: LocalScanDialogState;
  providerNames: Readonly<Record<string, string>>;
}>();

const emit = defineEmits<{
  close: [];
  rescan: [provider?: SubscriptionProviderId];
  importSelected: [candidates: SubscriptionLocalCandidate[]];
}>();

const selectedKeys = ref<Set<string>>(new Set());
const listRef = ref<HTMLElement | null>(null);

function candidateKey(candidate: SubscriptionLocalCandidate): string {
  return `${candidate.provider}:${candidate.candidateId}`;
}

const selectedCandidates = computed(() =>
  props.state.candidates.filter((candidate) =>
    selectedKeys.value.has(candidateKey(candidate))
  )
);

function toggleKey(key: string): void {
  const next = new Set(selectedKeys.value);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  selectedKeys.value = next;
}

function selectAllNew(): void {
  const next = new Set<string>();
  for (const candidate of props.state.candidates) {
    if (!candidate.alreadyImported) {
      next.add(candidateKey(candidate));
    }
  }
  if (next.size === 0) {
    for (const candidate of props.state.candidates) {
      next.add(candidateKey(candidate));
    }
  }
  selectedKeys.value = next;
}

function handleSubmit(): void {
  if (props.state.importing || selectedCandidates.value.length === 0) return;
  emit("importSelected", selectedCandidates.value);
}

function handleKeydown(event: KeyboardEvent): void {
  if (props.state.open && event.key === "Escape" && !props.state.importing) {
    emit("close");
  }
}

watch(
  () =>
    [props.state.open, props.state.scanning, props.state.candidates] as const,
  ([open, scanning, candidates]) => {
    if (!open || scanning) return;
    const preselected = new Set<string>();
    for (const candidate of candidates) {
      if (!candidate.alreadyImported) {
        preselected.add(candidateKey(candidate));
      }
    }
    selectedKeys.value = preselected;
    void nextTick(() => {
      listRef.value?.querySelector<HTMLInputElement>("input")?.focus();
    });
  },
  { immediate: true }
);

onMounted(() => document.addEventListener("keydown", handleKeydown));
onBeforeUnmount(() => document.removeEventListener("keydown", handleKeydown));
</script>

<template>
  <Teleport to="body">
    <div
      v-if="state.open"
      class="dialog-backdrop sub-model-dialog-backdrop"
      @mousedown.self="!state.importing && emit('close')"
    >
      <section
        class="workspace-dialog sub-model-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sub-model-scan-title"
      >
        <header>
          <div>
            <span class="dialog-eyebrow">{{ subT("scanDialogEyebrow") }}</span>
            <h2 id="sub-model-scan-title">{{ subT("scanDialogTitle") }}</h2>
          </div>
          <button
            class="dialog-close"
            type="button"
            :aria-label="subT('closeButton')"
            :disabled="state.importing"
            @click="emit('close')"
          >
            ×
          </button>
        </header>

        <form class="dialog-content" @submit.prevent="handleSubmit">
          <p class="dialog-description">{{ subT("scanDialogDesc") }}</p>

          <div v-if="state.scanning" class="dialog-note sub-model-scan-note">
            {{ subT("scanLoading") }}
          </div>

          <div
            v-else-if="state.candidates.length === 0"
            class="dialog-note sub-model-scan-empty"
          >
            <strong>{{ subT("scanEmptyTitle") }}</strong>
            <p>{{ subT("scanEmptyDesc") }}</p>
          </div>

          <template v-else>
            <div class="sub-model-scan-toolbar">
              <button
                type="button"
                class="sub-model-link-btn"
                :disabled="state.importing"
                @click="selectAllNew"
              >
                {{ subT("scanSelectAll") }}
              </button>
            </div>
            <div ref="listRef" class="sub-model-scan-list">
              <label
                v-for="candidate in state.candidates"
                :key="candidateKey(candidate)"
                class="sub-model-scan-option"
                :class="{
                  'is-selected': selectedKeys.has(candidateKey(candidate))
                }"
              >
                <input
                  type="checkbox"
                  :checked="selectedKeys.has(candidateKey(candidate))"
                  :disabled="state.importing"
                  @change="toggleKey(candidateKey(candidate))"
                />
                <span class="sub-model-scan-option-body">
                  <span class="sub-model-scan-option-head">
                    <strong :title="candidate.displayName">{{
                      candidate.displayName
                    }}</strong>
                    <span class="sub-model-pill">{{
                      providerNames[candidate.provider] ?? candidate.provider
                    }}</span>
                    <span
                      v-if="candidate.alreadyImported"
                      class="sub-model-pill is-muted"
                    >
                      {{ subT("scanAlreadyImported") }}
                    </span>
                  </span>
                  <small class="sub-model-scan-option-meta">
                    <span
                      v-if="
                        candidate.email &&
                        candidate.email !== candidate.displayName
                      "
                      >{{ candidate.email }} · </span
                    >{{ candidate.sourceLabel
                    }}<template v-if="candidate.sourcePathHint">
                      ·
                      <code class="sub-model-inline-code">{{
                        candidate.sourcePathHint
                      }}</code></template
                    >
                  </small>
                </span>
              </label>
            </div>
          </template>

          <div class="dialog-actions sub-model-dialog-actions">
            <button
              type="button"
              class="dialog-secondary-button"
              :disabled="state.importing || state.scanning"
              @click="emit('rescan', state.providerFilter)"
            >
              {{ subT("scanRescanButton") }}
            </button>
            <button
              type="button"
              class="dialog-secondary-button"
              :disabled="state.importing"
              @click="emit('close')"
            >
              {{ subT("cancelButton") }}
            </button>
            <button
              type="submit"
              class="dialog-primary-button"
              :disabled="
                state.scanning ||
                state.importing ||
                selectedCandidates.length === 0
              "
            >
              {{
                state.importing
                  ? subT("scanImporting")
                  : subT("scanImportConfirm", {
                      count: selectedCandidates.length
                    })
              }}
            </button>
          </div>
        </form>
      </section>
    </div>
  </Teleport>
</template>
