import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import {
  SUBSCRIPTION_PROVIDER_IDS,
  createEnvelope,
  isSyncableModelId
} from "@writer/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isForbiddenRendererCommand } from "../../ipc/forbidden-commands";
import { toSyncedModel } from "../../model-config-sync";
import { handleSubscriptionCommands } from "../ipc-commands";
import { SubscriptionAccountManager } from "../manager";
import {
  safeSubscriptionError,
  type AuthFlowContext,
  type SecureStorageLike,
  type StoredAccountRecord,
  type StoredAccountSecret
} from "../types";
import {
  createCodeBuddyAdapter,
  createWindsurfAdapter,
  createDefaultSubscriptionRegistry
} from "./index";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))
  );
});

async function createTempDir(prefix = "writer-sub-phase3b-"): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function makeStoredAccount(
  id: string,
  provider: StoredAccountRecord["provider"],
  source: StoredAccountRecord["source"] = "oauth"
): StoredAccountRecord {
  return {
    id,
    provider,
    displayName: `${provider}@example.test`,
    email: `${provider}@example.test`,
    source,
    isPrimary: true,
    enabled: true,
    status: "active",
    consecutiveRateLimits: 0,
    quotaBuckets: [],
    createdAt: "2026-11-28T00:00:00.000Z"
  };
}

function createMockSecureStorage(): SecureStorageLike {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (plainText: string) =>
      Buffer.from(`enc:${plainText}`, "utf8"),
    decryptString: (encrypted: Buffer) => {
      const text = encrypted.toString("utf8");
      if (!text.startsWith("enc:")) throw new Error("bad cipher");
      return text.slice(4);
    }
  };
}

async function sha256File(filePath: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(filePath))
    .digest("hex");
}

describe("Phase 3B CodeBuddy Adapter & Full 9-Provider Security Audit", () => {
  it("exchanges Windsurf browser tokens before persisting the account", async () => {
    const fetcher = vi.fn(async () =>
      Response.json({ api_key: "fixture-exchanged-key" })
    );
    const adapter = createWindsurfAdapter({ fetcher });
    const input = { token: "fixture-one-time-token", browserToken: true };
    const account = await adapter.importManualToken!(input);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(account.secret.accessToken).toBe("fixture-exchanged-key");
    expect(JSON.stringify(account)).not.toContain(input.token);
    fetcher.mockResolvedValueOnce(Response.json({}, { status: 401 }));
    await expect(adapter.importManualToken!(input)).rejects.toMatchObject({
      code: "subscriptions.invalid_manual_token"
    });
  });

  it("supports CodeBuddy OAuth PKCE, read-only JSON & SQLite local import, refresh, quota, models, and secret-free runtime credentials", async () => {
    const homeDir = await createTempDir();
    const cbDir = join(homeDir, ".codebuddy");
    const appDataDir = join(homeDir, "AppData", "Roaming");
    const ideStorageDir = join(
      appDataDir,
      "CodeBuddy",
      "User",
      "globalStorage"
    );
    await mkdir(cbDir, { recursive: true });
    await mkdir(ideStorageDir, { recursive: true });

    const authJsonPath = join(cbDir, "auth.json");
    await writeFile(
      authJsonPath,
      JSON.stringify(
        {
          accessToken: "cb-local-json-token",
          refreshToken: "cb-local-json-refresh",
          email: "cb-json@example.test",
          planTier: "Pro"
        },
        null,
        2
      ),
      "utf8"
    );
    const dbPath = join(ideStorageDir, "state.vscdb");
    const db = new DatabaseSync(dbPath);
    db.exec("CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value TEXT)");
    db.prepare("INSERT INTO ItemTable VALUES (?, ?)").run(
      "codebuddy.auth",
      JSON.stringify({
        accessToken: "cb-local-db-token",
        refreshToken: "cb-local-db-refresh",
        email: "cb-db@example.test",
        nickname: "CodeBuddy IDE User"
      })
    );
    db.close();

    const originalJsonHash = await sha256File(authJsonPath);
    const originalDbHash = await sha256File(dbPath);

    let quotaExhausted = false;
    let pollCount = 0;
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "https://cb.example.test/v2/plugin/auth/state?platform=ide") {
        const headers = init?.headers as Record<string, string> | undefined;
        expect(headers?.["X-No-Authorization"]).toBe("true");
        return new Response(
          JSON.stringify({
            data: {
              state: "cb-state-123",
              authUrl: "https://cb.example.test/login?state=cb-state-123"
            }
          }),
          { status: 200 }
        );
      }
      if (
        url ===
        "https://cb.example.test/v2/plugin/auth/token?state=cb-state-123"
      ) {
        pollCount += 1;
        if (pollCount === 1) {
          return new Response(JSON.stringify({ data: {} }), { status: 202 });
        }
        return new Response(
          JSON.stringify({
            data: {
              access_token: "cb-oauth-access-1",
              refresh_token: "cb-oauth-refresh-1",
              expires_in: 7200,
              plan_name: "Pro"
            }
          }),
          { status: 200 }
        );
      }
      if (
        url ===
        "https://cb.example.test/v2/plugin/login/account?state=cb-state-123"
      ) {
        return new Response(
          JSON.stringify({
            data: {
              email: "cb-oauth@example.test",
              nickname: "CodeBuddy Author"
            }
          }),
          { status: 200 }
        );
      }
      if (url === "https://cb.example.test/v2/plugin/auth/token/refresh") {
        const headers = init?.headers as Record<string, string> | undefined;
        expect(headers?.["X-Refresh-Token"]).toBe("cb-local-json-refresh");
        return new Response(
          JSON.stringify({
            data: {
              access_token: "cb-refreshed-access-2",
              refresh_token: "cb-refreshed-refresh-2",
              expires_in: 3600
            }
          }),
          { status: 200 }
        );
      }
      if (
        url === "https://cb.example.test/v2/billing/meter/get-user-resource"
      ) {
        const body = JSON.parse(String(init?.body ?? "{}")) as Record<
          string,
          unknown
        >;
        expect(body.ProductCode).toBe("p_tcaca");
        return new Response(
          JSON.stringify({
            plan_name: "Pro",
            data: {
              PackageList: [
                {
                  PackageName: "对话额度",
                  Used: quotaExhausted ? 1000 : 250,
                  Remain: quotaExhausted ? 0 : 750,
                  Total: 1000,
                  Unit: "requests",
                  ExpiredTime: "2026-12-31T00:00:00.000Z"
                },
                {
                  PackageName: "高级模型额度",
                  Used: 40,
                  Remain: 160,
                  Total: 200,
                  Unit: "requests",
                  ExpiredTime: "2026-12-31T00:00:00.000Z"
                }
              ]
            }
          }),
          { status: 200 }
        );
      }
      return new Response("not found", { status: 404 });
    });

    const adapter = createCodeBuddyAdapter({
      homeDir,
      env: { APPDATA: appDataDir },
      now: () => 1_700_000_000_000,
      fetcher,
      apiBaseUrl: "https://cb.example.test",
      pollIntervalMs: 1
    });

    const openedUrls: string[] = [];
    const authCtx: AuthFlowContext = {
      authSessionId: "cb_auth_1",
      method: "oauth",
      signal: new AbortController().signal,
      openExternalUrl: async (u) => {
        openedUrls.push(u);
      },
      onProgress: vi.fn()
    };
    const handle = await adapter.startAuth!(authCtx);
    expect(handle.verificationUri).toContain("state=cb-state-123");
    expect(openedUrls).toEqual([handle.verificationUri]);
    const oauthResult = await handle.completion;
    expect(oauthResult).toMatchObject({
      email: "cb-oauth@example.test",
      planTier: "Pro",
      source: "oauth",
      secret: {
        accessToken: "cb-oauth-access-1",
        refreshToken: "cb-oauth-refresh-1"
      }
    });

    const candidates = await adapter.scanLocalCandidates!();
    expect(candidates).toHaveLength(2);
    expect(candidates.map((c) => c.email)).toEqual([
      "cb-json@example.test",
      "cb-db@example.test"
    ]);
    const imported = await adapter.importLocalCandidate!(
      candidates[0]!.candidateId
    );
    expect(imported).toMatchObject({
      email: "cb-json@example.test",
      planTier: "Pro",
      source: "local_import",
      secret: {
        accessToken: "cb-local-json-token",
        refreshToken: "cb-local-json-refresh"
      }
    });
    expect(await sha256File(authJsonPath)).toBe(originalJsonHash);
    expect(await sha256File(dbPath)).toBe(originalDbHash);

    const acct = makeStoredAccount("acct_cb_1", "codebuddy");
    const refreshed: StoredAccountSecret = await adapter.refreshSecret(
      acct,
      imported.secret
    );
    expect(refreshed.accessToken).toBe("cb-refreshed-access-2");
    expect(refreshed.refreshToken).toBe("cb-refreshed-refresh-2");

    const activeQuota = await adapter.fetchQuota(acct, refreshed);
    expect(activeQuota.planTier).toBe("Pro");
    expect(activeQuota.status).toBe("active");
    expect(activeQuota.quotaBuckets).toEqual([
      {
        id: "codebuddy-pkg-0",
        label: "对话额度",
        remainingPercent: 75,
        used: 250,
        limit: 1000,
        unit: "requests",
        resetsAt: "2026-12-31T00:00:00.000Z"
      },
      {
        id: "codebuddy-pkg-1",
        label: "高级模型额度",
        remainingPercent: 80,
        used: 40,
        limit: 200,
        unit: "requests",
        resetsAt: "2026-12-31T00:00:00.000Z"
      }
    ]);

    quotaExhausted = true;
    const exhaustedQuota = await adapter.fetchQuota(acct, refreshed);
    expect(exhaustedQuota.status).toBe("quota_exhausted");
    expect(exhaustedQuota.cooldownUntil).toBe("2026-12-31T00:00:00.000Z");

    const models = await adapter.listModels(acct, refreshed);
    expect(models[0]).toMatchObject({
      id: "sub:codebuddy:deepseek-v4-pro",
      api: "codebuddy-chat",
      recommended: true
    });
    const runtimeCred = adapter.toRuntimeCredential(
      acct,
      refreshed,
      models[0]!
    );
    expect(runtimeCred).toMatchObject({
      provider: "codebuddy",
      accountId: "acct_cb_1",
      apiKey: "cb-refreshed-access-2",
      baseUrl: "https://cb.example.test"
    });
    expect("refreshToken" in runtimeCred).toBe(false);
  });

  it("audits all 9 providers for zero token leakage, cloud sync exclusion, forbidden internal commands, and strictly read-only local importers", async () => {
    const registry = createDefaultSubscriptionRegistry();
    expect(registry.listAdapters().map((a) => a.id)).toEqual([
      ...SUBSCRIPTION_PROVIDER_IDS
    ]);

    const secretSentinels = [
      "SENTINEL_REFRESH_TOKEN_999",
      "SENTINEL_ID_TOKEN_999",
      "SENTINEL_CLIENT_SECRET_999",
      "SENTINEL_SESSION_COOKIE_999",
      "SENTINEL_OAUTH_SECRET_999"
    ];

    const userDataDir = await createTempDir("writer-sub-audit-");
    const manager = new SubscriptionAccountManager(userDataDir, {
      registry,
      secureStorage: createMockSecureStorage()
    });

    for (const adapter of registry.listAdapters()) {
      const models = await adapter.listModels();
      expect(models.length).toBeGreaterThan(0);

      // 1. Every subscription model across all 9 providers is strictly excluded from cloud sync.
      for (const model of models) {
        expect(isSyncableModelId(model.id)).toBe(false);
        expect(
          toSyncedModel({
            id: model.id,
            label: model.label,
            provider: model.provider,
            modelId: model.modelId,
            api: model.api,
            baseUrl: model.baseUrl ?? "",
            reasoning: model.reasoning,
            defaultThinkingLevel: model.defaultThinkingLevel,
            thinkingLevelOptions: model.thinkingLevelOptions ?? [
              "low",
              "medium",
              "high"
            ],
            temperatureOptions: model.temperatureOptions ?? [0.1, 0.7, 1],
            managedBy: "subscription"
          })
        ).toBeNull();
      }

      // 2. toRuntimeCredential never leaks refreshToken, idToken, clientSecret, or sessionCookie.
      const acct = makeStoredAccount(`acct_${adapter.id}`, adapter.id);
      const secret: StoredAccountSecret = {
        accessToken: `SENTINEL_ACCESS_${adapter.id}`,
        refreshToken: secretSentinels[0]!,
        idToken: secretSentinels[1]!,
        providerToken: `SENTINEL_PROVIDER_${adapter.id}`,
        extra: {
          clientSecret: secretSentinels[2]!,
          sessionCookie: secretSentinels[3]!,
          oauthClientSecret: secretSentinels[4]!,
          projectId: "proj-audit",
          region: "us-east-1"
        }
      };
      const cred = adapter.toRuntimeCredential(acct, secret, models[0]!);
      const credJson = JSON.stringify(cred);
      for (const sentinel of secretSentinels) {
        expect(credJson).not.toContain(sentinel);
      }

      // Persist account & secret via persistence layer and verify getState IPC never leaks any token.
      await manager.persistence.update((state) => ({
        state: {
          ...state,
          accounts: [...state.accounts, acct],
          encryptedSecrets: {
            ...state.encryptedSecrets,
            [acct.id]: manager.persistence.encryptSecret(secret)
          }
        },
        result: undefined
      }));
    }

    const stateRes = await handleSubscriptionCommands(
      createEnvelope("subscriptions.getState", {}, { id: "cmd_audit_state" }),
      manager
    );
    expect(stateRes?.status).toBe("accepted");
    const serializedState = JSON.stringify(stateRes);
    for (const sentinel of secretSentinels) {
      expect(serializedState).not.toContain(sentinel);
    }
    for (const providerId of SUBSCRIPTION_PROVIDER_IDS) {
      expect(serializedState).not.toContain(`SENTINEL_ACCESS_${providerId}`);
      expect(serializedState).not.toContain(`SENTINEL_PROVIDER_${providerId}`);
    }

    // 3. Renderer is strictly forbidden from invoking internal credential/failover commands.
    expect(isForbiddenRendererCommand("subscriptions.acquireCredential")).toBe(
      true
    );
    expect(isForbiddenRendererCommand("subscriptions.reportAndFailover")).toBe(
      true
    );
    const rejectedAcquire = await handleSubscriptionCommands(
      createEnvelope(
        "subscriptions.acquireCredential",
        {
          runId: "run_1",
          provider: "codebuddy" as const,
          modelId: "sub:codebuddy:deepseek-r1"
        },
        { id: "cmd_forbid_1" }
      ),
      manager
    );
    expect(rejectedAcquire).toMatchObject({
      status: "rejected",
      error: { code: "ipc.forbidden_internal_command" }
    });
    const rejectedFailover = await handleSubscriptionCommands(
      createEnvelope(
        "subscriptions.reportAndFailover",
        {
          runId: "run_1",
          provider: "codebuddy" as const,
          modelId: "sub:codebuddy:deepseek-r1",
          failedAccountId: "acct_codebuddy",
          reason: "rate_limited" as const
        },
        { id: "cmd_forbid_2" }
      ),
      manager
    );
    expect(rejectedFailover).toMatchObject({
      status: "rejected",
      error: { code: "ipc.forbidden_internal_command" }
    });

    // 4. Generic errors never leak raw token text via safeSubscriptionError.
    const safe = safeSubscriptionError(
      new Error("Authorization: Bearer SENTINEL_REFRESH_TOKEN_999 failed")
    );
    expect(safe.message).not.toContain("SENTINEL_REFRESH_TOKEN_999");

    // 5. All provider adapter source files are strictly read-only (no filesystem write primitives).
    const providersDir = dirname(fileURLToPath(import.meta.url));
    const entries = await readdir(providersDir);
    const prodFiles = entries.filter(
      (name) => name.endsWith(".ts") && !name.endsWith(".test.ts")
    );
    expect(prodFiles.length).toBeGreaterThanOrEqual(10);
    for (const file of prodFiles) {
      const source = await readFile(join(providersDir, file), "utf8");
      expect(source).not.toMatch(
        /\b(writeFile|writeFileSync|appendFile|appendFileSync|unlink|unlinkSync|renameSync|rmSync)\b/u
      );
      expect(source).not.toMatch(/\b(INSERT|UPDATE|DELETE|CREATE TABLE)\b/iu);
    }
  });
});
