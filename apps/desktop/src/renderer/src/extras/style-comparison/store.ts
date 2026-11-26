import { formatError } from "../../i18n/errors";
import { createScopedTranslator } from "../../i18n";
import { onScopeDispose, watch } from "vue";
import { defineStore } from "pinia";
import { STYLE_COMPARISON_METHOD_LIMIT } from "@writer/contracts/renderer";
import {
  DEFAULT_STYLE_COMPARISON_METHOD,
  INITIAL_STYLE_COMPARISON_METHOD,
  PREVIOUS_DEFAULT_STYLE_COMPARISON_METHOD
} from "./method";
import { uiMessage } from "../../ui-feedback";
import { createPromptProfile } from "../agent-runtime/promptProfile";
import { createStyleComparisonController } from "./controller";

const t = createScopedTranslator("extras.styleComparison");

/** Where the method lived before the unified extras agent settings. */
const LEGACY_METHOD_KEY = "writer.style-comparison.method.v1";
const AUTO_SAVE_DELAY_MS = 800;

function runtimeApi() {
  return globalThis.window?.writer;
}

function api() {
  const current = runtimeApi();
  if (!current) throw new Error(t("agentUnavailable"));
  return current;
}

function readLegacyMethod(): string | null {
  try {
    return localStorage.getItem(LEGACY_METHOD_KEY);
  } catch {
    return null;
  }
}

export const useStyleComparisonStore = defineStore("style-comparison", () => {
  const method = createPromptProfile(api, "style-comparison");
  const controller = createStyleComparisonController({
    api: runtimeApi,
    method,
    notifyError: (message) => uiMessage.error(message)
  });
  let autoSave: ReturnType<typeof setTimeout> | undefined;
  let ready = false;

  async function saveMethod(): Promise<boolean> {
    try {
      if (method.dirty.value) await method.save();
      return true;
    } catch (error) {
      uiMessage.error(formatError(error, t("saveComparisonMethodFailed")));
      return false;
    }
  }

  async function initialize(): Promise<void> {
    if (!runtimeApi()) return;
    try {
      await method.load();
    } catch (error) {
      uiMessage.error(formatError(error, t("loadComparisonMethodFailed")));
      return;
    }
    const legacy = readLegacyMethod();
    const normalized = legacy?.replace(/\r\n/g, "\n").trim();
    // A customized localStorage method is imported once, unless the saved
    // profile was already customized.
    if (
      legacy !== null &&
      legacy.length <= STYLE_COMPARISON_METHOD_LIMIT &&
      normalized !== INITIAL_STYLE_COMPARISON_METHOD &&
      normalized !== PREVIOUS_DEFAULT_STYLE_COMPARISON_METHOD &&
      normalized !== DEFAULT_STYLE_COMPARISON_METHOD &&
      method.profile.value?.systemPrompt === DEFAULT_STYLE_COMPARISON_METHOD
    ) {
      method.systemPrompt.value = legacy;
      if (!(await saveMethod())) {
        ready = true;
        return;
      }
    }
    if (legacy !== null && readLegacyMethod() === legacy) {
      try {
        localStorage.removeItem(LEGACY_METHOD_KEY);
      } catch {
        // Read-only browser storage may still contain the migrated value.
      }
    }
    ready = true;
  }

  watch(method.systemPrompt, () => {
    if (!ready || !method.dirty.value) return;
    clearTimeout(autoSave);
    autoSave = setTimeout(() => void saveMethod(), AUTO_SAVE_DELAY_MS);
  });
  void initialize();
  onScopeDispose(() => {
    clearTimeout(autoSave);
    if (ready) void saveMethod();
    controller.dispose();
  });
  return controller;
});
