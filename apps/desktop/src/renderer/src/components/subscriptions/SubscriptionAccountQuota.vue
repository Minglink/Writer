<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { SubscriptionAccountSummary } from "@writer/contracts/renderer";
import { locale } from "../../i18n";
import { subT } from "./subscriptionLabels";

const props = defineProps<{
  account: SubscriptionAccountSummary;
  now: number;
  refreshing?: boolean;
  refreshError?: string;
}>();
const emit = defineEmits<{ refresh: [quiet: boolean] }>();
const expanded = ref(false);
const intervalMs = 60_000;
let lastAttempt = 0;
function requestRefresh(quiet: boolean) {
  if (props.refreshing || !props.account.enabled) return;
  lastAttempt = Date.now();
  emit("refresh", quiet);
}
watch([expanded, () => props.now], () => {
  if (!expanded.value || document.visibilityState === "hidden") return;
  const updated = Date.parse(props.account.quotaUpdatedAt ?? "") || 0;
  if (Date.now() - Math.max(updated, lastAttempt) >= intervalMs)
    requestRefresh(true);
});
const updatedFormat = computed(
  () =>
    new Intl.DateTimeFormat(locale.value, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    })
);
const dateFormat = computed(
  () =>
    new Intl.DateTimeFormat(locale.value, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    })
);
const numbers = computed(
  () => new Intl.NumberFormat(locale.value, { maximumFractionDigits: 2 })
);
function percent(value: number): string {
  if (value > 0 && value < 0.0001) return "<0.0001%";
  if (value < 100 && value > 99.9999) return ">99.9999%";
  if (value < 0.01 || value > 99.99)
    return (
      value.toLocaleString(locale.value, { maximumFractionDigits: 4 }) + "%"
    );
  return numbers.value.format(value) + "%";
}
const rows = computed(() =>
  props.account.quotaBuckets.map((bucket) => {
    const value =
      bucket.remainingPercent ??
      (bucket.limit && bucket.used !== undefined
        ? Math.max(0, 100 * (1 - bucket.used / bucket.limit))
        : undefined);
    const unit =
      bucket.unit === "credits" ? subT("quotaCredits") : (bucket.unit ?? "");
    const amount = (n: number) =>
      [numbers.value.format(n), unit].filter(Boolean).join(" ");
    const balance = bucket.unlimited
      ? subT("quotaUnlimited")
      : value !== undefined
        ? subT("quotaRemaining", { value: percent(value) })
        : bucket.remaining !== undefined
          ? subT("quotaRemaining", { value: amount(bucket.remaining) })
          : subT("quotaUnknown");
    const count =
      bucket.used !== undefined && bucket.limit !== undefined
        ? subT("quotaUsedLimit", {
            used: numbers.value.format(bucket.used),
            limit: amount(bucket.limit)
          })
        : bucket.used !== undefined
          ? subT("quotaUsed", { value: amount(bucket.used) })
          : bucket.limit !== undefined
            ? subT("quotaLimit", { value: amount(bucket.limit) })
            : "";
    return { bucket, value, balance, count };
  })
);
const summary = computed(() => {
  const first = rows.value[0];
  if (!first) return "";
  if (
    rows.value.every(
      (row) => row.balance === first.balance && row.value === first.value
    )
  )
    return first.balance;
  const known = rows.value.flatMap((row) =>
    row.value === undefined ? [] : [row.value]
  );
  if (known.length === rows.value.length)
    return subT("quotaLowestRemaining", { value: percent(Math.min(...known)) });
  return subT("quotaCount", { count: rows.value.length });
});
</script>
<template>
  <div class="sub-model-quota-panel">
    <details
      v-if="rows.length"
      class="sub-model-quota-details"
      @toggle="expanded = ($event.currentTarget as HTMLDetailsElement).open"
    >
      <summary>
        <span class="sub-model-quota-title">{{ subT("quotaDetails") }}</span>
        <span class="sub-model-quota-balance">{{ summary }}</span>
        <time
          v-if="account.quotaUpdatedAt"
          :datetime="account.quotaUpdatedAt"
          >{{
            subT("quotaUpdated", {
              time: updatedFormat.format(Date.parse(account.quotaUpdatedAt))
            })
          }}</time
        >
      </summary>
      <ul class="sub-model-quota-list">
        <li
          v-for="({ bucket, value, balance, count }, index) in rows"
          :key="bucket.id + '-' + index"
          class="sub-model-quota-row"
        >
          <span class="sub-model-quota-label" :title="bucket.id">{{
            bucket.label
          }}</span>
          <span
            class="sub-model-quota-value"
            :title="
              value === undefined
                ? undefined
                : value.toLocaleString(locale, { maximumFractionDigits: 8 }) +
                  '%'
            "
            >{{ balance }}</span
          >
          <div
            v-if="value !== undefined && !bucket.unlimited"
            class="sub-model-quota-track"
            role="progressbar"
            :aria-label="bucket.label"
            :aria-valuetext="balance"
            :aria-valuenow="value"
            aria-valuemin="0"
            aria-valuemax="100"
          >
            <div
              class="sub-model-quota-fill"
              :class="{ 'is-low': value <= 20 }"
              :style="{ width: value + '%' }"
            ></div>
          </div>
          <span v-if="count || bucket.resetsAt" class="sub-model-quota-meta">
            <span v-if="count">{{ count }}</span>
            <time
              v-if="bucket.resetsAt"
              :datetime="bucket.resetsAt"
              :title="dateFormat.format(Date.parse(bucket.resetsAt))"
              >{{
                Date.parse(bucket.resetsAt) <= now
                  ? subT("quotaPast")
                  : subT("quotaResets", {
                      time: dateFormat.format(Date.parse(bucket.resetsAt))
                    })
              }}</time
            >
          </span>
        </li>
      </ul>
    </details>
    <small v-else-if="account.enabled" class="sub-model-quota-none">{{
      subT("quotaEmptyHint")
    }}</small>
    <button
      v-if="account.enabled"
      type="button"
      class="sub-model-btn is-compact sub-model-quota-refresh"
      :disabled="refreshing"
      @click="requestRefresh(false)"
    >
      {{ refreshing ? subT("refreshingQuota") : subT("refreshQuotaButton") }}
    </button>
    <small v-if="refreshError" class="sub-model-quota-error" role="status">{{
      refreshError
    }}</small>
  </div>
</template>
