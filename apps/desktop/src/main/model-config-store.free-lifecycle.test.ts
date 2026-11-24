import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  temporaryRoots,
  managedModel,
  customModel,
  type WriterFreeModelCatalog
} from "./model-config-store.test-support";

vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(value, "utf8"),
    decryptString: (value: Buffer) => value.toString("utf8")
  }
}));

const { ModelConfigStore } = await import("./model-config-store");

describe("ModelConfigStore free-model lifecycle", () => {
  it("deprecates only after an authoritative removal and keeps a reappearing id disabled", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "writer-model-store-free-deprecated-")
    );
    temporaryRoots.push(root);
    const catalog: WriterFreeModelCatalog = {
      revision: "v1",
      enabled: true,
      message: "",
      manifestAvailable: true,
      canDeprecateMissingModels: true,
      defaultModelId: "writer-free-writing",
      models: [managedModel("vendor/writer-v1")],
      apiKeys: {}
    };
    const freeModelCatalog = {
      initialize: async () => undefined,
      getCatalog: async () => structuredClone(catalog),
      refreshCatalog: async () => structuredClone(catalog)
    };
    const store = new ModelConfigStore(root, { freeModelCatalog });
    await store.save({
      models: [customModel()],
      defaultModelId: "custom-writer"
    });
    await store.setFreeModelEnabled("writer-free-writing", true);

    catalog.revision = "v2";
    catalog.models = [];
    catalog.defaultModelId = "";
    const removed = await store.refreshFreeModels();
    expect(removed.writerFreeEnabledModelIds).toEqual([]);
    expect(removed.writerFreeDeprecatedModels).toEqual([
      expect.objectContaining({
        id: "writer-free-writing",
        modelId: "vendor/writer-v1",
        hasApiKey: false
      })
    ]);
    expect(removed.models.map((model) => model.id)).toEqual(["custom-writer"]);
    expect(removed.defaultModelId).toBe("custom-writer");

    catalog.revision = "v3";
    catalog.models = [managedModel("vendor/writer-v3")];
    catalog.defaultModelId = "writer-free-writing";
    const returned = await store.refreshFreeModels();
    expect(returned.writerFreeDeprecatedModels).toEqual([]);
    expect(returned.writerFreeEnabledModelIds).toEqual([]);
    expect(returned.writerFreeModels?.[0]?.modelId).toBe("vendor/writer-v3");
    expect(returned.models.map((model) => model.id)).toEqual(["custom-writer"]);
  });

  it("keeps history for a catalog model that was never enabled", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "writer-model-store-free-never-enabled-")
    );
    temporaryRoots.push(root);
    const catalog: WriterFreeModelCatalog = {
      revision: "v1",
      enabled: true,
      message: "",
      manifestAvailable: true,
      canDeprecateMissingModels: true,
      defaultModelId: "writer-free-writing",
      models: [managedModel("vendor/never-enabled")],
      apiKeys: { "writer-free-writing": "never-enabled-secret" }
    };
    const store = new ModelConfigStore(root, {
      freeModelCatalog: {
        initialize: async () => undefined,
        getCatalog: async () => structuredClone(catalog),
        refreshCatalog: async () => structuredClone(catalog)
      }
    });

    const initial = await store.list();
    expect(initial.models).toEqual([]);
    expect(initial.writerFreeEnabledModelIds).toEqual([]);
    catalog.revision = "v2";
    catalog.defaultModelId = "";
    catalog.models = [];
    catalog.apiKeys = {};

    const removed = await store.refreshFreeModels();
    expect(removed.writerFreeDeprecatedModels).toEqual([
      expect.objectContaining({
        id: "writer-free-writing",
        modelId: "vendor/never-enabled"
      })
    ]);
    const secrets = JSON.parse(
      await readFile(join(root, "config", "models.json"), "utf8")
    ) as { encryptedApiKeys: Record<string, string> };
    expect(secrets.encryptedApiKeys).not.toHaveProperty("writer-free-writing");
  });

  it("retains enablement without deprecating during pause or a non-authoritative cache fallback", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "writer-model-store-free-pause-")
    );
    temporaryRoots.push(root);
    const catalog: WriterFreeModelCatalog = {
      revision: "v1",
      enabled: true,
      message: "",
      manifestAvailable: true,
      canDeprecateMissingModels: true,
      defaultModelId: "writer-free-writing",
      models: [managedModel("vendor/writer-v1")],
      apiKeys: {}
    };
    const freeModelCatalog = {
      initialize: async () => undefined,
      getCatalog: async () => structuredClone(catalog),
      refreshCatalog: async () => structuredClone(catalog)
    };
    const store = new ModelConfigStore(root, { freeModelCatalog });
    await store.setFreeModelEnabled("writer-free-writing", true);

    catalog.enabled = false;
    catalog.message = "暂停服务";
    catalog.canDeprecateMissingModels = false;
    catalog.models = [
      managedModel("vendor/paused-v2"),
      managedModel("vendor/paused-new", {
        id: "writer-free-new",
        label: "新免费模型"
      })
    ];
    catalog.defaultModelId = "writer-free-writing";
    const paused = await store.refreshFreeModels();
    expect(paused.writerFreeEnabledModelIds).toEqual(["writer-free-writing"]);
    expect(paused.writerFreeDeprecatedModels).toEqual([]);
    expect(paused.models).toEqual([]);
    expect(paused.writerFreeModels).toEqual([
      expect.objectContaining({
        id: "writer-free-writing",
        modelId: "vendor/paused-v2",
        status: 1
      }),
      expect.objectContaining({ id: "writer-free-new", status: 1 })
    ]);

    catalog.enabled = true;
    catalog.message = "";
    catalog.models = [managedModel("vendor/cached")];
    const cached = await store.refreshFreeModels();
    expect(cached.writerFreeEnabledModelIds).toEqual(["writer-free-writing"]);
    expect(cached.writerFreeDeprecatedModels).toEqual([]);
    expect(cached.models[0]?.modelId).toBe("vendor/cached");
  });

  it("requires exact, available ids while allowing idempotent disable", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "writer-model-store-free-exact-")
    );
    temporaryRoots.push(root);
    const unavailable = managedModel("vendor/unavailable", {
      id: "writer-free-unavailable",
      status: 1
    });
    const catalog: WriterFreeModelCatalog = {
      revision: "v1",
      enabled: true,
      message: "",
      manifestAvailable: true,
      canDeprecateMissingModels: true,
      defaultModelId: "writer-free-writing",
      models: [managedModel("vendor/default"), unavailable],
      apiKeys: {}
    };
    const store = new ModelConfigStore(root, {
      freeModelCatalog: {
        initialize: async () => undefined,
        getCatalog: async () => structuredClone(catalog)
      }
    });

    await expect(
      store.setFreeModelEnabled("writer-free-missing", true)
    ).rejects.toThrow(/废弃|不再受支持/u);
    await expect(
      store.setFreeModelEnabled(unavailable.id, true)
    ).rejects.toThrow(/当前不可用/u);
    await expect(
      store.resolveDraft(
        managedModel("vendor/ignored", { id: "writer-free-missing" })
      )
    ).rejects.toThrow(/废弃|不再受支持/u);
    await expect(
      store.setFreeModelEnabled("writer-free-missing", false)
    ).resolves.toMatchObject({ writerFreeEnabledModelIds: [] });
  });

  it("serializes refresh and enable so an old catalog cannot revive a removed model", async () => {
    const root = await mkdtemp(join(tmpdir(), "writer-model-store-free-race-"));
    temporaryRoots.push(root);
    let current: WriterFreeModelCatalog = {
      revision: "v1",
      enabled: true,
      message: "",
      manifestAvailable: true,
      canDeprecateMissingModels: true,
      defaultModelId: "writer-free-writing",
      models: [managedModel("vendor/writer-v1")],
      apiKeys: {}
    };
    let releaseRefresh!: () => void;
    let markRefreshStarted!: () => void;
    const refreshGate = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });
    const refreshStarted = new Promise<void>((resolve) => {
      markRefreshStarted = resolve;
    });
    const store = new ModelConfigStore(root, {
      freeModelCatalog: {
        initialize: async () => undefined,
        getCatalog: async () => structuredClone(current),
        refreshCatalog: async () => {
          markRefreshStarted();
          await refreshGate;
          current = {
            ...current,
            revision: "v2",
            defaultModelId: "",
            models: [],
            apiKeys: {}
          };
          return structuredClone(current);
        }
      }
    });
    await store.setFreeModelEnabled("writer-free-writing", true);

    const refresh = store.refreshFreeModels();
    await refreshStarted;
    const staleEnable = store.setFreeModelEnabled("writer-free-writing", true);
    const staleEnableRejected =
      expect(staleEnable).rejects.toThrow(/废弃|不再受支持/u);
    const concurrentSave = store.save({
      models: [customModel()],
      defaultModelId: "custom-writer"
    });
    releaseRefresh();

    await expect(refresh).resolves.toMatchObject({
      writerFreeEnabledModelIds: [],
      writerFreeDeprecatedModels: [
        expect.objectContaining({ id: "writer-free-writing" })
      ]
    });
    await staleEnableRejected;
    await expect(concurrentSave).resolves.toMatchObject({
      defaultModelId: "custom-writer",
      writerFreeDeprecatedModels: [
        expect.objectContaining({ id: "writer-free-writing" })
      ]
    });
    const finalSettings = await store.list();
    expect(finalSettings.models.map((model) => model.id)).toEqual([
      "custom-writer"
    ]);
    expect(finalSettings.writerFreeDeprecatedModels).toHaveLength(1);
  });

  it("deletes deprecated encrypted keys and does not reuse them after a keyless reappearance", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "writer-model-store-free-secret-retirement-")
    );
    temporaryRoots.push(root);
    const catalog: WriterFreeModelCatalog = {
      revision: "v1",
      enabled: true,
      message: "",
      manifestAvailable: true,
      canDeprecateMissingModels: true,
      defaultModelId: "writer-free-writing",
      models: [managedModel("vendor/writer-v1")],
      apiKeys: { "writer-free-writing": "retired-test-secret" }
    };
    const store = new ModelConfigStore(root, {
      freeModelCatalog: {
        initialize: async () => undefined,
        getCatalog: async () => structuredClone(catalog),
        refreshCatalog: async () => structuredClone(catalog)
      }
    });
    await store.setFreeModelEnabled("writer-free-writing", true);

    catalog.revision = "v1-keyless";
    catalog.models = [managedModel("vendor/writer-keyless")];
    catalog.apiKeys = {};
    const keyless = await store.refreshFreeModels();
    expect(keyless.writerFreeEnabledModelIds).toEqual(["writer-free-writing"]);
    expect(keyless.writerFreeModels?.[0]?.hasApiKey).toBe(false);
    await expect(store.resolve("writer-free-writing")).resolves.toMatchObject({
      modelId: "vendor/writer-keyless",
      apiKey: ""
    });

    catalog.revision = "v1-new-key";
    catalog.apiKeys = { "writer-free-writing": "replacement-test-secret" };
    await store.refreshFreeModels();
    await expect(store.resolve("writer-free-writing")).resolves.toMatchObject({
      apiKey: "replacement-test-secret"
    });

    catalog.revision = "v2";
    catalog.defaultModelId = "";
    catalog.models = [];
    catalog.apiKeys = {};
    const deprecated = await store.refreshFreeModels();
    expect(deprecated.writerFreeDeprecatedModels).toHaveLength(1);
    const secretsAfterRemoval = JSON.parse(
      await readFile(join(root, "config", "models.json"), "utf8")
    ) as { encryptedApiKeys: Record<string, string> };
    expect(secretsAfterRemoval.encryptedApiKeys).not.toHaveProperty(
      "writer-free-writing"
    );

    await writeFile(
      join(root, "config", "model-secrets.json"),
      JSON.stringify({
        version: 1,
        encryptedApiKeys: {
          "writer-free-writing": Buffer.from(
            "stale-retired-secret",
            "utf8"
          ).toString("base64")
        }
      }),
      "utf8"
    );
    await store.save({ models: [], defaultModelId: "" });
    const secretsAfterSave = JSON.parse(
      await readFile(join(root, "config", "models.json"), "utf8")
    ) as { encryptedApiKeys: Record<string, string> };
    expect(secretsAfterSave.encryptedApiKeys).not.toHaveProperty(
      "writer-free-writing"
    );

    catalog.revision = "v2-return-with-key";
    catalog.defaultModelId = "writer-free-writing";
    catalog.models = [managedModel("vendor/writer-return-with-key")];
    catalog.apiKeys = { "writer-free-writing": "new-returned-secret" };
    const returnedThroughSave = await store.save({
      models: [],
      defaultModelId: ""
    });
    expect(returnedThroughSave.writerFreeDeprecatedModels).toEqual([]);
    expect(returnedThroughSave.writerFreeModels?.[0]?.hasApiKey).toBe(true);

    catalog.revision = "v2-removed-again";
    catalog.defaultModelId = "";
    catalog.models = [];
    catalog.apiKeys = {};
    await store.refreshFreeModels();

    catalog.revision = "v3";
    catalog.defaultModelId = "writer-free-writing";
    catalog.models = [managedModel("vendor/writer-v3")];
    catalog.apiKeys = {};
    const returned = await store.refreshFreeModels();
    expect(returned.writerFreeDeprecatedModels).toEqual([]);
    expect(returned.writerFreeEnabledModelIds).toEqual([]);
    expect(returned.writerFreeModels?.[0]?.hasApiKey).toBe(false);

    await store.setFreeModelEnabled("writer-free-writing", true);
    await expect(store.resolve("writer-free-writing")).resolves.toMatchObject({
      modelId: "vendor/writer-v3",
      apiKey: ""
    });
  });
});
