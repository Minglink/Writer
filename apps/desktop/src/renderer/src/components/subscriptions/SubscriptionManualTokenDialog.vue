<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { SubscriptionProviderOverview } from "@writer/contracts/renderer";
import { uiMessage } from "../../ui-feedback";
import { subT } from "./subscriptionLabels";

export interface ManualTokenSubmitPayload {
  token: string;
  refreshToken?: string;
  email?: string;
}

const props = defineProps<{
  provider: SubscriptionProviderOverview | null;
  loginUri: string;
  submitting: boolean;
}>();

const emit = defineEmits<{
  close: [];
  submit: [payload: ManualTokenSubmitPayload];
}>();

const tokenInput = ref<HTMLInputElement | null>(null);
const tokenValue = ref("");
const refreshTokenValue = ref("");
const emailValue = ref("");

async function copyLink(): Promise<void> {
  try {
    await navigator.clipboard.writeText(props.loginUri);
    uiMessage.success(subT("toastLoginLinkCopied"));
  } catch {
    uiMessage.warning(subT("toastLoginLinkCopyFailed"));
  }
}
function openLink(): void {
  window.open(props.loginUri, "_blank", "noopener,noreferrer");
}

function handleKeydown(event: KeyboardEvent): void {
  if (props.provider && event.key === "Escape" && !props.submitting) {
    emit("close");
  }
}

function submitForm(): void {
  const token = tokenValue.value.trim();
  if (!token || props.submitting) return;
  const refreshToken = refreshTokenValue.value.trim();
  const email = emailValue.value.trim();
  emit("submit", {
    token,
    ...(refreshToken ? { refreshToken } : {}),
    ...(email ? { email } : {})
  });
}

watch(
  () => props.provider?.provider,
  (nextProvider) => {
    tokenValue.value = "";
    refreshTokenValue.value = "";
    emailValue.value = "";
    if (nextProvider) void nextTick(() => tokenInput.value?.focus());
  },
  { immediate: true }
);

onMounted(() => document.addEventListener("keydown", handleKeydown));
onBeforeUnmount(() => document.removeEventListener("keydown", handleKeydown));
</script>

<template>
  <Teleport to="body">
    <div
      v-if="provider"
      class="dialog-backdrop sub-model-dialog-backdrop"
      @mousedown.self="!submitting && emit('close')"
    >
      <section
        class="workspace-dialog sub-model-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sub-model-manual-title"
        aria-describedby="sub-model-manual-desc"
      >
        <header>
          <div>
            <span class="dialog-eyebrow">{{
              subT(loginUri ? "oauthLinkLabel" : "manualDialogEyebrow")
            }}</span>
            <h2 id="sub-model-manual-title">
              {{
                subT(loginUri ? "deviceDialogTitle" : "manualDialogTitle", {
                  provider: provider.name
                })
              }}
            </h2>
          </div>
          <button
            class="dialog-close"
            type="button"
            :aria-label="subT('closeButton')"
            :disabled="submitting"
            @click="emit('close')"
          >
            ×
          </button>
        </header>

        <form class="dialog-content" @submit.prevent="submitForm">
          <p id="sub-model-manual-desc" class="dialog-description">
            {{ subT(loginUri ? "windsurfLoginHint" : "manualDialogDesc") }}
          </p>

          <template v-if="loginUri">
            <label class="sub-model-oauth-link-row">
              <span class="sub-model-oauth-link-label">{{
                subT("oauthLinkLabel")
              }}</span>
              <input
                class="sub-model-oauth-link-input"
                type="text"
                readonly
                :value="loginUri"
              />
            </label>
            <div class="dialog-actions sub-model-dialog-actions">
              <button
                type="button"
                class="dialog-secondary-button"
                @click="copyLink"
              >
                {{ subT("copyLoginLinkButton") }}
              </button>
              <button
                type="button"
                class="dialog-secondary-button"
                @click="openLink"
              >
                {{ subT("openLoginLinkButton") }}
              </button>
            </div>
          </template>
          <div class="sub-model-manual-fields">
            <label class="sub-model-field">
              <span>{{
                subT(loginUri ? "browserTokenLabel" : "manualTokenLabel")
              }}</span>
              <input
                ref="tokenInput"
                v-model="tokenValue"
                type="password"
                autocomplete="off"
                spellcheck="false"
                :placeholder="
                  loginUri ? undefined : subT('manualTokenPlaceholder')
                "
                :disabled="submitting"
                required
              />
            </label>

            <label v-if="!loginUri" class="sub-model-field">
              <span>{{ subT("manualRefreshLabel") }}</span>
              <input
                v-model="refreshTokenValue"
                type="password"
                autocomplete="off"
                spellcheck="false"
                :placeholder="subT('manualRefreshPlaceholder')"
                :disabled="submitting"
              />
            </label>

            <label class="sub-model-field">
              <span>{{ subT("manualEmailLabel") }}</span>
              <input
                v-model="emailValue"
                type="text"
                autocomplete="off"
                :placeholder="subT('manualEmailPlaceholder')"
                :disabled="submitting"
              />
            </label>
          </div>

          <div class="dialog-actions sub-model-dialog-actions">
            <button
              type="button"
              class="dialog-secondary-button"
              :disabled="submitting"
              @click="emit('close')"
            >
              {{ subT("cancelButton") }}
            </button>
            <button
              type="submit"
              class="dialog-primary-button"
              :disabled="submitting || !tokenValue.trim()"
            >
              {{
                submitting
                  ? subT("manualImportingButton")
                  : subT(loginUri ? "finishLogin" : "manualImportConfirm")
              }}
            </button>
          </div>
        </form>
      </section>
    </div>
  </Teleport>
</template>
