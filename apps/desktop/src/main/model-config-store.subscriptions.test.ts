import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  customModel,
  emptyCatalog,
  temporaryRoots
} from "./model-config-store.test-support";
import { SubscriptionAccountManager } from "./subscriptions/manager";
import { ProviderAdapterRegistry } from "./subscriptions/registry";
import type {
  SecureStorageLike,
  SubscriptionModelDefinition,
  SubscriptionProviderAdapter
} from "./subscriptions/types";

vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(value, "utf8"),
    decryptString: (value: Buffer) => value.toString("utf8")
  }
}));

const { ModelConfigStore } = await import("./model-config-store");

const fakeSecureStorage: SecureStorageLike = {
  isEncryptionAvailable: () => true,
  encryptString: (value) =>
    Buffer.from(`ENC::${Buffer.from(value, "utf8").toString("hex")}`, "utf8"),
  decryptString: (value) =>
    Buffer.from(value.toString("utf8").slice(5), "hex").toString("utf8")
};

const CODEX_PRIMARY: SubscriptionModelDefinition = {
  id: "sub:openai-codex:gpt-5.3-codex",
  provider: "openai-codex",
  modelId: "gpt-5.3-codex",
  label: "GPT-5.3 Codex",
  api: "openai-codex-responses",
  baseUrl: "",
  reasoning: true,
  defaultThinkingLevel: "medium",
  contextWindow: 400_000,
  maxTokens: 128_000,
  recommended: true
};

const CODEX_MINI: SubscriptionModelDefinition = {
  id: "sub:openai-codex:gpt-5.3-mini",
  provider: "openai-codex",
  modelId: "gpt-5.3-mini",
  label: "GPT-5.3 Mini",
  api: "openai-codex-responses",
  baseUrl: "",
  reasoning: false,
  defaultThinkingLevel: "off",
  recommended: false
};

function createCodexAdapter(): SubscriptionProviderAdapter {
  return {
    id: "openai-codex",
    meta: {
      name: "OpenAI Codex (ChatGPT)",
      description: "Codex test adapter",
      phase: 1,
      supportedAuthMethods: ["oauth", "local_import"]
    },
    scanLocalCandidates: async () => [
      {
        candidateId: "codex_1",
        provider: "openai-codex",
        displayName: "codex@example.test",
        email: "codex@example.test",
        sourceLabel: "Codex CLI"
      }
    ],
    importLocalCandidate: async () => ({
      displayName: "codex@example.test",
      email: "codex@example.test",
      planTier: "Plus",
      source: "local_import",
      secret: {
        accessToken: "codex-short-lived-placeholder",
        refreshToken: "codex-refresh-placeholder",
        expiresAt: "2099-01-01T00:00:00.000Z"
      }
    }),
    refreshSecret: async (_account, secret) => secret,
    fetchQuota: async () => ({ quotaBuckets: [] }),
    listModels: async () => [CODEX_PRIMARY, CODEX_MINI],
    toRuntimeCredential: (account, secret) => ({
      provider: account.provider,
      accountId: account.id,
      apiKey: secret.accessToken,
      ...(secret.expiresAt ? { expiresAt: secret.expiresAt } : {}),
      extraHeaders: { "chatgpt-account-id": "acct_demo" }
    })
  };
}

async function createIntegratedFixture() {
  const root = await mkdtemp(join(tmpdir(), "writer-model-sub-"));
  temporaryRoots.push(root);
  const manager = new SubscriptionAccountManager(root, {
    registry: new ProviderAdapterRegistry([createCodexAdapter()]),
    secureStorage: fakeSecureStorage
  });
  const store = new ModelConfigStore(root, {
    freeModelCatalog: {
      initialize: async () => undefined,
      getCatalog: async () => emptyCatalog()
    },
    subscriptionCatalog: manager
  });
  manager.attachModelStoreSync(store);
  await store.initialize();
  return { root, manager, store };
}

describe("ModelConfigStore subscription integration", () => {
  it("projects only enabled models of platforms with enabled accounts, auto-sets default when no custom API is configured, and falls back when removed", async () => {
    const { root, manager, store } = await createIntegratedFixture();

    // No account yet -> no subscription models in ModelConfigStore.
    const initial = await store.list();
    expect(initial.models).toEqual([]);
    expect(initial.defaultModelId).toBe("");

    // First subscription account -> recommended model projected & auto-set as defaultModelId!
    const snapshot = await manager.importLocal({
      provider: "openai-codex",
      candidateId: "codex_1"
    });
    const afterImport = await store.list();
    expect(afterImport.models.map((m) => m.id)).toEqual([CODEX_PRIMARY.id]);
    expect(afterImport.models[0]).toMatchObject({
      managedBy: "subscription",
      hasApiKey: true
    });
    expect(afterImport.defaultModelId).toBe(CODEX_PRIMARY.id);

    // Enabling a non-recommended model projects it into ModelConfigStore.
    await manager.setModelEnabled({ modelId: CODEX_MINI.id, enabled: true });
    expect((await store.list()).models.map((m) => m.id)).toEqual([
      CODEX_PRIMARY.id,
      CODEX_MINI.id
    ]);

    // Switching default via setDefaultModel works and resolves runtime credential.
    await manager.setDefaultModel({ modelId: CODEX_MINI.id });
    expect((await store.list()).defaultModelId).toBe(CODEX_MINI.id);
    const runtime = await store.resolve(CODEX_MINI.id);
    expect(runtime).toMatchObject({
      id: CODEX_MINI.id,
      api: "openai-codex-responses",
      apiKey: "codex-short-lived-placeholder",
      subscriptionAuth: {
        provider: "openai-codex",
        extraHeaders: { "chatgpt-account-id": "acct_demo" }
      }
    });

    // Subscription secrets never enter models.json!
    const modelsJson = await readFile(
      join(root, "config", "models.json"),
      "utf8"
    );
    expect(modelsJson).not.toContain("codex-short-lived-placeholder");
    expect(modelsJson).not.toContain("codex-refresh-placeholder");

    // Add a custom fallback model, then disable the only subscription account -> subscription models removed and default safely falls back.
    await store.save({
      models: [
        ...(await store.list()).models.map(
          ({ hasApiKey: _h, ...rest }) => rest
        ),
        { ...customModel(), apiKey: "sk-custom-fallback-test" }
      ],
      defaultModelId: CODEX_MINI.id
    });
    const accountId = snapshot.providers.find(
      (p) => p.provider === "openai-codex"
    )!.accounts[0]!.id;
    await manager.setAccountEnabled({
      provider: "openai-codex",
      accountId,
      enabled: false
    });
    const afterDisable = await store.list();
    expect(afterDisable.models.map((m) => m.id)).toEqual(["custom-writer"]);
    expect(afterDisable.defaultModelId).toBe("custom-writer");

    // Re-enabling does NOT steal defaultModelId because a custom API with key is configured.
    await manager.setAccountEnabled({
      provider: "openai-codex",
      accountId,
      enabled: true
    });
    expect((await store.list()).defaultModelId).toBe("custom-writer");

    // Removing the only subscription account when it IS default falls back safely to "".
    await store.save({
      models: (await store.list()).models
        .filter((m) => m.managedBy === "subscription")
        .map(({ hasApiKey: _h, ...rest }) => rest),
      defaultModelId: CODEX_PRIMARY.id
    });
    await manager.removeAccount({ provider: "openai-codex", accountId });
    const afterRemove = await store.list();
    expect(afterRemove.models).toEqual([]);
    expect(afterRemove.defaultModelId).toBe("");
  });

  it("strictly excludes subscription models and credentials from cloud device sync", async () => {
    const { manager, store } = await createIntegratedFixture();
    await store.save({
      models: [{ ...customModel(), apiKey: "sk-custom-sync-test" }],
      defaultModelId: "custom-writer"
    });
    await manager.importLocal({
      provider: "openai-codex",
      candidateId: "codex_1"
    });

    // Custom model already has API key -> default stays on custom-writer.
    expect((await store.list()).defaultModelId).toBe("custom-writer");

    const syncList = await store.listSyncModels();
    expect(syncList.map((entry) => entry.model.id)).toEqual(["custom-writer"]);
    expect(JSON.stringify(syncList)).not.toContain("openai-codex");
    expect(JSON.stringify(syncList)).not.toContain(
      "codex-short-lived-placeholder"
    );
    expect(JSON.stringify(syncList)).not.toContain("codex-refresh-placeholder");

    // Cloud sync cannot delete or overwrite a subscription model.
    await expect(
      store.applySyncedModels([{ id: CODEX_PRIMARY.id, next: null }])
    ).rejects.toThrow("托管");
  });
});
