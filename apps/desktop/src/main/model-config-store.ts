import { join } from "node:path";
import { withConfigurationLock } from "./configuration-lock";
import {
  ModelConfigInputSchema,
  ModelSettingsInputSchema,
  isTextGenerationModel,
  isWriterSiteOfficialModel,
  type AgentProviderRuntimeConfig,
  type SyncedModelChange,
  type SyncModelEntry,
  type ModelConfigInput,
  type ModelSettings,
  type ModelSettingsInput,
  type WebSearchKeyImportModel
} from "@writer/contracts";
import {
  WriterFreeModelCatalogStore,
  type WriterFreeModelCatalog
} from "./writer-free-model-config";
import type {
  SubscriptionCatalogReader,
  SubscriptionModelCatalog
} from "./subscriptions/types";
import {
  ModelConfigPersistence,
  type ModelConfigState
} from "./model-config-persistence";
import {
  EMPTY_SUBSCRIPTION_MODEL_CATALOG,
  synchronizeState,
  toPublicSettings,
  withWriterFreeApiKeys,
  type ModelConfigSnapshot
} from "./model-config-state";
import {
  editModelSettings,
  setFreeModelEnabled
} from "./model-config-mutations";
import {
  applySyncedModelChanges,
  customSyncEntries
} from "./model-config-sync";
import {
  decryptModelKey,
  resolveDraftModel,
  resolveSavedModel
} from "./model-config-runtime";

interface FreeModelCatalogReader {
  initialize(): Promise<void>;
  getCatalog(): Promise<WriterFreeModelCatalog>;
  refreshCatalog?(): Promise<WriterFreeModelCatalog>;
}

export interface ModelConfigStoreOptions {
  appVersion?: string;
  freeModelCatalog?: FreeModelCatalogReader;
  subscriptionCatalog?: SubscriptionCatalogReader;
}

interface CatalogRefreshOptions {
  refreshFree?: boolean;
  autoSelectSubscriptionDefault?: boolean;
}

/** A saved model's decrypted key; for Main-internal reuse, never for IPC. */
export interface ModelKeySource {
  id: string;
  label: string;
  apiKey: string;
}

function publicSettings(state: ModelConfigSnapshot): ModelSettings {
  return toPublicSettings(state.settings, state.secrets, state.freeCatalog);
}

export class ModelConfigStore {
  private readonly persistence: ModelConfigPersistence;
  private readonly settingsPath: string;
  private readonly freeModelCatalog: FreeModelCatalogReader;
  private readonly subscriptionCatalog: SubscriptionCatalogReader | undefined;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(userDataPath: string, options: ModelConfigStoreOptions = {}) {
    this.settingsPath = join(userDataPath, "config", "models.json");
    this.persistence = new ModelConfigPersistence(userDataPath);
    this.freeModelCatalog =
      options.freeModelCatalog ??
      new WriterFreeModelCatalogStore(
        userDataPath,
        options.appVersion ? { appVersion: options.appVersion } : {}
      );
    this.subscriptionCatalog = options.subscriptionCatalog;
  }

  async initialize(): Promise<void> {
    await this.freeModelCatalog.initialize();
    await this.subscriptionCatalog?.initialize?.();
    await this.update();
  }

  async list(): Promise<ModelSettings> {
    return publicSettings(await this.update());
  }

  async syncSubscriptions(
    options: { autoSelectDefault?: boolean } = {}
  ): Promise<ModelSettings> {
    return publicSettings(
      await this.update({
        autoSelectSubscriptionDefault: options.autoSelectDefault === true
      })
    );
  }

  async setDefaultModel(modelId: string): Promise<ModelSettings> {
    const trimmed = modelId.trim();
    if (!trimmed) {
      throw new Error("默认模型 ID 不能为空。");
    }
    return publicSettings(
      await this.update({}, (state) => {
        const [syncedSettings, syncedSecrets] = synchronizeState(
          state.settings,
          state.secrets,
          state.freeCatalog,
          state.subscriptionCatalog
        );
        const target = syncedSettings.models.find(
          (model) => model.id === trimmed
        );
        if (!target || !isTextGenerationModel(target)) {
          throw new Error("指定的默认模型不存在或不可用于对话。");
        }
        return {
          settings: { ...syncedSettings, defaultModelId: trimmed },
          secrets: syncedSecrets
        };
      })
    );
  }

  async getDefaultModelId(): Promise<string> {
    return (await this.list()).defaultModelId;
  }

  async refreshFreeModels(): Promise<ModelSettings> {
    return publicSettings(await this.update({ refreshFree: true }));
  }

  async setFreeModelEnabled(
    modelId: string,
    enabled: boolean
  ): Promise<ModelSettings> {
    return publicSettings(
      await this.update({}, (state) =>
        setFreeModelEnabled(state, modelId, enabled)
      )
    );
  }

  async save(rawInput: ModelSettingsInput): Promise<ModelSettings> {
    const input = ModelSettingsInputSchema.parse(rawInput);
    return publicSettings(
      await this.update({}, (state) => editModelSettings(input, state))
    );
  }

  async disableDeveloperRole(
    modelId: string
  ): Promise<ModelSettings | undefined> {
    const trimmedId = modelId.trim();
    if (!trimmedId) return undefined;
    const snapshot = await this.runOperation({}, (prepared) => {
      const index = prepared.settings.models.findIndex(
        (model) =>
          !model.managedBy &&
          !isWriterSiteOfficialModel(model) &&
          model.id === trimmedId
      );
      if (
        index < 0 ||
        prepared.settings.models[index]!.supportsDeveloperRole !== undefined
      ) {
        return undefined;
      }
      const nextModels = [...prepared.settings.models];
      nextModels[index] = {
        ...nextModels[index]!,
        supportsDeveloperRole: false
      };
      return {
        settings: { ...prepared.settings, models: nextModels },
        secrets: prepared.secrets
      };
    });
    return snapshot ? publicSettings(snapshot) : undefined;
  }

  async listSyncModels(): Promise<SyncModelEntry[]> {
    const { settings, secrets } = await this.update();
    return customSyncEntries(settings.models, secrets);
  }

  async applySyncedModels(changes: SyncedModelChange[]): Promise<void> {
    await this.update({}, (state) => applySyncedModelChanges(state, changes));
  }

  async resolve(
    modelId?: string
  ): Promise<AgentProviderRuntimeConfig | undefined> {
    return resolveSavedModel(
      await this.update(),
      modelId,
      this.subscriptionCatalog
    );
  }

  async resolveDraft(
    rawModel: ModelConfigInput
  ): Promise<AgentProviderRuntimeConfig> {
    const model = ModelConfigInputSchema.parse(rawModel);
    return resolveDraftModel(
      model,
      await this.update(),
      this.subscriptionCatalog
    );
  }

  async resolveDraftApiKey(input: {
    id?: string;
    apiKey?: string;
    clearApiKey?: boolean;
  }): Promise<string> {
    const provided = input.apiKey?.trim() ?? "";
    if (provided) return provided;
    if (input.clearApiKey || !input.id?.trim()) return "";
    await this.writeChain;
    const { secrets } = await this.persistence.read();
    return decryptModelKey(secrets.encryptedApiKeys[input.id.trim()]);
  }

  /**
   * Saved models that match and hold a readable key. Models whose key cannot
   * be decrypted are left out, as nothing could use them anyway.
   */
  async listKeySources(
    match: (model: WebSearchKeyImportModel) => boolean
  ): Promise<ModelKeySource[]> {
    await this.writeChain;
    const { settings, secrets } = await this.persistence.read();
    const sources: ModelKeySource[] = [];
    for (const model of settings.models) {
      const encrypted = secrets.encryptedApiKeys[model.id];
      if (
        !match({
          id: model.id,
          provider: model.provider,
          baseUrl: model.baseUrl,
          managedBy: model.managedBy,
          hasApiKey: Boolean(encrypted)
        })
      )
        continue;
      try {
        const apiKey = decryptModelKey(encrypted);
        if (apiKey) sources.push({ id: model.id, label: model.label, apiKey });
      } catch {
        continue;
      }
    }
    return sources;
  }

  private async update(
    options: CatalogRefreshOptions = {},
    mutate?: (state: ModelConfigSnapshot) => ModelConfigState
  ): Promise<ModelConfigSnapshot> {
    return (await this.runOperation(options, (prepared) =>
      mutate ? mutate(prepared) : prepared
    ))!;
  }

  private async runOperation(
    options: CatalogRefreshOptions,
    mutate: (state: ModelConfigSnapshot) => ModelConfigState | undefined
  ): Promise<ModelConfigSnapshot | undefined> {
    const operation = this.writeChain.then(async () => {
      const freeCatalog =
        options.refreshFree && this.freeModelCatalog.refreshCatalog
          ? await this.freeModelCatalog.refreshCatalog()
          : await this.freeModelCatalog.getCatalog();
      const subscriptionCatalog: SubscriptionModelCatalog = this
        .subscriptionCatalog
        ? await this.subscriptionCatalog.getCatalog()
        : EMPTY_SUBSCRIPTION_MODEL_CATALOG;
      return withConfigurationLock(this.settingsPath, async () => {
        const stored = await this.persistence.read();
        const prepared: ModelConfigSnapshot = {
          ...stored,
          freeCatalog,
          subscriptionCatalog,
          secrets: withWriterFreeApiKeys(freeCatalog, stored.secrets)
        };
        const requested = mutate(prepared);
        if (!requested) return undefined;
        const [settings, secrets] = synchronizeState(
          requested.settings,
          requested.secrets,
          freeCatalog,
          subscriptionCatalog,
          {
            autoSelectSubscriptionDefault:
              options.autoSelectSubscriptionDefault === true
          }
        );
        // Every mutation and catalog refresh uses the same atomic commit.
        await this.persistence.write({ settings, secrets });
        return { settings, secrets, freeCatalog, subscriptionCatalog };
      });
    });
    // Failed operations must not poison later saves, and may not publish state.
    this.writeChain = operation.then(
      () => undefined,
      () => undefined
    );
    return await operation;
  }
}
