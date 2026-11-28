<script setup lang="ts">
import { createScopedTranslator } from "../i18n";
import { getErrorDetail } from "../i18n/errors";
import {
  computed,
  defineAsyncComponent,
  onErrorCaptured,
  onMounted,
  ref,
  watch
} from "vue";
import {
  type AppLanguage,
  type ContextCompactionSettings,
  type BodyTextFormats,
  type BodyTextFormatChange,
  type CreativePlotStage,
  type GeneralPermissionMode,
  type LibraryAgentDomain,
  type LibraryAgentSettings,
  type LibraryAgentSettingsInput,
  type LongAgentSettings,
  type LongAgentSettingsInput,
  type ModelConfigInput,
  type ModelSettings,
  type ModelSettingsInput,
  type ModelUsageDashboard,
  type ModelUsageQueryInput,
  type MoreFeaturesSettings,
  type SiteOfficialQuota,
  type TextViewMode,
  type WorkspacePaneLayout,
  type WorkspaceAgentSettings,
  type WorkspaceAgentSettingsInput
} from "@writer/contracts";
import AppIcon from "./AppIcon.vue";
import AppearanceSettingsPanel from "./AppearanceSettingsPanel.vue";
import BodyTextSettingsPanel from "./BodyTextSettingsPanel.vue";
import ConfigurationSettingsPanel from "./ConfigurationSettingsPanel.vue";
import GeneralSettingsPanel from "./GeneralSettingsPanel.vue";
import StorageSettingsPanel from "./StorageSettingsPanel.vue";
import LibraryAgentSettingsPanel from "./LibraryAgentSettingsPanel.vue";
import ModelSettingsFeature from "./ModelSettingsFeature.vue";
import ModelUsagePanel from "./ModelUsagePanel.vue";
import ShortAgentSettingsPanel from "./ShortAgentSettingsPanel.vue";
import WebSearchSettingsPanel from "./WebSearchSettingsPanel.vue";
import MoreFeaturesSettingsPanel from "./MoreFeaturesSettingsPanel.vue";
import WriterWordmark from "./WriterWordmark.vue";
import { settingsSections as sections } from "./settingsCategories";

const ExternalControlSettingsPanel = defineAsyncComponent(
  () => import("../extras/external-control/ExternalControlSettingsPanel.vue")
);
const ArchivedConversationsPanel = defineAsyncComponent(
  () => import("./ArchivedConversationsPanel.vue")
);
const ImageModelSettingsPanel = defineAsyncComponent(
  () => import("./ImageModelSettingsPanel.vue")
);
const SubscriptionModelSettingsPanel = defineAsyncComponent(
  () => import("./subscriptions/SubscriptionModelSettingsPanel.vue")
);

const t = createScopedTranslator("components.settingsPage");

const props = defineProps<{
  initialCategory?: string;
  workspaceDirectoryPath: string | null;
  workspaceDirectoryLoading: boolean;
  permissionMode: GeneralPermissionMode;
  autoSaveEnabled: boolean;
  versionHistoryEnabled: boolean;
  language: AppLanguage;
  showContextUsage: boolean;
  textAttachmentMaxCharacters: number;
  contextCompaction: ContextCompactionSettings;
  showInMenuBar: boolean;
  taskNotification: boolean;
  externalControlEnabled: boolean;
  useNetworkProxy: boolean;
  workspacePaneLayout: WorkspacePaneLayout;
  defaultTextViewMode: TextViewMode;
  bodyTextFormats: BodyTextFormats;
  moreFeaturesSettings: MoreFeaturesSettings;
  workspaceAgentSettings: readonly WorkspaceAgentSettings[];
  creativePlotStages: readonly CreativePlotStage[];
  longAgentSettings: LongAgentSettings | null;
  workspaceAgentLoading: boolean;
  workspaceAgentSaving: boolean;
  longAgentLoading: boolean;
  longAgentSaving: boolean;
  longAgentError: string | null;
  modelUsageDashboard: ModelUsageDashboard | null;
  modelUsageLoading: boolean;
  modelSettings: ModelSettings | null;
  modelAlertMessages: readonly string[];
  modelLoading: boolean;
  modelSaving: boolean;
  freeModelsRefreshing: boolean;
  freeModelsSaving: boolean;
  siteOfficialModelsRefreshing: boolean;
  siteOfficialModelsSaving: boolean;
  siteOfficialQuota: SiteOfficialQuota | null;
  modelError: string | null;
  modelTestMessage: string | null;
  testingModelId: string | null;
  libraryAgentSettings: LibraryAgentSettings | null;
  libraryAgentLoading: boolean;
  libraryAgentSaving: boolean;
  runtimeAvailable: boolean;
}>();

const emit = defineEmits<{
  back: [];
  chooseWorkspaceDirectory: [];
  resetWorkspaceDirectory: [];
  updatePermissionMode: [mode: GeneralPermissionMode];
  updateAutoSave: [enabled: boolean];
  updateVersionHistoryEnabled: [enabled: boolean];
  updateLanguage: [language: AppLanguage];
  updateShowContextUsage: [enabled: boolean];
  updateTextAttachmentMaxCharacters: [value: number];
  updateContextCompaction: [settings: ContextCompactionSettings];
  updateShowInMenuBar: [enabled: boolean];
  updateTaskNotification: [enabled: boolean];
  updateExternalControlEnabled: [enabled: boolean];
  updateUseNetworkProxy: [enabled: boolean];
  updateWorkspacePaneLayout: [layout: WorkspacePaneLayout];
  updateDefaultTextViewMode: [mode: TextViewMode];
  updateBodyTextFormat: [change: BodyTextFormatChange];
  updateMoreFeatures: [settings: MoreFeaturesSettings];
  saveWorkspaceAgents: [settings: WorkspaceAgentSettingsInput];
  retryLongAgents: [];
  saveLongAgents: [settings: LongAgentSettingsInput];
  saveLibraryAgents: [settings: LibraryAgentSettingsInput];
  resetLibraryAgent: [domain: LibraryAgentDomain];
  loadModelUsage: [input?: ModelUsageQueryInput];
  loadModels: [];
  saveModels: [settings: ModelSettingsInput];
  testModel: [model: ModelConfigInput];
  loadSiteOfficialModels: [];
  saveSiteOfficialToken: [apiKey: string];
  clearSiteOfficialToken: [];
  refreshSiteOfficialModels: [];
  setSiteOfficialModelEnabled: [modelId: string, enabled: boolean];
  refreshFreeModels: [];
  setFreeModelEnabled: [modelId: string, enabled: boolean];
}>();
const activeCategory = ref(props.initialCategory ?? "general");
const searchQuery = ref("");
const panelError = ref<string | null>(null);
const panelKey = ref(0);

onErrorCaptured((error) => {
  panelError.value = getErrorDetail(error) ?? "";
  return false;
});

watch(activeCategory, () => {
  panelError.value = null;
});

onMounted(() => {
  if (activeCategory.value === "custom-models") emit("loadModels");
});

const visibleSections = computed(() => {
  const query = searchQuery.value.trim().toLocaleLowerCase();
  if (!query) return sections;
  return sections
    .map((section) => ({
      ...section,
      categories: section.categories.filter((category) =>
        `${category.label} ${category.keywords ?? ""}`
          .toLocaleLowerCase()
          .includes(query)
      )
    }))
    .filter((section) => section.categories.length);
});

const activeLabel = computed(() => {
  for (const section of sections) {
    const found = section.categories.find(
      (category) => category.id === activeCategory.value
    );
    if (found) return found.label;
  }
  return t("general");
});

async function selectCategory(id: string): Promise<void> {
  if (panelError.value !== null) {
    panelError.value = null;
    panelKey.value += 1;
  }
  if (id === "custom-models") {
    emit("loadModels");
  }
  activeCategory.value = id;
}

function retryPanel(): void {
  panelError.value = null;
  panelKey.value += 1;
  if (activeCategory.value === "custom-models") emit("loadModels");
}

function handleBack(): void {
  panelError.value = null;
  emit("back");
}
</script>

<template>
  <div class="settings-page">
    <aside class="settings-sidebar">
      <button class="settings-back" type="button" @click="handleBack">
        <AppIcon name="chevron" :size="14" />
        <span>{{ t("backToApp") }}</span>
      </button>

      <div class="settings-search">
        <AppIcon name="search" :size="14" />
        <input
          v-model="searchQuery"
          type="search"
          :placeholder="t('searchSettings')"
        />
      </div>

      <nav class="settings-nav" :aria-label="t('settingsCategories')">
        <div
          v-for="section in visibleSections"
          :key="section.id"
          class="settings-section"
        >
          <strong class="settings-section-label">{{ section.label }}</strong>
          <button
            v-for="category in section.categories"
            :key="category.id"
            class="settings-category"
            :class="{ 'is-active': activeCategory === category.id }"
            type="button"
            @click="selectCategory(category.id)"
          >
            <AppIcon v-if="category.icon" :name="category.icon" :size="15" />
            <span v-else class="settings-category-spacer" />
            <span>{{ category.label }}</span>
          </button>
        </div>
        <p v-if="!visibleSections.length" class="settings-search-empty">
          {{ t("noMatchingSettings") }}
        </p>
      </nav>

      <footer class="settings-brand-colophon" aria-label="Writer">
        <span class="settings-brand-seal" aria-hidden="true">
          <AppIcon name="logo" :size="18" />
        </span>
        <span class="settings-brand-copy">
          <WriterWordmark class="settings-brand-wordmark" aria-hidden="true" />
        </span>
      </footer>
    </aside>

    <main class="settings-content">
      <div class="settings-content-inner">
        <h1 class="settings-title">{{ activeLabel }}</h1>

        <section v-if="panelError !== null" class="settings-group" role="alert">
          <div class="settings-card">
            <div class="settings-item settings-panel-error">
              <div class="settings-item-text">
                <strong>{{ t("panelLoadFailed") }}</strong>
                <small v-if="panelError">{{ panelError }}</small>
              </div>
              <button
                type="button"
                class="dialog-secondary-button"
                @click="retryPanel"
              >
                {{ t("retry") }}
              </button>
            </div>
          </div>
        </section>

        <div v-else :key="panelKey">
          <StorageSettingsPanel
            v-if="activeCategory === 'directory'"
            :workspace-directory-path="workspaceDirectoryPath"
            :workspace-directory-loading="workspaceDirectoryLoading"
            :runtime-available="runtimeAvailable"
            @choose-workspace-directory="emit('chooseWorkspaceDirectory')"
            @reset-workspace-directory="emit('resetWorkspaceDirectory')"
          />

          <ShortAgentSettingsPanel
            v-else-if="activeCategory === 'short-agents'"
            :settings="workspaceAgentSettings"
            :creative-plot-stages="creativePlotStages"
            :long-settings="longAgentSettings"
            :loading="workspaceAgentLoading"
            :saving="workspaceAgentSaving"
            :long-loading="longAgentLoading"
            :long-saving="longAgentSaving"
            :long-error-message="longAgentError"
            :runtime-available="runtimeAvailable"
            @save="emit('saveWorkspaceAgents', $event)"
            @retry-long="emit('retryLongAgents')"
            @save-long="emit('saveLongAgents', $event)"
          />

          <LibraryAgentSettingsPanel
            v-else-if="activeCategory === 'skill-library-agent'"
            domain="skill"
            :settings="libraryAgentSettings"
            :loading="libraryAgentLoading"
            :saving="libraryAgentSaving"
            :runtime-available="runtimeAvailable"
            @save="emit('saveLibraryAgents', $event)"
            @reset="emit('resetLibraryAgent', $event)"
          />

          <LibraryAgentSettingsPanel
            v-else-if="activeCategory === 'material-library-agent'"
            domain="material"
            :settings="libraryAgentSettings"
            :loading="libraryAgentLoading"
            :saving="libraryAgentSaving"
            :runtime-available="runtimeAvailable"
            @save="emit('saveLibraryAgents', $event)"
            @reset="emit('resetLibraryAgent', $event)"
          />

          <MoreFeaturesSettingsPanel
            v-else-if="activeCategory === 'more-features'"
            :settings="moreFeaturesSettings"
            @update="emit('updateMoreFeatures', $event)"
          />

          <ModelUsagePanel
            v-else-if="activeCategory === 'usage'"
            :dashboard="modelUsageDashboard"
            :loading="modelUsageLoading"
            :model-alert-messages="[]"
            @query="emit('loadModelUsage', $event)"
          />

          <SubscriptionModelSettingsPanel
            v-else-if="activeCategory === 'subscription-models'"
            :runtime-available="runtimeAvailable"
            @models-changed="emit('loadModels')"
          />

          <ImageModelSettingsPanel
            v-else-if="activeCategory === 'image-models'"
            :runtime-available="runtimeAvailable"
          />

          <ModelSettingsFeature
            v-else-if="activeCategory === 'custom-models'"
            model-scope="custom"
            embedded
            active
            :model-settings="modelSettings"
            :model-loading="modelLoading"
            :model-saving="modelSaving"
            :model-error="modelError"
            :model-test-message="modelTestMessage"
            :testing-model-id="testingModelId"
            :model-alert-messages="[]"
            @save-models="emit('saveModels', $event)"
            @test-model="emit('testModel', $event)"
          />

          <template v-else-if="activeCategory === 'general'">
            <GeneralSettingsPanel
              :permission-mode="permissionMode"
              :auto-save-enabled="autoSaveEnabled"
              :version-history-enabled="versionHistoryEnabled"
              :language="language"
              :show-in-menu-bar="showInMenuBar"
              :task-notification="taskNotification"
              :use-network-proxy="useNetworkProxy"
              :workspace-pane-layout="workspacePaneLayout"
              @update-permission-mode="emit('updatePermissionMode', $event)"
              @update-auto-save="emit('updateAutoSave', $event)"
              @update-version-history-enabled="
                emit('updateVersionHistoryEnabled', $event)
              "
              @update-language="emit('updateLanguage', $event)"
              @update-show-in-menu-bar="emit('updateShowInMenuBar', $event)"
              @update-task-notification="emit('updateTaskNotification', $event)"
              @update-use-network-proxy="emit('updateUseNetworkProxy', $event)"
              @update-workspace-pane-layout="
                emit('updateWorkspacePaneLayout', $event)
              "
            />
          </template>

          <BodyTextSettingsPanel
            v-else-if="activeCategory === 'body-text'"
            :default-text-view-mode="defaultTextViewMode"
            :body-text-formats="bodyTextFormats"
            @update-default-text-view-mode="
              emit('updateDefaultTextViewMode', $event)
            "
            @update-body-text-format="emit('updateBodyTextFormat', $event)"
          />

          <ConfigurationSettingsPanel
            v-else-if="activeCategory === 'configuration'"
            :show-context-usage="showContextUsage"
            :text-attachment-max-characters="textAttachmentMaxCharacters"
            :context-compaction="contextCompaction"
            :model-settings="modelSettings"
            @update-show-context-usage="emit('updateShowContextUsage', $event)"
            @update-text-attachment-max-characters="
              emit('updateTextAttachmentMaxCharacters', $event)
            "
            @update-context-compaction="emit('updateContextCompaction', $event)"
          />

          <AppearanceSettingsPanel
            v-else-if="activeCategory === 'appearance'"
          />

          <ArchivedConversationsPanel
            v-else-if="activeCategory === 'archived-conversations'"
          />

          <WebSearchSettingsPanel v-else-if="activeCategory === 'web-search'" />
          <ExternalControlSettingsPanel
            v-else-if="activeCategory === 'external-control'"
            :external-control-enabled="externalControlEnabled"
            @update-external-control-enabled="
              emit('updateExternalControlEnabled', $event)
            "
          />

          <section v-else class="settings-group">
            <div class="settings-card">
              <p class="settings-placeholder">
                {{
                  t("settingsAreNotConfiguredMessage", {
                    arg0: activeLabel ?? ""
                  })
                }}
              </p>
            </div>
          </section>
        </div>
      </div>
    </main>
  </div>
</template>

<style scoped src="./settings-page.css"></style>
<style scoped>
.settings-panel-error {
  cursor: default;
}
.settings-panel-error small {
  overflow-wrap: anywhere;
}
.settings-panel-error button {
  flex-shrink: 0;
}
</style>
