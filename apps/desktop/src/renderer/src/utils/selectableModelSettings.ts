import type { ModelConfig, ModelSettings } from "@writer/contracts";
import {
  isWriterSiteOfficialModel,
  isTextGenerationModel
} from "@writer/contracts/renderer";

export function selectableModels(
  models: readonly ModelConfig[]
): ModelConfig[] {
  return models.filter(
    (model) =>
      isTextGenerationModel(model) &&
      (!isWriterSiteOfficialModel(model) || model.enabled !== false)
  );
}

export function selectableModelSettings(
  settings: ModelSettings
): ModelSettings {
  const models = selectableModels(settings.models);
  if (models.length === settings.models.length) return settings;
  return {
    ...settings,
    models,
    defaultModelId: models.some((model) => model.id === settings.defaultModelId)
      ? settings.defaultModelId
      : (models[0]?.id ?? "")
  };
}
