<script setup lang="ts">
import { computed } from "vue";
import type {
  SubscriptionAccountSummary,
  SubscriptionInteractiveAuthMethod,
  SubscriptionProviderOverview
} from "@writer/contracts/renderer";
import AgentTeamSwitch from "../AgentTeamSwitch.vue";
import SubscriptionAccountQuota from "./SubscriptionAccountQuota.vue";
import SubscriptionAuthDialog from "./SubscriptionAuthDialog.vue";
import SubscriptionLocalScanDialog from "./SubscriptionLocalScanDialog.vue";
import SubscriptionManualTokenDialog from "./SubscriptionManualTokenDialog.vue";
import SubscriptionRemoveAccountDialog from "./SubscriptionRemoveAccountDialog.vue";
import {
  formatContextWindow,
  formatCountdown,
  subT
} from "./subscriptionLabels";
import { useSubscriptionModelSettings } from "./useSubscriptionModelSettings";

const props = defineProps<{
  runtimeAvailable: boolean;
}>();

const emit = defineEmits<{
  modelsChanged: [];
}>();

const c = useSubscriptionModelSettings({
  onModelsChanged: () => emit("modelsChanged")
});

const providerNames = computed<Record<string, string>>(() => {
  const map: Record<string, string> = {};
  for (const item of c.providers.value) {
    map[item.provider] = item.name;
  }
  return map;
});

const activeProviderHasEnabledAccount = computed(
  () =>
    c.activeProvider.value?.accounts.some((account) => account.enabled) ?? false
);

function interactiveMethods(
  provider: SubscriptionProviderOverview
): SubscriptionInteractiveAuthMethod[] {
  return provider.supportedAuthMethods.filter(
    (method): method is SubscriptionInteractiveAuthMethod =>
      method === "oauth" || method === "device_flow"
  );
}

function supportsLocalImport(provider: SubscriptionProviderOverview): boolean {
  return provider.supportedAuthMethods.includes("local_import");
}

function supportsManualToken(provider: SubscriptionProviderOverview): boolean {
  return provider.supportedAuthMethods.includes("manual_token");
}

function accountStatusText(account: SubscriptionAccountSummary): string {
  if (!account.enabled || account.status === "disabled") {
    return subT("statusDisabled");
  }
  if (account.status === "active") return subT("statusActive");
  if (account.status === "cooldown") {
    const remaining = formatCountdown(account.cooldownUntil, c.nowMs.value);
    return remaining
      ? subT("statusCooldownWithTime", { time: remaining })
      : subT("statusCooldown");
  }
  if (account.status === "quota_exhausted") {
    const remaining = formatCountdown(account.cooldownUntil, c.nowMs.value);
    return remaining
      ? `${subT("statusQuotaExhausted")} · ${remaining}`
      : subT("statusQuotaExhausted");
  }
  return subT("statusExpired");
}

function accountStatusTone(
  account: SubscriptionAccountSummary
): "is-success" | "is-warning" | "is-danger" | "is-muted" {
  if (!account.enabled || account.status === "disabled") return "is-muted";
  if (account.status === "active") return "is-success";
  if (account.status === "expired") return "is-danger";
  return "is-warning";
}

function sourceLabel(source: SubscriptionAccountSummary["source"]): string {
  if (source === "oauth") return subT("sourceOAuth");
  if (source === "device_flow") return subT("sourceDeviceFlow");
  if (source === "manual_token") return subT("sourceManualToken");
  return subT("sourceLocalImport");
}
</script>

<template>
  <section class="settings-group sub-model-panel">
    <div class="sub-model-header">
      <p class="sub-model-intro">{{ subT("intro") }}</p>
      <div class="sub-model-header-actions">
        <button
          type="button"
          class="sub-model-btn"
          :disabled="!props.runtimeAvailable || c.scanDialog.value.scanning"
          @click="c.openScanDialog()"
        >
          {{
            c.scanDialog.value.scanning
              ? subT("scanningLocal")
              : subT("scanLocalButton")
          }}
        </button>
        <button
          type="button"
          class="sub-model-btn"
          :disabled="
            !props.runtimeAvailable || !c.loaded.value || c.isQuotaPending()
          "
          @click="c.refreshQuota()"
        >
          {{
            c.isPending("refresh:all")
              ? subT("refreshingQuota")
              : subT("refreshQuotaButton")
          }}
        </button>
      </div>
    </div>

    <div v-if="!props.runtimeAvailable" class="sub-model-card">
      <div class="sub-model-empty">
        <p>{{ subT("runtimeUnavailable") }}</p>
      </div>
    </div>

    <div
      v-else-if="c.initialLoading.value && !c.loaded.value"
      class="sub-model-card"
    >
      <div class="sub-model-empty">
        <p>{{ subT("loadingState") }}</p>
      </div>
    </div>

    <div
      v-else-if="c.loadError.value && !c.loaded.value"
      class="sub-model-card"
    >
      <div class="sub-model-empty">
        <strong>{{ c.loadError.value }}</strong>
        <div class="sub-model-empty-actions">
          <button type="button" class="sub-model-btn" @click="c.load()">
            {{ subT("reloadButton") }}
          </button>
        </div>
      </div>
    </div>

    <template v-else-if="c.activeProvider.value">
      <div
        class="sub-model-provider-bar"
        role="tablist"
        :aria-label="subT('accountPoolTitle')"
      >
        <button
          v-for="provider in c.implementedProviders.value"
          :key="provider.provider"
          type="button"
          role="tab"
          class="sub-model-provider-tab"
          :class="{
            'is-active': c.selectedProviderId.value === provider.provider
          }"
          :aria-selected="c.selectedProviderId.value === provider.provider"
          @click="c.selectedProviderId.value = provider.provider"
        >
          <span>{{ provider.name }}</span>
          <span
            v-if="provider.accounts.length > 0"
            class="sub-model-provider-count"
            >{{ provider.accounts.length }}</span
          >
        </button>
      </div>

      <div
        v-if="c.upcomingProviders.value.length > 0"
        class="sub-model-upcoming-block"
      >
        <button
          type="button"
          class="sub-model-upcoming-toggle"
          :aria-expanded="c.showUpcomingProviders.value"
          @click="
            c.showUpcomingProviders.value = !c.showUpcomingProviders.value
          "
        >
          <span
            class="sub-model-upcoming-chevron"
            :class="{ 'is-open': c.showUpcomingProviders.value }"
            aria-hidden="true"
            >▸</span
          >
          <span>{{
            subT("upcomingToggle", { count: c.upcomingProviders.value.length })
          }}</span>
        </button>
        <div
          v-if="c.showUpcomingProviders.value"
          class="sub-model-upcoming-list"
        >
          <span
            v-for="provider in c.upcomingProviders.value"
            :key="provider.provider"
            class="sub-model-upcoming-chip"
            :title="provider.description"
          >
            <span>{{ provider.name }}</span>
            <span class="sub-model-pill is-muted">{{
              subT("comingSoonBadge")
            }}</span>
          </span>
        </div>
      </div>

      <div
        v-if="c.activeProvider.value.unofficialWarning"
        class="sub-model-unofficial-notice"
        role="note"
      >
        <span class="sub-model-unofficial-dot" aria-hidden="true" />
        <span>{{ c.activeProvider.value.unofficialWarning }}</span>
      </div>

      <div class="sub-model-section-head">
        <div class="sub-model-section-title-wrap">
          <h2 class="sub-model-section-title">
            {{ subT("accountPoolTitle") }}
          </h2>
          <small class="sub-model-section-hint">{{
            c.activeProvider.value.provider === "google-gemini-cli"
              ? subT("geminiCliAccountHint")
              : c.activeProvider.value.provider === "google-antigravity"
                ? subT("antigravityAccountHint")
                : subT("accountPoolHint")
          }}</small>
        </div>
        <div class="sub-model-section-actions">
          <button
            v-for="(method, idx) in interactiveMethods(c.activeProvider.value)"
            :key="method"
            type="button"
            class="sub-model-btn"
            :class="{ 'is-primary': idx === 0 }"
            :disabled="c.startingAuth.value"
            @click="c.startAuth(c.activeProvider.value, method)"
          >
            {{
              c.startingAuth.value
                ? subT("startingAuth")
                : method === "device_flow"
                  ? subT("deviceFlowLoginButton")
                  : subT("oauthLoginButton")
            }}
          </button>
          <button
            v-if="c.activeProvider.value.provider === 'windsurf'"
            type="button"
            class="sub-model-btn is-primary"
            @click="c.openManualImportDialog(c.activeProvider.value, true)"
          >
            {{ subT("oauthLoginButton") }}
          </button>
          <button
            v-if="supportsLocalImport(c.activeProvider.value)"
            type="button"
            class="sub-model-btn"
            :class="{
              'is-primary':
                c.activeProvider.value.provider !== 'windsurf' &&
                interactiveMethods(c.activeProvider.value).length === 0
            }"
            :disabled="c.scanDialog.value.scanning"
            @click="c.openScanDialog(c.activeProvider.value.provider)"
          >
            {{ subT("importLocalButton") }}
          </button>
          <button
            v-if="supportsManualToken(c.activeProvider.value)"
            type="button"
            class="sub-model-btn"
            @click="c.openManualImportDialog(c.activeProvider.value)"
          >
            {{ subT("manualTokenButton") }}
          </button>
        </div>
      </div>

      <div class="sub-model-card">
        <div
          v-if="c.activeProvider.value.accounts.length === 0"
          class="sub-model-empty"
        >
          <strong>{{
            subT("emptyAccountsTitle", {
              provider: c.activeProvider.value.name
            })
          }}</strong>
          <p>{{ subT("emptyAccountsDesc") }}</p>
        </div>

        <template v-else>
          <div
            v-for="account in c.activeProvider.value.accounts"
            :key="account.id"
            class="sub-model-account-row"
            :class="{ 'is-disabled': !account.enabled }"
          >
            <div class="sub-model-account-top">
              <div class="sub-model-account-identity">
                <span
                  class="sub-model-status-dot"
                  :class="`is-${account.enabled ? account.status : 'disabled'}`"
                  aria-hidden="true"
                />
                <span
                  class="sub-model-account-name"
                  :title="account.email || account.displayName"
                  >{{ account.email || account.displayName }}</span
                >
                <span v-if="account.planTier" class="sub-model-pill">{{
                  account.planTier
                }}</span>
                <span v-if="account.isPrimary" class="sub-model-pill is-accent">
                  {{ subT("primaryBadge") }}
                </span>
                <span
                  class="sub-model-pill"
                  :class="accountStatusTone(account)"
                >
                  {{ accountStatusText(account) }}
                </span>
                <span class="sub-model-pill is-muted">{{
                  sourceLabel(account.source)
                }}</span>
              </div>

              <div class="sub-model-account-actions">
                <button
                  v-if="!account.isPrimary"
                  type="button"
                  class="sub-model-btn is-compact"
                  :disabled="c.isPending(`primary:${account.id}`)"
                  @click="c.setPrimaryAccount(account.provider, account.id)"
                >
                  {{ subT("setPrimaryAction") }}
                </button>
                <button
                  type="button"
                  class="sub-model-btn is-compact"
                  :disabled="c.isPending(`accountEnabled:${account.id}`)"
                  @click="c.toggleAccountEnabled(account, !account.enabled)"
                >
                  {{
                    account.enabled
                      ? subT("disableAction")
                      : subT("enableAction")
                  }}
                </button>
                <button
                  type="button"
                  class="sub-model-btn is-compact is-danger"
                  :disabled="c.isPending(`remove:${account.id}`)"
                  @click="c.requestRemoveAccount(account)"
                >
                  {{ subT("removeAction") }}
                </button>
              </div>
            </div>

            <p v-if="account.statusMessage" class="sub-model-account-msg">
              {{ account.statusMessage }}
            </p>

            <SubscriptionAccountQuota
              :account="account"
              :now="c.nowMs.value"
              :refreshing="c.isQuotaPending(account.provider, account.id)"
              :refresh-error="c.quotaErrors.value[account.id] ?? ''"
              @refresh="
                (quiet) => c.refreshQuota(account.provider, account.id, quiet)
              "
            />
          </div>
        </template>
      </div>

      <div class="sub-model-section-head">
        <div class="sub-model-section-title-wrap">
          <h2 class="sub-model-section-title">
            {{ subT("modelsSectionTitle") }}
          </h2>
          <small class="sub-model-section-hint">{{
            activeProviderHasEnabledAccount
              ? subT("modelsSectionHint")
              : subT("modelsRequireAccountHint")
          }}</small>
        </div>
        <div class="sub-model-section-actions">
          <button
            type="button"
            class="sub-model-btn"
            :disabled="
              !props.runtimeAvailable ||
              !activeProviderHasEnabledAccount ||
              c.isQuotaPending(c.activeProvider.value.provider)
            "
            @click="c.refreshModels(c.activeProvider.value.provider)"
          >
            {{
              c.isPending(`refreshModels:${c.activeProvider.value.provider}`)
                ? subT("refreshingModels")
                : subT("refreshModelsButton")
            }}
          </button>
        </div>
      </div>

      <div class="sub-model-card">
        <div
          v-if="c.activeProvider.value.models.length === 0"
          class="sub-model-empty"
        >
          <p>{{ subT("emptyModelsDesc") }}</p>
        </div>

        <template v-else>
          <div
            v-for="model in c.activeProvider.value.models"
            :key="model.id"
            class="sub-model-row"
            :class="{
              'is-default': c.snapshot.value?.defaultModelId === model.id
            }"
          >
            <div class="sub-model-row-info">
              <div class="sub-model-row-title">
                <strong :title="model.label">{{ model.label }}</strong>
                <span
                  v-if="c.snapshot.value?.defaultModelId === model.id"
                  class="sub-model-pill is-accent"
                >
                  {{ subT("currentDefaultBadge") }}
                </span>
                <span
                  v-else-if="model.recommended"
                  class="sub-model-pill is-muted"
                >
                  {{ subT("recommendedBadge") }}
                </span>
              </div>
              <small class="sub-model-row-meta" :title="model.id">
                <code class="sub-model-inline-code">{{ model.modelId }}</code>
                <template v-if="model.contextWindow">
                  ·
                  {{
                    subT("contextWindowMeta", {
                      size: formatContextWindow(model.contextWindow)
                    })
                  }}
                </template>
                <template v-if="model.reasoning">
                  · {{ subT("reasoningMeta") }}
                </template>
              </small>
            </div>

            <div class="sub-model-row-actions">
              <button
                type="button"
                class="sub-model-btn is-compact sub-model-sizer-btn"
                :class="{
                  'is-default-active':
                    c.snapshot.value?.defaultModelId === model.id
                }"
                :disabled="
                  !activeProviderHasEnabledAccount ||
                  c.snapshot.value?.defaultModelId === model.id ||
                  c.pendingDefaultModelId.value === model.id
                "
                @click="c.setDefaultModel(model)"
              >
                <span class="sub-model-sizer-ghost" aria-hidden="true">{{
                  subT("setAsDefaultAction")
                }}</span>
                <span class="sub-model-sizer-ghost" aria-hidden="true">{{
                  subT("currentDefaultBadge")
                }}</span>
                <span class="sub-model-sizer-ghost" aria-hidden="true">{{
                  subT("settingDefault")
                }}</span>
                <span>{{
                  c.pendingDefaultModelId.value === model.id
                    ? subT("settingDefault")
                    : c.snapshot.value?.defaultModelId === model.id
                      ? subT("currentDefaultBadge")
                      : subT("setAsDefaultAction")
                }}</span>
              </button>

              <button
                type="button"
                class="sub-model-btn is-compact"
                :disabled="
                  !activeProviderHasEnabledAccount ||
                  c.testingModelId.value !== null
                "
                @click="c.testModel(model)"
              >
                {{
                  c.testingModelId.value === model.id
                    ? subT("testingAction")
                    : subT("testAction")
                }}
              </button>

              <AgentTeamSwitch
                :model-value="model.enabled"
                :label="subT('toggleModelAria', { label: model.label })"
                @update:model-value="c.toggleModel(model, $event)"
              />
            </div>
          </div>
        </template>
      </div>
    </template>

    <SubscriptionAuthDialog
      :session="c.authSession.value"
      :now-ms="c.nowMs.value"
      :cancelling="
        Boolean(
          c.authSession.value &&
          c.isPending(`cancelAuth:${c.authSession.value.authSessionId}`)
        )
      "
      @close="c.closeAuthDialog"
    />

    <SubscriptionLocalScanDialog
      :state="c.scanDialog.value"
      :provider-names="providerNames"
      @close="c.closeScanDialog"
      @rescan="c.openScanDialog"
      @import-selected="c.importSelectedCandidates"
    />

    <SubscriptionRemoveAccountDialog
      :account="c.removeConfirmAccount.value"
      :pending="
        Boolean(
          c.removeConfirmAccount.value &&
          c.isPending(`remove:${c.removeConfirmAccount.value.id}`)
        )
      "
      @close="c.cancelRemoveAccount"
      @confirm="c.confirmRemoveAccount"
    />

    <SubscriptionManualTokenDialog
      :provider="c.manualImportProvider.value"
      :login-uri="c.manualLoginUri.value"
      :submitting="c.manualImportSubmitting.value"
      @close="c.closeManualImportDialog"
      @submit="c.submitManualImport"
    />
  </section>
</template>

<style src="./subscription-models.css"></style>
