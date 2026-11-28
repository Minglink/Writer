<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { SubscriptionAccountSummary } from "@writer/contracts/renderer";
import { subT } from "./subscriptionLabels";

const props = defineProps<{
  account: SubscriptionAccountSummary | null;
  pending: boolean;
}>();

const emit = defineEmits<{
  close: [];
  confirm: [];
}>();

const cancelButton = ref<HTMLButtonElement | null>(null);

function handleKeydown(event: KeyboardEvent): void {
  if (props.account && event.key === "Escape" && !props.pending) {
    emit("close");
  }
}

watch(
  () => props.account?.id,
  (id) => {
    if (!id) return;
    void nextTick(() => cancelButton.value?.focus());
  },
  { immediate: true }
);

onMounted(() => document.addEventListener("keydown", handleKeydown));
onBeforeUnmount(() => document.removeEventListener("keydown", handleKeydown));
</script>

<template>
  <Teleport to="body">
    <div
      v-if="account"
      class="dialog-backdrop sub-model-dialog-backdrop"
      @mousedown.self="!pending && emit('close')"
    >
      <section
        class="workspace-dialog sub-model-dialog is-narrow"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="sub-model-remove-title"
        aria-describedby="sub-model-remove-desc"
      >
        <header>
          <div>
            <span class="dialog-eyebrow">{{
              subT("removeDialogEyebrow")
            }}</span>
            <h2 id="sub-model-remove-title">
              {{
                subT("removeDialogTitle", {
                  name: account.email || account.displayName
                })
              }}
            </h2>
          </div>
          <button
            class="dialog-close"
            type="button"
            :aria-label="subT('closeButton')"
            :disabled="pending"
            @click="emit('close')"
          >
            ×
          </button>
        </header>

        <div class="dialog-content">
          <p id="sub-model-remove-desc" class="dialog-description">
            {{ subT("removeDialogDesc") }}
          </p>

          <div class="dialog-actions sub-model-dialog-actions">
            <button
              ref="cancelButton"
              type="button"
              class="dialog-secondary-button"
              :disabled="pending"
              @click="emit('close')"
            >
              {{ subT("cancelButton") }}
            </button>
            <button
              type="button"
              class="dialog-primary-button is-danger"
              :disabled="pending"
              @click="emit('confirm')"
            >
              {{
                pending ? subT("removingButton") : subT("removeConfirmButton")
              }}
            </button>
          </div>
        </div>
      </section>
    </div>
  </Teleport>
</template>
