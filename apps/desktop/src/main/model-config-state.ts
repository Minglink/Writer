import { safeStorage } from "electron";
import {
  isWriterSiteOfficialModel,
  isTextGenerationModel,
  ModelSettingsSchema,
  type ModelConfigInput,
  type ModelSettings
} from "@writer/contracts";
import type { WriterFreeModelCatalog } from "./writer-free-model-config";
import {
  synchronizeFreeModelState,
  toDiskModel,
  type DiskModelSettings
} from "./free-model-settings-state";
import {
  effectiveFreeModels,
  projectPublicFreeModelSettings,
  removeDeprecatedFreeSecrets,
  reservedFreeModelIds,
  resolveCurrentFreeModel
} from "./free-model-settings-projection";
import type {
  DiskModelSecrets,
  ModelConfigState
} from "./model-config-persistence";

export interface ModelConfigCatalogs {
  freeCatalog: WriterFreeModelCatalog;
}
export type ModelConfigSnapshot = ModelConfigState & ModelConfigCatalogs;

export function withWriterFreeApiKeys(
  catalog: WriterFreeModelCatalog,
  secrets: DiskModelSecrets
): DiskModelSecrets {
  const currentIds = new Set(catalog.models.map((model) => model.id));
  const entries = Object.entries(catalog.apiKeys).filter(
    ([id, apiKey]) => currentIds.has(id) && Boolean(apiKey)
  );
  if (entries.length > 0 && !safeStorage.isEncryptionAvailable()) {
    throw new Error(
      "当前系统安全存储不可用，Writer 不会把远程免费模型 API Key 以明文写入磁盘。"
    );
  }
  const encryptedApiKeys = { ...secrets.encryptedApiKeys };
  if (catalog.canDeprecateMissingModels) {
    for (const id of currentIds) delete encryptedApiKeys[id];
  }
  for (const [id, apiKey] of entries) {
    encryptedApiKeys[id] = safeStorage.encryptString(apiKey).toString("base64");
  }
  return { version: 1, encryptedApiKeys };
}

export function toPublicSettings(
  settings: DiskModelSettings,
  secrets: DiskModelSecrets,
  freeCatalog: WriterFreeModelCatalog
): ModelSettings {
  return ModelSettingsSchema.parse({
    defaultModelId: settings.defaultModelId,
    models: settings.models.map((model) => ({
      ...model,
      hasApiKey: Boolean(secrets.encryptedApiKeys[model.id])
    })),
    ...projectPublicFreeModelSettings(settings, freeCatalog, (modelId) =>
      Boolean(secrets.encryptedApiKeys[modelId])
    )
  });
}

export function synchronizeState(
  settings: DiskModelSettings,
  secrets: DiskModelSecrets,
  freeCatalog: WriterFreeModelCatalog
): [DiskModelSettings, DiskModelSecrets] {
  const nextSettings = synchronizeSettings(settings, freeCatalog);
  return [
    nextSettings,
    {
      version: 1,
      encryptedApiKeys: removeDeprecatedFreeSecrets(
        secrets.encryptedApiKeys,
        nextSettings
      )
    }
  ];
}

function synchronizeSettings(
  settings: DiskModelSettings,
  freeCatalog: WriterFreeModelCatalog
): DiskModelSettings {
  const freeState = synchronizeFreeModelState(settings, freeCatalog);
  const freeModels = effectiveFreeModels(freeState, freeCatalog);
  const freeReservedIds = reservedFreeModelIds(freeState, freeCatalog);
  const customModels = settings.models
    .filter((model) => !model.managedBy && !freeReservedIds.has(model.id))
    .map(toDiskModel);
  const models = [...freeModels, ...customModels];
  const requestedDefaultModelId = settings.defaultModelId;
  const defaultModelId = models.some(
    (model) =>
      model.id === requestedDefaultModelId && isTextGenerationModel(model)
  )
    ? requestedDefaultModelId
    : (models.find(
        (model) =>
          isTextGenerationModel(model) &&
          (!isWriterSiteOfficialModel(model) || model.enabled !== false)
      )?.id ?? "");
  return {
    version: 2,
    defaultModelId,
    models,
    ...freeState
  };
}

export function synchronizeManagedModel(
  model: ModelConfigInput,
  freeCatalog: WriterFreeModelCatalog,
  enforceRemoteStatus = false
): ModelConfigInput {
  if (model.managedBy !== "writer-free") {
    return model;
  }
  return resolveCurrentFreeModel(freeCatalog, model.id, enforceRemoteStatus);
}
