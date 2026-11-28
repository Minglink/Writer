import {
  isWriterSiteOfficialModel,
  type ModelConfig
} from "@writer/contracts/renderer";
import { MODEL_PROVIDER_OPTIONS } from "../components/modelProviderPresets";
import { createScopedTranslator } from "../i18n";
import type { PopupSelectOption } from "../types/popupSelect";

const t = createScopedTranslator("workspace.conversationModelOptions");

export interface ModelSelectOption extends PopupSelectOption {
  value: string;
  group: { key: string; label: string };
}

const SUBSCRIPTION_PROVIDER_LABELS: Readonly<Record<string, string>> = {
  "google-gemini-cli": "Google Gemini CLI",
  "google-antigravity": "Google Antigravity",
  "openai-codex": "OpenAI Codex",
  "github-copilot": "GitHub Copilot",
  "anthropic-claude": "Claude",
  kiro: "Kiro",
  cursor: "Cursor",
  windsurf: "Windsurf",
  codebuddy: "CodeBuddy"
};

/** Shared provider ordering and labels for every text-model selector. */
export function buildModelSelectOptions(
  models: readonly Pick<
    ModelConfig,
    "id" | "label" | "provider" | "managedBy"
  >[]
): ModelSelectOption[] {
  const official: ModelSelectOption[] = [];
  const subscription = new Map<string, ModelSelectOption[]>();
  const custom = new Map<string, ModelSelectOption[]>();
  const free: ModelSelectOption[] = [];
  for (const model of models) {
    if (isWriterSiteOfficialModel(model)) {
      official.push({
        value: model.id,
        label: model.label,
        group: { key: "official", label: t("officialSite") }
      });
    } else if (model.managedBy === "subscription") {
      let options = subscription.get(model.provider);
      if (!options) {
        options = [];
        subscription.set(model.provider, options);
      }
      options.push({
        value: model.id,
        label: model.label,
        group: {
          key: `subscription:${model.provider}`,
          label: SUBSCRIPTION_PROVIDER_LABELS[model.provider] ?? model.provider
        }
      });
    } else if (model.managedBy === "writer-free") {
      free.push({
        value: model.id,
        label: model.label,
        group: { key: "free", label: t("freeModels") }
      });
    } else {
      let options = custom.get(model.provider);
      if (!options) {
        options = [];
        custom.set(model.provider, options);
      }
      options.push({
        value: model.id,
        label: model.label,
        group: {
          key: `custom:${model.provider}`,
          label:
            MODEL_PROVIDER_OPTIONS.find(
              (option) => option.value === model.provider
            )?.label ?? model.provider
        }
      });
    }
  }
  return [
    ...official,
    ...[...subscription.values()].flat(),
    ...[...custom.values()].flat(),
    ...free
  ];
}
