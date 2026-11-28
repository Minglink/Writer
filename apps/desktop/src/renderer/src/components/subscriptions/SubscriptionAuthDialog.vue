<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch
} from "vue";
import { uiMessage } from "../../ui-feedback";
import { formatCountdown, subT } from "./subscriptionLabels";
import type { AuthDialogState } from "./useSubscriptionModelSettings";

const props = defineProps<{
  session: AuthDialogState | null;
  nowMs: number;
  cancelling: boolean;
}>();

const emit = defineEmits<{
  close: [];
}>();

const primaryButton = ref<HTMLButtonElement | null>(null);
const expiresCountdown = computed(() =>
  formatCountdown(props.session?.expiresAt, props.nowMs)
);

function selectLink(event: FocusEvent): void {
  if (event.target instanceof HTMLInputElement) event.target.select();
}

async function copyAndOpen(): Promise<void> {
  const session = props.session;
  if (!session) return;
  if (session.method === "oauth" && session.verificationUri) {
    window.open(session.verificationUri, "_blank", "noopener,noreferrer");
    return;
  }
  let copied = false;
  if (session.userCode && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(session.userCode);
      copied = true;
    } catch {
      copied = false;
    }
  }
  if (session.verificationUri) {
    window.open(session.verificationUri, "_blank", "noopener,noreferrer");
  }
  if (copied && session.verificationUri) {
    uiMessage.success(subT("toastCodeCopiedOpened"));
  } else if (copied) {
    uiMessage.success(subT("toastCodeCopied"));
  } else {
    uiMessage.warning(subT("toastCopyFailed"));
  }
}

async function copyOnly(): Promise<void> {
  const code = props.session?.userCode;
  if (!code) return;
  try {
    await navigator.clipboard.writeText(code);
    uiMessage.success(subT("toastCodeCopied"));
  } catch {
    uiMessage.warning(subT("toastCopyFailed"));
  }
}

async function copyLinkOnly(): Promise<void> {
  const uri = props.session?.verificationUri;
  if (!uri) return;
  try {
    await navigator.clipboard.writeText(uri);
    uiMessage.success(subT("toastLoginLinkCopied"));
  } catch {
    uiMessage.warning(subT("toastLoginLinkCopyFailed"));
  }
}

function handleKeydown(event: KeyboardEvent): void {
  if (props.session && event.key === "Escape" && !props.cancelling) {
    emit("close");
  }
}

watch(
  () => props.session?.authSessionId,
  (id) => {
    if (!id) return;
    void nextTick(() => primaryButton.value?.focus());
  },
  { immediate: true }
);

onMounted(() => document.addEventListener("keydown", handleKeydown));
onBeforeUnmount(() => document.removeEventListener("keydown", handleKeydown));
</script>

<template>
  <Teleport to="body">
    <div
      v-if="session"
      class="dialog-backdrop sub-model-dialog-backdrop"
      @mousedown.self="
        session.status !== 'pending' && !cancelling && emit('close')
      "
    >
      <section
        class="workspace-dialog sub-model-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sub-model-device-title"
      >
        <header>
          <div>
            <span class="dialog-eyebrow">{{
              session.method === "oauth"
                ? subT("oauthLinkLabel")
                : subT("deviceDialogEyebrow")
            }}</span>
            <h2 id="sub-model-device-title">
              {{
                subT("deviceDialogTitle", { provider: session.providerName })
              }}
            </h2>
          </div>
          <button
            class="dialog-close"
            type="button"
            :aria-label="subT('closeButton')"
            :disabled="cancelling"
            @click="emit('close')"
          >
            ×
          </button>
        </header>

        <div class="dialog-content">
          <p class="dialog-description">
            {{
              session.method === "oauth"
                ? subT("oauthWaitingText")
                : subT("deviceDialogDesc")
            }}
          </p>

          <div v-if="session.userCode" class="sub-model-device-code-box">
            <span class="sub-model-device-code-label">{{
              subT("deviceCodeLabel")
            }}</span>
            <code class="sub-model-device-code">{{ session.userCode }}</code>
          </div>
          <label
            v-if="session.verificationUri"
            class="sub-model-oauth-link-row"
          >
            <span class="sub-model-oauth-link-label">{{
              subT("oauthLinkLabel")
            }}</span>
            <input
              class="sub-model-oauth-link-input"
              type="text"
              readonly
              :value="session.verificationUri"
              @focus="selectLink"
            />
          </label>

          <div
            class="dialog-note sub-model-device-status"
            :class="`is-${session.status}`"
            aria-live="polite"
          >
            <span class="sub-model-status-dot" aria-hidden="true" />
            <div class="sub-model-device-status-text">
              <span>
                {{
                  session.status === "failed"
                    ? session.errorMessage || subT("deviceFailedHint")
                    : session.status === "completed"
                      ? subT("deviceCompletedHint")
                      : session.callbackReceived
                        ? subT("oauthSavingHint")
                        : subT("devicePollingHint")
                }}
              </span>
              <small v-if="session.status === 'pending' && expiresCountdown">
                {{ subT("deviceExpiresHint", { time: expiresCountdown }) }}
              </small>
            </div>
          </div>

          <div class="dialog-actions sub-model-dialog-actions">
            <button
              type="button"
              class="dialog-secondary-button"
              :disabled="cancelling"
              @click="emit('close')"
            >
              {{ subT("cancelButton") }}
            </button>
            <button
              v-if="session.verificationUri"
              type="button"
              class="dialog-secondary-button"
              :disabled="cancelling || session.status !== 'pending'"
              @click="copyLinkOnly"
            >
              {{ subT("copyLoginLinkButton") }}
            </button>
            <button
              v-if="session.userCode && session.verificationUri"
              type="button"
              class="dialog-secondary-button"
              :disabled="cancelling"
              @click="copyOnly"
            >
              {{ subT("deviceCopyOnlyButton") }}
            </button>
            <button
              ref="primaryButton"
              type="button"
              class="dialog-primary-button"
              :disabled="
                cancelling ||
                session.status !== 'pending' ||
                !session.verificationUri
              "
              @click="copyAndOpen"
            >
              {{
                session.method === "oauth"
                  ? subT("openLoginLinkButton")
                  : subT("deviceCopyOpenButton")
              }}
            </button>
          </div>
        </div>
      </section>
    </div>
  </Teleport>
</template>
