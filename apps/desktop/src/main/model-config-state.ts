import { safeStorage } from "electron";
import {
  isSubscriptionModel,
  isWriterSiteOfficialModel,
  isTextGenerationModel,
  ModelSettingsSchema,
  type ModelConfigInput,
  type ModelSettings
} from "@writer/contracts";
import type { WriterFreeModelCatalog } from "./writer-free-model-config";
import type { SubscriptionModelCatalog } from "./subscriptions/types";
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

export const EMPTY_SUBSCRIPTION_MODEL_CATALOG: SubscriptionModelCatalog = {
  models: []
};

export interface ModelConfigCatalogs {
  freeCatalog: WriterFreeModelCatalog;
  subscriptionCatalog: SubscriptionModelCatalog;
}
export type ModelConfigSnapshot = ModelConfigState & ModelConfigCatalogs;

export interface SynchronizeStateOptions {
  autoSelectSubscriptionDefault?: boolean;
}

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
      hasApiKey: isSubscriptionModel(model)
        ? true
        : Boolean(secrets.encryptedApiKeys[model.id])
    })),
    ...projectPublicFreeModelSettings(settings, freeCatalog, (modelId) =>
      Boolean(secrets.encryptedApiKeys[modelId])
    )
  });
}

export function synchronizeState(
  settings: DiskModelSettings,
  secrets: DiskModelSecrets,
  freeCatalog: WriterFreeModelCatalog,
  subscriptionCatalog: SubscriptionModelCatalog = EMPTY_SUBSCRIPTION_MODEL_CATALOG,
  options: SynchronizeStateOptions = {}
): [DiskModelSettings, DiskModelSecrets] {
  const nextSettings = synchronizeSettings(
    settings,
    freeCatalog,
    subscriptionCatalog,
    secrets,
    options
  );
  const cleanedSecrets = removeDeprecatedFreeSecrets(
    secrets.encryptedApiKeys,
    nextSettings
  );
  for (const id of Object.keys(cleanedSecrets)) {
    if (isSubscriptionModel(id)) {
      delete cleanedSecrets[id];
    }
  }
  return [
    nextSettings,
    {
      version: 1,
      encryptedApiKeys: cleanedSecrets
    }
  ];
}

function synchronizeSettings(
  settings: DiskModelSettings,
  freeCatalog: WriterFreeModelCatalog,
  subscriptionCatalog: SubscriptionModelCatalog,
  secrets: DiskModelSecrets,
  options: SynchronizeStateOptions
): DiskModelSettings {
  const freeState = synchronizeFreeModelState(settings, freeCatalog);
  const freeModels = effectiveFreeModels(freeState, freeCatalog);
  const freeReservedIds = reservedFreeModelIds(freeState, freeCatalog);
  const subscriptionModels = subscriptionCatalog.models
    .filter(
      (model) =>
        model.managedBy === "subscription" &&
        isSubscriptionModel(model) &&
        !freeReservedIds.has(model.id)
    )
    .map(toDiskModel);
  const subscriptionReservedIds = new Set(
    subscriptionModels.map((model) => model.id)
  );
  const customModels = settings.models
    .filter(
      (model) =>
        !model.managedBy &&
        !freeReservedIds.has(model.id) &&
        !subscriptionReservedIds.has(model.id) &&
        !isSubscriptionModel(model)
    )
    .map(toDiskModel);
  const models = [...freeModels, ...subscriptionModels, ...customModels].slice(
    0,
    100
  );
  const requestedDefaultModelId = settings.defaultModelId;
  const requestedModel = models.find(
    (model) =>
      model.id === requestedDefaultModelId && isTextGenerationModel(model)
  );
  const hasConfiguredCustomApi = customModels.some(
    (model) =>
      isTextGenerationModel(model) &&
      (!isWriterSiteOfficialModel(model) || model.enabled !== false) &&
      Boolean(secrets.encryptedApiKeys[model.id])
  );
  const preferredSubscriptionDefault =
    subscriptionCatalog.preferredDefaultModelId &&
    models.some(
      (model) =>
        model.id === subscriptionCatalog.preferredDefaultModelId &&
        isTextGenerationModel(model)
    )
      ? subscriptionCatalog.preferredDefaultModelId
      : undefined;

  let defaultModelId: string;
  if (
    options.autoSelectSubscriptionDefault &&
    preferredSubscriptionDefault &&
    !hasConfiguredCustomApi &&
    (!requestedModel || !isSubscriptionModel(requestedModel))
  ) {
    defaultModelId = preferredSubscriptionDefault;
  } else if (requestedModel) {
    defaultModelId = requestedDefaultModelId;
  } else {
    defaultModelId =
      preferredSubscriptionDefault ??
      models.find(
        (model) =>
          isTextGenerationModel(model) &&
          (!isWriterSiteOfficialModel(model) || model.enabled !== false)
      )?.id ??
      "";
  }

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
