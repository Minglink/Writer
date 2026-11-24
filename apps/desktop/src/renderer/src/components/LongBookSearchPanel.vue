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
  LongSearchHit,
  LongSearchScope,
  LongWorkspaceRoot
} from "@writer/contracts";
import { registerFeatureMessages } from "../i18n";
import { resolveLongWorkspaceApi } from "../types/longWorkspace";
import AppIcon from "./AppIcon.vue";

const t = registerFeatureMessages("longBookSearch", {
  "zh-CN": {
    panelLabel: "全书搜索",
    placeholder: "搜索正文、世界观、人物、剧情与连续性账本…",
    close: "关闭全书搜索",
    scopeAll: "全部",
    scopeDraft: "正文",
    scopeWorldbuilding: "世界观",
    scopeCharacter: "人物",
    scopePlot: "剧情",
    scopeContinuity: "连续性",
    searching: "正在检索全书…",
    emptyPrompt:
      "输入关键词检索整本书，点击命中项可在当前正文旁原地预览，确认后再打开原文。",
    noResults: "未找到与「{query}」匹配的内容。",
    resultCount: "找到 {count} 处命中",
    resultCountTruncated: "显示前 {count} 处命中（已截断）",
    searchFailed: "全书搜索暂时不可用。",
    previewLoading: "正在加载原文片段…",
    previewFailed: "暂时无法加载该片段预览。",
    openOriginal: "打开原文",
    closePreview: "关闭预览",
    rootDraft: "正文",
    rootWorldbuilding: "世界观",
    rootCharacter: "人物",
    rootPlot: "剧情",
    rootContinuity: "连续性"
  },
  "en-US": {
    panelLabel: "Search whole book",
    placeholder: "Search draft, worldbuilding, characters, plot & ledger…",
    close: "Close whole-book search",
    scopeAll: "All",
    scopeDraft: "Draft",
    scopeWorldbuilding: "World",
    scopeCharacter: "Characters",
    scopePlot: "Plot",
    scopeContinuity: "Continuity",
    searching: "Searching whole book…",
    emptyPrompt:
      "Type a keyword to search the whole book. Click a hit to preview in place without losing your cursor.",
    noResults: 'No matches found for "{query}".',
    resultCount: "{count} matches",
    resultCountTruncated: "Showing first {count} matches",
    searchFailed: "Whole-book search is currently unavailable.",
    previewLoading: "Loading excerpt preview…",
    previewFailed: "Unable to load preview excerpt.",
    openOriginal: "Open original",
    closePreview: "Close preview",
    rootDraft: "Draft",
    rootWorldbuilding: "World",
    rootCharacter: "Character",
    rootPlot: "Plot",
    rootContinuity: "Continuity"
  }
});

const props = defineProps<{
  bookId: string;
  initialQuery?: string;
}>();

const emit = defineEmits<{
  select: [hit: LongSearchHit];
  close: [];
}>();

type ScopeLabelKey =
  | "scopeAll"
  | "scopeDraft"
  | "scopeWorldbuilding"
  | "scopeCharacter"
  | "scopePlot"
  | "scopeContinuity";

const SCOPE_OPTIONS: ReadonlyArray<{
  value: LongSearchScope;
  labelKey: ScopeLabelKey;
}> = [
  { value: "all", labelKey: "scopeAll" },
  { value: "draft", labelKey: "scopeDraft" },
  { value: "worldbuilding", labelKey: "scopeWorldbuilding" },
  { value: "character_design", labelKey: "scopeCharacter" },
  { value: "plot_design", labelKey: "scopePlot" },
  { value: "continuity_ledger", labelKey: "scopeContinuity" }
];

const inputElement = ref<HTMLInputElement | null>(null);
const query = ref(props.initialQuery ?? "");
const scope = ref<LongSearchScope>("all");
const hits = ref<LongSearchHit[]>([]);
const truncated = ref(false);
const pending = ref(false);
const errorText = ref("");
const activeIndex = ref(0);
const previewHit = ref<LongSearchHit | null>(null);
const previewText = ref("");
const previewLoading = ref(false);
const previewError = ref("");

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let requestToken = 0;
let previewToken = 0;

function rootLabel(root: LongWorkspaceRoot): string {
  switch (root) {
    case "draft":
      return t("rootDraft");
    case "worldbuilding":
      return t("rootWorldbuilding");
    case "character_design":
      return t("rootCharacter");
    case "plot_design":
      return t("rootPlot");
    case "continuity_ledger":
      return t("rootContinuity");
  }
}

function splitSnippet(
  snippet: string,
  needle: string
): Array<{ text: string; match: boolean }> {
  const trimmed = needle.trim();
  if (!trimmed) {
    return [{ text: snippet, match: false }];
  }
  const lowerSnippet = snippet.toLowerCase();
  const lowerNeedle = trimmed.toLowerCase();
  const segments: Array<{ text: string; match: boolean }> = [];
  let cursor = 0;
  while (cursor < snippet.length) {
    const idx = lowerSnippet.indexOf(lowerNeedle, cursor);
    if (idx < 0) {
      segments.push({ text: snippet.slice(cursor), match: false });
      break;
    }
    if (idx > cursor) {
      segments.push({ text: snippet.slice(cursor, idx), match: false });
    }
    segments.push({
      text: snippet.slice(idx, idx + trimmed.length),
      match: true
    });
    cursor = idx + trimmed.length;
  }
  return segments.length > 0 ? segments : [{ text: snippet, match: false }];
}

const statusText = computed(() => {
  const trimmed = query.value.trim();
  if (!trimmed) {
    return "";
  }
  if (pending.value) {
    return t("searching");
  }
  if (errorText.value) {
    return errorText.value;
  }
  if (hits.value.length === 0) {
    return t("noResults", { query: trimmed });
  }
  return truncated.value
    ? t("resultCountTruncated", { count: String(hits.value.length) })
    : t("resultCount", { count: String(hits.value.length) });
});

async function runSearch(): Promise<void> {
  const trimmed = query.value.trim();
  const token = ++requestToken;
  if (!trimmed) {
    hits.value = [];
    truncated.value = false;
    pending.value = false;
    errorText.value = "";
    activeIndex.value = 0;
    return;
  }
  const api = resolveLongWorkspaceApi();
  if (!api?.search) {
    hits.value = [];
    truncated.value = false;
    pending.value = false;
    errorText.value = t("searchFailed");
    return;
  }
  pending.value = true;
  errorText.value = "";
  try {
    const result = await api.search({
      bookId: props.bookId,
      query: trimmed,
      scope: scope.value,
      limit: 50,
      maxSnippetCharacters: 180
    });
    if (token !== requestToken) {
      return;
    }
    hits.value = result.hits;
    truncated.value = result.hits.length >= 50;
    activeIndex.value = 0;
  } catch {
    if (token !== requestToken) {
      return;
    }
    hits.value = [];
    truncated.value = false;
    errorText.value = t("searchFailed");
  } finally {
    if (token === requestToken) {
      pending.value = false;
    }
  }
}

function scheduleSearch(immediate = false): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  if (immediate) {
    void runSearch();
    return;
  }
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    void runSearch();
  }, 120);
}

function setScope(nextScope: LongSearchScope): void {
  if (scope.value === nextScope) {
    return;
  }
  scope.value = nextScope;
  scheduleSearch(true);
}

function clearPreview(): void {
  previewToken += 1;
  previewHit.value = null;
  previewText.value = "";
  previewLoading.value = false;
  previewError.value = "";
}

async function openHitPreview(hit: LongSearchHit): Promise<void> {
  previewHit.value = hit;
  previewError.value = "";
  const api = resolveLongWorkspaceApi();
  if (!api?.readDocument) {
    previewText.value = hit.snippet;
    previewLoading.value = false;
    return;
  }
  const token = ++previewToken;
  previewLoading.value = true;
  try {
    const startOffset = Math.max(0, hit.start - 360);
    const res = await api.readDocument({
      bookId: props.bookId,
      fileId: hit.fileId,
      offset: startOffset,
      maxCharacters: 1_200
    });
    if (token !== previewToken) return;
    const prefix = startOffset > 0 ? "…" : "";
    const suffix = res.nextOffset !== null ? "…" : "";
    previewText.value = `${prefix}${res.content.trim()}${suffix}`;
  } catch {
    if (token !== previewToken) return;
    previewText.value = hit.snippet;
    previewError.value = t("previewFailed");
  } finally {
    if (token === previewToken) {
      previewLoading.value = false;
    }
  }
}

function selectHit(hit: LongSearchHit): void {
  emit("select", hit);
}

function handleKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    event.preventDefault();
    if (previewHit.value) {
      clearPreview();
      return;
    }
    emit("close");
    return;
  }
  if (event.key === "ArrowDown" && hits.value.length > 0) {
    event.preventDefault();
    activeIndex.value = (activeIndex.value + 1) % hits.value.length;
    return;
  }
  if (event.key === "ArrowUp" && hits.value.length > 0) {
    event.preventDefault();
    activeIndex.value =
      (activeIndex.value - 1 + hits.value.length) % hits.value.length;
    return;
  }
  if (event.key === "Enter" && hits.value.length > 0) {
    const active = hits.value[activeIndex.value] ?? hits.value[0];
    if (active) {
      event.preventDefault();
      selectHit(active);
    }
  }
}

function focusInput(): void {
  void nextTick(() => {
    inputElement.value?.focus();
    inputElement.value?.select();
  });
}

watch(
  () => props.bookId,
  () => {
    scheduleSearch(true);
  }
);

onMounted(() => {
  focusInput();
  if (query.value.trim()) {
    scheduleSearch(true);
  }
});

onBeforeUnmount(() => {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  requestToken += 1;
});

defineExpose({
  focusInput
});
</script>

<template>
  <section
    class="long-book-search-panel"
    role="search"
    :aria-label="t('panelLabel')"
    @keydown="handleKeydown"
  >
    <div class="long-book-search-header">
      <div class="long-book-search-input-wrap">
        <AppIcon name="search" :size="14" class="long-book-search-icon" />
        <input
          ref="inputElement"
          v-model="query"
          type="search"
          class="long-book-search-input"
          :placeholder="t('placeholder')"
          :aria-label="t('panelLabel')"
          @input="scheduleSearch(false)"
        />
      </div>
      <button
        type="button"
        class="long-book-search-close"
        :aria-label="t('close')"
        :title="t('close')"
        @click="emit('close')"
      >
        <AppIcon name="close" :size="14" />
      </button>
    </div>

    <div class="long-book-search-scopes" role="tablist">
      <button
        v-for="option in SCOPE_OPTIONS"
        :key="option.value"
        type="button"
        role="tab"
        class="long-book-search-scope"
        :class="{ 'is-active': scope === option.value }"
        :aria-selected="scope === option.value"
        @click="setScope(option.value)"
      >
        {{ t(option.labelKey) }}
      </button>
      <span v-if="statusText" class="long-book-search-status">
        {{ statusText }}
      </span>
    </div>

    <div v-if="!query.trim()" class="long-book-search-empty">
      {{ t("emptyPrompt") }}
    </div>

    <div
      v-else-if="hits.length > 0"
      class="long-book-search-body"
      :class="{ 'has-preview': previewHit !== null }"
    >
      <div class="long-book-search-results" role="listbox">
        <button
          v-for="(hit, index) in hits"
          :key="`${hit.fileId}:${hit.start}:${index}`"
          type="button"
          role="option"
          class="long-book-search-hit"
          :class="{
            'is-active': index === activeIndex,
            'is-previewing':
              previewHit?.fileId === hit.fileId &&
              previewHit?.start === hit.start
          }"
          :aria-selected="index === activeIndex"
          @mouseenter="activeIndex = index"
          @click="openHitPreview(hit)"
        >
          <div class="long-book-search-hit-head">
            <span class="long-book-search-hit-badge">{{
              rootLabel(hit.root)
            }}</span>
            <span class="long-book-search-hit-title">{{ hit.title }}</span>
          </div>
          <p class="long-book-search-hit-snippet">
            <template
              v-for="(segment, segIdx) in splitSnippet(hit.snippet, query)"
              :key="segIdx"
            >
              <mark v-if="segment.match" class="long-book-search-mark">{{
                segment.text
              }}</mark>
              <template v-else>{{ segment.text }}</template>
            </template>
          </p>
        </button>
      </div>

      <aside
        v-if="previewHit"
        class="long-book-search-preview"
        aria-label="In-place reference preview"
      >
        <div class="long-book-search-preview-head">
          <div class="long-book-search-hit-head">
            <span class="long-book-search-hit-badge">{{
              rootLabel(previewHit.root)
            }}</span>
            <strong class="long-book-search-hit-title">{{
              previewHit.title
            }}</strong>
          </div>
          <div class="long-book-search-preview-actions">
            <button
              type="button"
              class="long-book-search-open-btn"
              @click="selectHit(previewHit)"
            >
              {{ t("openOriginal") }}
            </button>
            <button
              type="button"
              class="long-book-search-close"
              :aria-label="t('closePreview')"
              :title="t('closePreview')"
              @click="clearPreview"
            >
              <AppIcon name="close" :size="13" />
            </button>
          </div>
        </div>
        <p v-if="previewLoading" class="long-book-search-preview-status">
          {{ t("previewLoading") }}
        </p>
        <p v-else class="long-book-search-preview-content">
          <template
            v-for="(segment, segIdx) in splitSnippet(previewText, query)"
            :key="segIdx"
          >
            <mark v-if="segment.match" class="long-book-search-mark">{{
              segment.text
            }}</mark>
            <template v-else>{{ segment.text }}</template>
          </template>
        </p>
        <p v-if="previewError" class="long-book-search-preview-status">
          {{ previewError }}
        </p>
      </aside>
    </div>
  </section>
</template>

<style scoped>
.long-book-search-panel {
  position: relative;
  z-index: 8;
  container-type: inline-size;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--theme-line-soft);
  background: var(--surface-raised, var(--surface-main));
}

.long-book-search-header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.long-book-search-input-wrap {
  position: relative;
  flex: 1 1 auto;
  display: flex;
  align-items: center;
}

.long-book-search-icon {
  position: absolute;
  left: 10px;
  color: var(--text-tertiary);
  pointer-events: none;
}

.long-book-search-input {
  width: 100%;
  height: 32px;
  padding: 0 10px 0 30px;
  border: 1px solid var(--theme-line);
  border-radius: 7px;
  background: var(--surface-main);
  color: var(--text-primary);
  font-size: 0.857143rem;
  outline: none;
  transition: border-color 120ms ease;
}

.long-book-search-input:focus {
  border-color: var(--accent);
}

.long-book-search-close {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
}

.long-book-search-close:hover {
  background: var(--surface-hover);
  color: var(--text-primary);
}

.long-book-search-scopes {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.long-book-search-scope {
  padding: 2px 9px;
  border: 1px solid var(--theme-line-soft);
  border-radius: 999px;
  background: var(--surface-main);
  color: var(--text-secondary);
  font-size: 0.785714rem;
  line-height: 1.5;
  cursor: pointer;
  transition:
    border-color 120ms ease,
    background-color 120ms ease,
    color 120ms ease;
}

.long-book-search-scope:hover {
  border-color: var(--theme-line);
  color: var(--text-primary);
}

.long-book-search-scope.is-active {
  border-color: color-mix(in srgb, var(--accent) 45%, var(--theme-line-soft));
  background: color-mix(in srgb, var(--accent) 12%, var(--surface-main));
  color: var(--accent);
}

.long-book-search-status {
  margin-left: auto;
  color: var(--text-tertiary);
  font-size: 0.785714rem;
}

.long-book-search-empty {
  color: var(--text-tertiary);
  font-size: 0.785714rem;
  padding: 2px 2px 4px;
}

.long-book-search-results {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 240px;
  overflow-y: auto;
}

.long-book-search-hit {
  display: flex;
  flex-direction: column;
  gap: 3px;
  width: 100%;
  padding: 7px 10px;
  border: 1px solid transparent;
  border-radius: 7px;
  background: var(--surface-main);
  color: var(--text-primary);
  text-align: left;
  cursor: pointer;
  transition:
    border-color 120ms ease,
    background-color 120ms ease;
}

.long-book-search-hit:hover,
.long-book-search-hit.is-active {
  border-color: var(--theme-line);
  background: var(--surface-hover);
}

.long-book-search-hit-head {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
}

.long-book-search-hit-badge {
  flex: 0 0 auto;
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--surface-raised, var(--surface-main));
  border: 1px solid var(--theme-line-soft);
  color: var(--text-secondary);
  font-size: 0.714286rem;
}

.long-book-search-hit-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.857143rem;
  font-weight: 500;
  color: var(--text-primary);
}

.long-book-search-hit-snippet {
  margin: 0;
  font-size: 0.785714rem;
  line-height: 1.5;
  color: var(--text-secondary);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.long-book-search-mark {
  background: color-mix(in srgb, var(--accent) 20%, transparent);
  color: var(--text-primary);
  border-radius: 2px;
  padding: 0 2px;
}

.long-book-search-body {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 10px;
  min-width: 0;
}

.long-book-search-body.has-preview {
  grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr);
}

@container (max-width: 560px) {
  .long-book-search-body.has-preview {
    grid-template-columns: minmax(0, 1fr);
  }
}

.long-book-search-hit.is-previewing {
  border-color: var(--accent, #2563eb);
  background: color-mix(
    in srgb,
    var(--accent, #2563eb) 6%,
    var(--surface-main)
  );
}

.long-book-search-preview {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 280px;
  padding: 10px 12px;
  border: 1px solid var(--theme-line);
  border-radius: 8px;
  background: var(--surface-main);
  overflow: hidden;
}

.long-book-search-preview-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--theme-line-soft);
}

.long-book-search-preview-actions {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.long-book-search-open-btn {
  height: 24px;
  padding: 0 9px;
  border: none;
  border-radius: 6px;
  background: var(--accent, #2563eb);
  color: #fff;
  font-size: 0.75rem;
  font-weight: 500;
  cursor: pointer;
}

.long-book-search-preview-content {
  margin: 0;
  overflow-y: auto;
  font-size: 0.82rem;
  line-height: 1.65;
  color: var(--text-primary);
  white-space: pre-wrap;
  word-break: break-word;
}

.long-book-search-preview-status {
  margin: 0;
  font-size: 0.785714rem;
  color: var(--text-secondary);
}
</style>
