import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CommandEnvelopeSchema,
  createEnvelope,
  type CommandEnvelope,
  type SubscriptionAuthProgressPayload,
  type SubscriptionStateChangedPayload
} from "@writer/contracts";
import { isForbiddenRendererCommand } from "../ipc/forbidden-commands";
import { handleSubscriptionCommands } from "./ipc-commands";
import { SubscriptionAccountManager } from "./manager";
import { ProviderAdapterRegistry } from "./registry";
import {
  SubscriptionError,
  type AuthFlowHandle,
  type ImportedAccountResult,
  type SecureStorageLike,
  type StoredAccountSecret,
  type SubscriptionModelDefinition,
  type SubscriptionProviderAdapter
} from "./types";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("electron", () => ({
  ipcRenderer: { invoke },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(value, "utf8"),
    decryptString: (value: Buffer) => value.toString("utf8")
  }
}));

const { subscriptions: preloadSubscriptions } =
  await import("../../preload/subscriptions-api");

const tempDirs: string[] = [];

afterEach(async () => {
  invoke.mockReset();
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))
  );
});

const fakeSecureStorage: SecureStorageLike = {
  isEncryptionAvailable: () => true,
  encryptString: (value) =>
    Buffer.from(`ENC::${Buffer.from(value, "utf8").toString("hex")}`, "utf8"),
  decryptString: (value) =>
    Buffer.from(value.toString("utf8").slice(5), "hex").toString("utf8")
};

const GEMINI_PRO: SubscriptionModelDefinition = {
  id: "sub:google-gemini-cli:gemini-2.5-pro",
  provider: "google-gemini-cli",
  modelId: "gemini-2.5-pro",
  label: "Gemini 2.5 Pro",
  api: "google-cloud-code-assist",
  baseUrl: "",
  reasoning: true,
  defaultThinkingLevel: "medium",
  contextWindow: 1_000_000,
  maxTokens: 65_536,
  recommended: true
};

const GEMINI_FLASH: SubscriptionModelDefinition = {
  id: "sub:google-gemini-cli:gemini-2.5-flash",
  provider: "google-gemini-cli",
  modelId: "gemini-2.5-flash",
  label: "Gemini 2.5 Flash",
  api: "google-cloud-code-assist",
  baseUrl: "",
  reasoning: false,
  defaultThinkingLevel: "off",
  recommended: false
};

function createMockAdapter(
  options: {
    refreshImpl?: (
      accountId: string,
      secret: StoredAccountSecret
    ) => Promise<StoredAccountSecret>;
    authHandle?: AuthFlowHandle;
  } = {}
): SubscriptionProviderAdapter {
  return {
    id: "google-gemini-cli",
    meta: {
      name: "Google Gemini CLI",
      description: "Test adapter",
      phase: 1,
      supportedAuthMethods: ["oauth", "local_import"]
    },
    ...(options.authHandle
      ? { startAuth: async () => options.authHandle! }
      : {}),
    scanLocalCandidates: async () => [
      {
        candidateId: "cand_1",
        provider: "google-gemini-cli",
        displayName: "primary@example.test",
        email: "primary@example.test",
        sourceLabel: "Gemini CLI",
        sourcePathHint: "~/.gemini/oauth_creds.json"
      },
      {
        candidateId: "cand_2",
        provider: "google-gemini-cli",
        displayName: "backup@example.test",
        email: "backup@example.test",
        sourceLabel: "Gemini CLI",
        sourcePathHint: "~/.gemini/oauth_creds_2.json"
      }
    ],
    importLocalCandidate: async (
      candidateId
    ): Promise<ImportedAccountResult> =>
      candidateId === "cand_1"
        ? {
            displayName: "primary@example.test",
            email: "primary@example.test",
            planTier: "Pro",
            source: "local_import",
            secret: {
              accessToken: "placeholder-access-1",
              refreshToken: "placeholder-refresh-1",
              expiresAt: "2026-11-27T12:00:30.000Z"
            }
          }
        : {
            displayName: "backup@example.test",
            email: "backup@example.test",
            planTier: "Pro",
            source: "local_import",
            secret: {
              accessToken: "placeholder-access-2",
              refreshToken: "placeholder-refresh-2",
              expiresAt: "2026-11-27T13:00:00.000Z"
            }
          },
    refreshSecret: async (account, secret) => {
      if (options.refreshImpl) {
        return options.refreshImpl(account.id, secret);
      }
      return {
        ...secret,
        accessToken: `${secret.accessToken}-refreshed`,
        expiresAt: "2026-11-27T14:00:00.000Z"
      };
    },
    fetchQuota: async () => ({
      planTier: "Ultra",
      quotaBuckets: [{ id: "pro", label: "Pro 配额", remainingPercent: 88 }]
    }),
    listModels: async () => [GEMINI_PRO, GEMINI_FLASH],
    toRuntimeCredential: (account, secret) => ({
      provider: account.provider,
      accountId: account.id,
      apiKey: secret.accessToken,
      ...(secret.expiresAt ? { expiresAt: secret.expiresAt } : {}),
      metadata: { source: account.source }
    })
  };
}

function cmd(type: string, payload: unknown): CommandEnvelope {
  return CommandEnvelopeSchema.parse(
    createEnvelope(type, payload, { id: "cmd_sub" })
  );
}

describe("SubscriptionAccountManager, IPC commands, and Preload boundary", () => {
  it("persists the primary account quota and catalog together on a model refresh", async () => {
    const root = await mkdtemp(join(tmpdir(), "writer-combined-quota-"));
    tempDirs.push(root);
    const provider = "google-gemini-cli";
    const quota = vi.fn(async () => ({
      quotaBuckets: [{ id: "a", label: "Quota", remainingPercent: 42 }],
      models: [GEMINI_FLASH]
    }));
    const adapter = {
      ...createMockAdapter(),
      quotaIncludesModels: true,
      fetchQuota: quota
    };
    const manager = new SubscriptionAccountManager(root, {
      registry: new ProviderAdapterRegistry([adapter]),
      secureStorage: fakeSecureStorage,
      now: () => Date.parse("2026-11-27T12:00:00.000Z")
    });
    await manager.scanLocal({ provider });
    await manager.importLocal({ provider, candidateId: "cand_1" });
    const snapshot = await manager.refreshModels({ provider });
    const overview = snapshot.providers.find(
      (item) => item.provider === provider
    )!;
    expect(quota).toHaveBeenCalledTimes(1);
    expect(overview.models.map((model) => model.id)).toEqual([GEMINI_FLASH.id]);
    expect(overview.accounts[0]?.quotaBuckets[0]?.remainingPercent).toBe(42);
    expect(overview.accounts[0]?.quotaUpdatedAt).toBe(
      "2026-11-27T12:00:00.000Z"
    );
  });

  it("keeps unnamed accounts distinct and preserves their expired status when toggled", async () => {
    const root = await mkdtemp(join(tmpdir(), "writer-account-state-"));
    tempDirs.push(root);
    const adapter = createMockAdapter();
    adapter.importLocalCandidate = async (candidateId) => ({
      source: "local_import",
      displayName: "Example account",
      secret: { accessToken: "fixture-" + candidateId }
    });
    const provider = adapter.id;
    const manager = new SubscriptionAccountManager(root, {
      registry: new ProviderAdapterRegistry([adapter]),
      secureStorage: fakeSecureStorage
    });
    await manager.importLocal({ provider, candidateId: "one" });
    await manager.importLocal({ provider, candidateId: "two" });
    const snapshot = await manager.importLocal({
      provider,
      candidateId: "one"
    });
    const accounts = snapshot.providers.find(
      (p) => p.provider === provider
    )!.accounts;
    expect(accounts).toHaveLength(2);
    const accountId = accounts[0]!.id;
    adapter.fetchQuota = async () => {
      throw new SubscriptionError(
        "subscriptions.secret_refresh_failed",
        "Fixture expired"
      );
    };
    const overview = (s: typeof snapshot) =>
      s.providers
        .find((p) => p.provider === provider)!
        .accounts.find((a) => a.id === accountId)!;
    expect(
      overview(await manager.refreshQuota({ provider, accountId })).status
    ).toBe("expired");
    expect(
      overview(
        await manager.setAccountEnabled({ provider, accountId, enabled: false })
      ).status
    ).toBe("disabled");
    expect(
      overview(
        await manager.setAccountEnabled({ provider, accountId, enabled: true })
      ).status
    ).toBe("expired");
  });

  it("imports accounts, deduplicates by email, refreshes expiring tokens single-flight, and handles 429/401 failover", async () => {
    const root = await mkdtemp(join(tmpdir(), "writer-sub-mgr-"));
    tempDirs.push(root);
    let nowMs = Date.parse("2026-11-27T12:00:00.000Z");
    let refreshCount = 0;
    let failRefreshForId = "";

    const adapter = createMockAdapter({
      refreshImpl: async (accountId, secret) => {
        refreshCount += 1;
        if (accountId === failRefreshForId) {
          throw new Error("invalid_grant: token revoked placeholder-refresh-1");
        }
        return {
          ...secret,
          accessToken: `${secret.accessToken}-refreshed-${refreshCount}`,
          expiresAt: new Date(nowMs + 3_600_000).toISOString()
        };
      }
    });

    const stateEvents: SubscriptionStateChangedPayload[] = [];
    const manager = new SubscriptionAccountManager(root, {
      registry: new ProviderAdapterRegistry([adapter]),
      secureStorage: fakeSecureStorage,
      now: () => nowMs,
      events: {
        emitAuthProgress: () => undefined,
        emitStateChanged: (payload) => stateEvents.push(payload)
      }
    });

    const scanned = await manager.scanLocal({ provider: "google-gemini-cli" });
    expect(scanned.candidates).toHaveLength(2);
    expect(scanned.candidates[0]?.alreadyImported).toBe(false);

    const afterFirst = await manager.importLocal({
      provider: "google-gemini-cli",
      candidateId: "cand_1"
    });
    const geminiOverview = afterFirst.providers.find(
      (p) => p.provider === "google-gemini-cli"
    )!;
    expect(geminiOverview.accounts).toHaveLength(1);
    expect(geminiOverview.accounts[0]?.isPrimary).toBe(true);
    expect(JSON.stringify(afterFirst)).not.toContain("placeholder-access-1");
    expect(JSON.stringify(afterFirst)).not.toContain("placeholder-refresh-1");

    // Re-importing same email updates existing account instead of duplicating.
    await manager.importLocal({
      provider: "google-gemini-cli",
      candidateId: "cand_1"
    });
    const afterBackup = await manager.importLocal({
      provider: "google-gemini-cli",
      candidateId: "cand_2"
    });
    const accounts = afterBackup.providers.find(
      (p) => p.provider === "google-gemini-cli"
    )!.accounts;
    expect(accounts).toHaveLength(2);
    const primaryId = accounts[0]!.id;
    const backupId = accounts[1]!.id;

    // Acquire credential refreshes primary (expires in 30s <= 60s buffer) and omits refreshToken.
    const cred1 = await manager.acquireCredential({
      provider: "google-gemini-cli",
      modelId: GEMINI_PRO.id
    });
    expect(cred1.accountId).toBe(primaryId);
    expect(cred1.apiKey).toBe("placeholder-access-1-refreshed-1");
    expect(cred1).not.toHaveProperty("refreshToken");

    // 429 on primary cools it down and fails over to backup.
    const credAfter429 = await manager.reportAndFailover({
      provider: "google-gemini-cli",
      modelId: GEMINI_PRO.id,
      failedAccountId: primaryId,
      reason: "rate_limited",
      retryAfterSec: 60
    });
    expect(credAfter429.accountId).toBe(backupId);
    expect(credAfter429.apiKey).toBe("placeholder-access-2");

    // 401 on backup: first tries single-flight refresh; when refresh succeeds, stays on backup with new token!
    const credAfter401Refresh = await manager.reportAndFailover({
      provider: "google-gemini-cli",
      modelId: GEMINI_PRO.id,
      failedAccountId: backupId,
      reason: "unauthorized"
    });
    expect(credAfter401Refresh.accountId).toBe(backupId);
    expect(credAfter401Refresh.apiKey).toBe("placeholder-access-2-refreshed-2");

    // Advance clock past primary's 60s cooldown so primary auto-recovers.
    nowMs += 65_000;
    // Now 401 on backup where refresh FAILS -> marks backup expired and fails over back to recovered primary!
    failRefreshForId = backupId;
    const credAfter401Failover = await manager.reportAndFailover({
      provider: "google-gemini-cli",
      modelId: GEMINI_PRO.id,
      failedAccountId: backupId,
      reason: "unauthorized"
    });
    expect(credAfter401Failover.accountId).toBe(primaryId);

    const finalState = await manager.getState();
    const finalAccounts = finalState.providers.find(
      (p) => p.provider === "google-gemini-cli"
    )!.accounts;
    expect(finalAccounts.find((a) => a.id === backupId)?.status).toBe(
      "expired"
    );
    expect(finalAccounts.find((a) => a.id === primaryId)?.status).toBe(
      "active"
    );
    expect(stateEvents.some((e) => e.reason === "failover")).toBe(true);
  });

  it("returns the session link without launching the browser when requested", async () => {
    const root = await mkdtemp(join(tmpdir(), "writer-auth-link-"));
    tempDirs.push(root);
    const uri = "https://accounts.example.test/authorize";
    const openExternalUrl = vi.fn(async () => undefined);
    const adapter = createMockAdapter();
    adapter.startAuth = async (context) => {
      await context.openExternalUrl(uri);
      return {
        method: "oauth",
        verificationUri: uri,
        completion: new Promise(() => {}),
        cancel: () => {}
      };
    };
    const manager = new SubscriptionAccountManager(root, {
      registry: new ProviderAdapterRegistry([adapter]),
      secureStorage: fakeSecureStorage,
      openExternalUrl
    });
    const manual = await manager.startAuth({
      provider: adapter.id,
      openBrowser: false
    });
    expect(manual.verificationUri).toBe(uri);
    expect(openExternalUrl).not.toHaveBeenCalled();
    await manager.cancelAuth(manual);
    const automatic = await manager.startAuth({ provider: adapter.id });
    expect(openExternalUrl).toHaveBeenCalledWith(uri);
    await manager.cancelAuth(automatic);
  });

  it("reports the saved account while its live model request is still pending", async () => {
    const root = await mkdtemp(join(tmpdir(), "writer-auth-saved-"));
    tempDirs.push(root);
    const authEvents: SubscriptionAuthProgressPayload[] = [];
    const stateEvents: SubscriptionStateChangedPayload[] = [];
    const adapter = createMockAdapter({
      authHandle: {
        method: "oauth",
        completion: Promise.resolve({
          displayName: "Example",
          email: "one@example.test",
          source: "oauth",
          secret: { accessToken: "fixture-token" }
        }),
        cancel: () => {}
      }
    });
    let signalStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      signalStarted = resolve;
    });
    let finishCatalog!: (value: SubscriptionModelDefinition[]) => void;
    const catalog = new Promise<SubscriptionModelDefinition[]>((resolve) => {
      finishCatalog = resolve;
    });
    adapter.listModels = async (account) => {
      if (!account) return [GEMINI_PRO];
      signalStarted();
      return catalog;
    };
    const manager = new SubscriptionAccountManager(root, {
      registry: new ProviderAdapterRegistry([adapter]),
      secureStorage: fakeSecureStorage,
      events: {
        emitAuthProgress: (e) => authEvents.push(e),
        emitStateChanged: (e) => stateEvents.push(e)
      }
    });
    await manager.startAuth({ provider: adapter.id });
    await started;
    try {
      expect(authEvents.some((e) => e.status === "completed")).toBe(true);
      expect(stateEvents.some((e) => e.reason === "account_added")).toBe(true);
      expect(
        (await manager.getState()).providers.find(
          (p) => p.provider === adapter.id
        )?.accounts
      ).toHaveLength(1);
    } finally {
      finishCatalog([GEMINI_PRO]);
    }
    await vi.waitFor(() =>
      expect(stateEvents.some((e) => e.reason === "models_refreshed")).toBe(
        true
      )
    );
    await manager.startAuth({ provider: adapter.id });
    await vi.waitFor(() =>
      expect(
        stateEvents.filter((e) => e.reason === "models_refreshed")
      ).toHaveLength(2)
    );
    expect(
      stateEvents.filter((e) => e.reason === "account_updated")
    ).toHaveLength(1);
    expect(
      authEvents.filter((e) => e.status === "completed").at(-1)?.code
    ).toBe("subscriptions.account_updated");
  });

  it("reports a local write error without announcing a saved account", async () => {
    const root = await mkdtemp(join(tmpdir(), "writer-auth-write-"));
    tempDirs.push(root);
    const adapter = createMockAdapter({
      authHandle: {
        method: "oauth",
        completion: Promise.resolve({
          source: "oauth",
          displayName: "Example",
          secret: { accessToken: "fixture-only" }
        }),
        cancel: () => {}
      }
    });
    const emitAuthProgress = vi.fn();
    const emitStateChanged = vi.fn();
    const manager = new SubscriptionAccountManager(root, {
      registry: new ProviderAdapterRegistry([adapter]),
      secureStorage: fakeSecureStorage,
      events: { emitAuthProgress, emitStateChanged }
    });
    vi.spyOn(manager.persistence, "update").mockRejectedValueOnce(
      new Error("fixture write failure")
    );
    await manager.startAuth({ provider: adapter.id });
    await vi.waitFor(() =>
      expect(emitAuthProgress).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "failed",
          code: "subscriptions.account_save_failed"
        })
      )
    );
    expect(emitStateChanged).not.toHaveBeenCalled();
    expect(
      (await manager.getState()).providers.find(
        (p) => p.provider === adapter.id
      )?.accounts
    ).toEqual([]);
  });

  it("handles startAuth completion and cancelAuth events cleanly", async () => {
    const root = await mkdtemp(join(tmpdir(), "writer-sub-auth-"));
    tempDirs.push(root);
    let cancelCalled = false;
    let resolveAuth!: (value: ImportedAccountResult) => void;
    const completion = new Promise<ImportedAccountResult>((resolve) => {
      resolveAuth = resolve;
    });
    const authEvents: SubscriptionAuthProgressPayload[] = [];

    const manager = new SubscriptionAccountManager(root, {
      registry: new ProviderAdapterRegistry([
        createMockAdapter({
          authHandle: {
            method: "oauth",
            verificationUri: "https://auth.example.test/authorize",
            completion,
            cancel: () => {
              cancelCalled = true;
            }
          }
        })
      ]),
      secureStorage: fakeSecureStorage,
      events: {
        emitAuthProgress: (payload) => authEvents.push(payload),
        emitStateChanged: () => undefined
      }
    });

    const started = await manager.startAuth({
      provider: "google-gemini-cli",
      method: "oauth"
    });
    expect(started.authSessionId).toBeTruthy();

    const cancelled = await manager.cancelAuth({
      authSessionId: started.authSessionId
    });
    expect(cancelled).toEqual({ cancelled: true });
    expect(cancelCalled).toBe(true);
    expect(authEvents.at(-1)?.status).toBe("cancelled");

    // Late resolution after cancel does nothing.
    resolveAuth({
      displayName: "late@example.test",
      source: "oauth",
      secret: { accessToken: "late-token" }
    });
    await Promise.resolve();
    const state = await manager.getState();
    expect(
      state.providers.find((p) => p.provider === "google-gemini-cli")?.accounts
    ).toEqual([]);
  });

  it("blocks internal commands from Renderer and sanitizes IPC errors", async () => {
    const root = await mkdtemp(join(tmpdir(), "writer-sub-ipc-"));
    tempDirs.push(root);
    const manager = new SubscriptionAccountManager(root, {
      registry: new ProviderAdapterRegistry([createMockAdapter()]),
      secureStorage: fakeSecureStorage
    });

    expect(isForbiddenRendererCommand("subscriptions.acquireCredential")).toBe(
      true
    );
    expect(isForbiddenRendererCommand("subscriptions.reportAndFailover")).toBe(
      true
    );
    expect(isForbiddenRendererCommand("subscriptions.getState")).toBe(false);

    const rejectedAcquire = await handleSubscriptionCommands(
      cmd("subscriptions.acquireCredential", {
        runId: "run_1",
        provider: "google-gemini-cli",
        modelId: GEMINI_PRO.id
      }),
      manager
    );
    expect(rejectedAcquire).toMatchObject({
      status: "rejected",
      error: { code: "ipc.forbidden_internal_command" }
    });

    const rejectedFailover = await handleSubscriptionCommands(
      cmd("subscriptions.reportAndFailover", {
        runId: "run_1",
        provider: "google-gemini-cli",
        modelId: GEMINI_PRO.id,
        failedAccountId: "acct_1",
        reason: "rate_limited"
      }),
      manager
    );
    expect(rejectedFailover).toMatchObject({
      status: "rejected",
      error: { code: "ipc.forbidden_internal_command" }
    });

    const stateResult = await handleSubscriptionCommands(
      cmd("subscriptions.getState", {}),
      manager
    );
    expect(stateResult).toMatchObject({ status: "accepted" });
  });

  it("enforces bidirectional Zod validation on preload subscriptions API and never exposes internal commands", async () => {
    expect(preloadSubscriptions).not.toHaveProperty("acquireCredential");
    expect(preloadSubscriptions).not.toHaveProperty("reportAndFailover");

    // Invalid input rejected before IPC invoke.
    await expect(
      preloadSubscriptions.startAuth({ provider: "bad-provider" } as never)
    ).rejects.toThrow();
    expect(invoke).not.toHaveBeenCalled();

    // Leaked secret field in response rejected by strict output schema!
    invoke.mockImplementationOnce(async (_channel, command) => ({
      status: "accepted",
      requestId: command.id,
      payload: {
        providers: [
          {
            provider: "google-gemini-cli",
            name: "Google Gemini CLI",
            description: "desc",
            phase: 1,
            implemented: true,
            supportedAuthMethods: ["oauth"],
            accounts: [
              {
                id: "acct_1",
                provider: "google-gemini-cli",
                displayName: "user@example.test",
                source: "oauth",
                isPrimary: true,
                enabled: true,
                status: "active",
                quotaBuckets: [],
                createdAt: "2026-11-27T12:00:00.000Z",
                accessToken: "leaked-secret-token"
              }
            ],
            models: []
          }
        ],
        defaultModelId: ""
      }
    }));

    await expect(preloadSubscriptions.getState()).rejects.toThrow();
  });

  it("progresses 429 exponential backoff, refreshes pending-refresh tokens, and isolates batch refreshQuota failures with 401 retry", async () => {
    const root = await mkdtemp(join(tmpdir(), "writer-sub-regress-"));
    tempDirs.push(root);
    let nowMs = Date.parse("2026-11-28T00:00:00.000Z");
    let refreshCalls = 0;
    let quotaCallsForA = 0;

    const adapter: SubscriptionProviderAdapter = {
      id: "google-gemini-cli",
      meta: {
        name: "Google Gemini CLI",
        description: "Test",
        phase: 1,
        supportedAuthMethods: ["local_import"]
      },
      async scanLocalCandidates() {
        return [
          {
            candidateId: "cand_pending",
            provider: "google-gemini-cli",
            displayName: "pending@example.test",
            email: "pending@example.test",
            sourceLabel: "CLI",
            sourcePathHint: "~/.gemini/oauth_creds.json"
          },
          {
            candidateId: "cand_failing_quota",
            provider: "google-gemini-cli",
            displayName: "failquota@example.test",
            email: "failquota@example.test",
            sourceLabel: "CLI",
            sourcePathHint: "~/.gemini/oauth_creds_2.json"
          }
        ];
      },
      async importLocalCandidate(candidateId) {
        if (candidateId === "cand_pending") {
          return {
            displayName: "pending@example.test",
            email: "pending@example.test",
            source: "local_import",
            secret: {
              accessToken: "pending-refresh",
              refreshToken: "refresh-pending-1"
            }
          };
        }
        return {
          displayName: "failquota@example.test",
          email: "failquota@example.test",
          source: "local_import",
          secret: {
            accessToken: "healthy-token-2",
            refreshToken: "refresh-2",
            expiresAt: new Date(nowMs + 3_600_000).toISOString()
          }
        };
      },
      async refreshSecret(_account, secret) {
        refreshCalls += 1;
        return {
          ...secret,
          accessToken: `fresh-access-${refreshCalls}`,
          expiresAt: new Date(nowMs + 3_600_000).toISOString()
        };
      },
      async fetchQuota(account, secret) {
        if (account.email === "failquota@example.test") {
          throw new SubscriptionError(
            "subscriptions.upstream_error",
            "上游 503 临时故障"
          );
        }
        quotaCallsForA += 1;
        if (quotaCallsForA === 1) {
          throw new SubscriptionError(
            "subscriptions.secret_refresh_failed",
            "HTTP 401"
          );
        }
        expect(secret.accessToken).toContain("fresh-access-");
        return {
          planTier: "Pro",
          quotaBuckets: [{ id: "main", label: "主配额", remainingPercent: 90 }],
          status: "active"
        };
      },
      async listModels() {
        return [GEMINI_PRO];
      },
      toRuntimeCredential(account, secret) {
        return {
          provider: "google-gemini-cli",
          accountId: account.id,
          apiKey: secret.accessToken,
          baseUrl: "https://cloudcode.example.test",
          ...(secret.expiresAt ? { expiresAt: secret.expiresAt } : {})
        };
      }
    };

    const manager = new SubscriptionAccountManager(root, {
      registry: new ProviderAdapterRegistry([adapter]),
      secureStorage: fakeSecureStorage,
      now: () => nowMs
    });

    await manager.importLocal({
      provider: "google-gemini-cli",
      candidateId: "cand_pending"
    });
    const stateAfterImport = await manager.importLocal({
      provider: "google-gemini-cli",
      candidateId: "cand_failing_quota"
    });
    const accounts = stateAfterImport.providers.find(
      (p) => p.provider === "google-gemini-cli"
    )!.accounts;
    const pendingId = accounts[0]!.id;

    // 1. "pending-refresh" with no expiresAt must trigger proactive refresh on acquireCredential.
    const cred = await manager.acquireCredential({
      provider: "google-gemini-cli",
      modelId: GEMINI_PRO.id
    });
    expect(cred.apiKey).toBe("fresh-access-1");

    // 2. Repeated 429s must progress exponential backoff (30s -> 120s), not stay stuck at 30s.
    await manager.reportAndFailover({
      provider: "google-gemini-cli",
      modelId: GEMINI_PRO.id,
      failedAccountId: pendingId,
      reason: "rate_limited"
    });
    const afterFirst429 = (await manager.getState()).providers
      .find((p) => p.provider === "google-gemini-cli")!
      .accounts.find((a) => a.id === pendingId)!;
    expect(Date.parse(afterFirst429.cooldownUntil!) - nowMs).toBe(30_000);

    // Advance past 30s cooldown, acquire primary again, and hit 429 a second time -> 120s backoff!
    nowMs += 35_000;
    await manager.acquireCredential({
      provider: "google-gemini-cli",
      modelId: GEMINI_PRO.id
    });
    await manager.reportAndFailover({
      provider: "google-gemini-cli",
      modelId: GEMINI_PRO.id,
      failedAccountId: pendingId,
      reason: "rate_limited"
    });
    const afterSecond429 = (await manager.getState()).providers
      .find((p) => p.provider === "google-gemini-cli")!
      .accounts.find((a) => a.id === pendingId)!;
    expect(Date.parse(afterSecond429.cooldownUntil!) - nowMs).toBe(120_000);

    // 3. Batch refreshQuota isolates the failing second account and retries 401 once on first account.
    const afterQuota = await manager.refreshQuota({
      provider: "google-gemini-cli"
    });
    const refreshedPrimary = afterQuota.providers
      .find((p) => p.provider === "google-gemini-cli")!
      .accounts.find((a) => a.id === pendingId)!;
    expect(refreshedPrimary.planTier).toBe("Pro");
    expect(refreshedPrimary.quotaBuckets[0]?.remainingPercent).toBe(90);
    expect(quotaCallsForA).toBe(2);
  });

  it("refreshes live model catalogs via refreshModels (with 401 retry and IPC) and during refreshQuota", async () => {
    const root = await mkdtemp(join(tmpdir(), "writer-sub-models-"));
    tempDirs.push(root);
    const stateEvents: SubscriptionStateChangedPayload[] = [];
    let listModelsCalls = 0;
    let refreshCalls = 0;
    let remoteModelId = "gemini-2.5-pro";

    const adapter: SubscriptionProviderAdapter = {
      id: "google-gemini-cli",
      meta: {
        name: "Google Gemini CLI",
        description: "Test",
        phase: 1,
        supportedAuthMethods: ["local_import"]
      },
      async scanLocalCandidates() {
        return [
          {
            candidateId: "cand_1",
            provider: "google-gemini-cli",
            displayName: "models@example.test",
            email: "models@example.test",
            sourceLabel: "CLI"
          }
        ];
      },
      async importLocalCandidate() {
        return {
          displayName: "models@example.test",
          email: "models@example.test",
          source: "local_import",
          secret: {
            accessToken: "initial-token",
            refreshToken: "refresh-token-1",
            expiresAt: "2026-11-29T00:00:00.000Z"
          }
        };
      },
      async refreshSecret(_account, secret) {
        refreshCalls += 1;
        return {
          ...secret,
          accessToken: `refreshed-token-${refreshCalls}`,
          expiresAt: "2026-11-29T01:00:00.000Z"
        };
      },
      async fetchQuota() {
        return {
          planTier: "Pro",
          quotaBuckets: [{ id: "main", label: "主配额", remainingPercent: 95 }],
          status: "active"
        };
      },
      async listModels(_account, secret) {
        listModelsCalls += 1;
        if (listModelsCalls === 2) {
          throw new SubscriptionError(
            "subscriptions.secret_refresh_failed",
            "HTTP 401"
          );
        }
        return [
          GEMINI_PRO,
          ...(remoteModelId === "gemini-2.5-pro"
            ? []
            : [
                {
                  ...GEMINI_PRO,
                  id: `sub:google-gemini-cli:${remoteModelId}`,
                  modelId: remoteModelId,
                  label: `Remote ${remoteModelId} (${secret?.accessToken ?? "none"})`,
                  recommended: false
                }
              ])
        ];
      },
      toRuntimeCredential(account, secret) {
        return {
          provider: "google-gemini-cli",
          accountId: account.id,
          apiKey: secret.accessToken,
          baseUrl: "https://cloudcode.example.test"
        };
      }
    };

    const manager = new SubscriptionAccountManager(root, {
      registry: new ProviderAdapterRegistry([adapter]),
      secureStorage: fakeSecureStorage,
      now: () => Date.parse("2026-11-28T00:00:00.000Z"),
      events: {
        emitAuthProgress: () => undefined,
        emitStateChanged: (payload) => stateEvents.push(payload)
      }
    });

    await manager.importLocal({
      provider: "google-gemini-cli",
      candidateId: "cand_1"
    });
    expect(listModelsCalls).toBe(1);

    // 1. Trigger subscriptions.refreshModels via preload -> IPC -> manager, hitting 401 once and retrying with refreshed token.
    remoteModelId = "gemini-3.5-pro";
    invoke.mockImplementation(async (_channel: string, command: unknown) => {
      const parsed = CommandEnvelopeSchema.parse(command);
      return await handleSubscriptionCommands(parsed, manager);
    });
    const afterManualRefresh = await preloadSubscriptions.refreshModels({
      provider: "google-gemini-cli"
    });
    expect(refreshCalls).toBe(1);
    expect(listModelsCalls).toBe(3);
    const modelsAfterManual = afterManualRefresh.providers.find(
      (p) => p.provider === "google-gemini-cli"
    )!.models;
    expect(modelsAfterManual.some((m) => m.modelId === "gemini-3.5-pro")).toBe(
      true
    );
    expect(
      stateEvents.some(
        (evt) =>
          evt.reason === "models_refreshed" &&
          evt.provider === "google-gemini-cli"
      )
    ).toBe(true);

    // 2. Subsequent refreshQuota also refreshes the cached model catalog automatically.
    remoteModelId = "gemini-3.5-ultra";
    const afterQuota = await manager.refreshQuota({
      provider: "google-gemini-cli"
    });
    const modelsAfterQuota = afterQuota.providers.find(
      (p) => p.provider === "google-gemini-cli"
    )!.models;
    expect(modelsAfterQuota.some((m) => m.modelId === "gemini-3.5-ultra")).toBe(
      true
    );
  });
});
