import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createEnvelope } from "@writer/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { handleSubscriptionCommands } from "../ipc-commands";
import { SubscriptionAccountManager } from "../manager";
import { ProviderAdapterRegistry } from "../registry";
import type {
  SecureStorageLike,
  StoredAccountRecord,
  StoredAccountSecret
} from "../types";
import { createCursorAdapter, createWindsurfAdapter } from "./index";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))
  );
});

async function createTempDir(prefix = "writer-sub-phase3a-"): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function makeFakeJwt(payload: Record<string, unknown>): string {
  const h = Buffer.from(JSON.stringify({ alg: "RS256" })).toString("base64url");
  const p = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${h}.${p}.fake_sig`;
}

function makeStoredAccount(
  id: string,
  provider: StoredAccountRecord["provider"],
  source: StoredAccountRecord["source"] = "local_import"
): StoredAccountRecord {
  return {
    id,
    provider,
    displayName: "Test Account",
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

describe("Phase 3A Subscription Provider Adapters (Cursor & Windsurf)", () => {
  it("reads Cursor SQLite state.vscdb strictly read-only (even while open), supports manual token import, refresh, quota, unofficialWarning, and secret-free runtime credentials", async () => {
    const homeDir = await createTempDir();
    const appDataDir = join(homeDir, "AppData", "Roaming");
    const cursorStorageDir = join(
      appDataDir,
      "Cursor",
      "User",
      "globalStorage"
    );
    await mkdir(cursorStorageDir, { recursive: true });
    const dbPath = join(cursorStorageDir, "state.vscdb");

    const localJwt = makeFakeJwt({
      sub: "auth0|user_cursor_local_1",
      email: "cursor-local@example.test",
      exp: 1_900_000_000
    });
    const db = new DatabaseSync(dbPath);
    db.exec("CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value TEXT)");
    const insert = db.prepare("INSERT INTO ItemTable VALUES (?, ?)");
    insert.run("cursorAuth/accessToken", localJwt);
    insert.run("cursorAuth/refreshToken", "cursor-refresh-local-1");
    insert.run("cursorAuth/cachedEmail", "cursor-local@example.test");
    insert.run("cursorAuth/stripeMembershipType", "pro");
    db.close();

    const originalHash = await sha256File(dbPath);
    // Simulate a live external Cursor process keeping state.vscdb open.
    const liveExternalDb = new DatabaseSync(dbPath, { readOnly: true });

    let quotaExhausted = false;
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "https://auth.cursor.example.test/oauth/token") {
        const body = JSON.parse(String(init?.body ?? "{}")) as Record<
          string,
          unknown
        >;
        expect(body.grant_type).toBe("refresh_token");
        expect(body.refresh_token).toBe("cursor-refresh-local-1");
        return new Response(
          JSON.stringify({
            access_token: makeFakeJwt({
              sub: "auth0|user_cursor_local_1",
              email: "cursor-local@example.test",
              exp: 1_950_000_000
            }),
            refresh_token: "cursor-refresh-rotated-2",
            expires_in: 7200
          }),
          { status: 200 }
        );
      }
      if (url.startsWith("https://web.cursor.example.test/api/usage")) {
        const headers = new Headers(init?.headers);
        expect(headers.get("authorization")).toMatch(/^Bearer /u);
        return new Response(
          JSON.stringify({
            membershipType: "pro",
            startOfMonth: "2026-11-01T00:00:00.000Z",
            "gpt-4": {
              numRequests: quotaExhausted ? 500 : 125,
              maxRequestUsage: 500
            }
          }),
          { status: 200 }
        );
      }
      return new Response("not found", { status: 404 });
    });

    try {
      const adapter = createCursorAdapter({
        homeDir,
        env: { APPDATA: appDataDir },
        now: () => 1_700_000_000_000,
        fetcher,
        apiBaseUrl: "https://api.cursor.example.test",
        webBaseUrl: "https://web.cursor.example.test",
        authBaseUrl: "https://auth.cursor.example.test"
      });

      expect(adapter.meta.unofficialWarning).toBeTruthy();
      expect(adapter.meta.supportedAuthMethods).toContain("local_import");
      expect(adapter.meta.supportedAuthMethods).toContain("manual_token");

      const candidates = await adapter.scanLocalCandidates!();
      expect(candidates).toHaveLength(1);
      expect(candidates[0]).toMatchObject({
        provider: "cursor",
        email: "cursor-local@example.test",
        sourceLabel: "Cursor 本地状态库（只读）"
      });

      const imported = await adapter.importLocalCandidate!(
        candidates[0]!.candidateId
      );
      expect(imported).toMatchObject({
        email: "cursor-local@example.test",
        planTier: "Pro",
        source: "local_import",
        secret: {
          accessToken: localJwt,
          refreshToken: "cursor-refresh-local-1",
          extra: { userId: "user_cursor_local_1" }
        }
      });

      // Manual token import: WorkosCursorSessionToken & JSON paste
      const manualJwt = makeFakeJwt({
        sub: "user_manual_9",
        email: "cursor-manual@example.test",
        exp: 1_900_000_000
      });
      const manualFromCookie = await adapter.importManualToken!({
        token: `user_manual_9%3A%3A${manualJwt}`
      });
      expect(manualFromCookie).toMatchObject({
        email: "cursor-manual@example.test",
        source: "manual_token",
        secret: {
          accessToken: manualJwt,
          extra: {
            userId: "user_manual_9",
            sessionCookie: `user_manual_9%3A%3A${manualJwt}`
          }
        }
      });

      const manualFromJson = await adapter.importManualToken!({
        token: JSON.stringify({
          accessToken: manualJwt,
          refreshToken: "cursor-manual-refresh",
          email: "json-override@example.test"
        })
      });
      expect(manualFromJson).toMatchObject({
        email: "json-override@example.test",
        secret: {
          accessToken: manualJwt,
          refreshToken: "cursor-manual-refresh"
        }
      });

      await expect(
        adapter.importManualToken!({ token: "{not-json" })
      ).rejects.toMatchObject({ code: "subscriptions.invalid_manual_token" });

      // Refresh with refreshToken rotation + unexpired manual token passthrough
      const acct = makeStoredAccount("acct_cursor_1", "cursor");
      const refreshed: StoredAccountSecret = await adapter.refreshSecret(
        acct,
        imported.secret
      );
      expect(refreshed.refreshToken).toBe("cursor-refresh-rotated-2");

      const passthrough = await adapter.refreshSecret(
        acct,
        manualFromCookie.secret
      );
      expect(passthrough.accessToken).toBe(manualJwt);

      await expect(
        adapter.refreshSecret(acct, {
          accessToken: manualJwt,
          expiresAt: "2020-01-01T00:00:00.000Z"
        })
      ).rejects.toMatchObject({ code: "subscriptions.secret_refresh_failed" });

      // Quota parsing & exhausted detection
      const activeQuota = await adapter.fetchQuota(acct, refreshed);
      expect(activeQuota.planTier).toBe("Pro");
      expect(activeQuota.status).toBe("active");
      expect(activeQuota.quotaBuckets).toEqual([
        {
          id: "cursor-fast-premium",
          label: "Fast / Premium 请求",
          remainingPercent: 75,
          used: 125,
          limit: 500,
          unit: "requests",
          resetsAt: "2026-12-01T00:00:00.000Z"
        }
      ]);

      quotaExhausted = true;
      const exhaustedQuota = await adapter.fetchQuota(acct, refreshed);
      expect(exhaustedQuota.status).toBe("quota_exhausted");
      expect(exhaustedQuota.cooldownUntil).toBe("2026-12-01T00:00:00.000Z");

      // Models & secret-free runtime credentials
      const models = await adapter.listModels(acct, refreshed);
      expect(models[0]).toMatchObject({
        id: "sub:cursor:composer-2.5",
        api: "cursor-connect",
        recommended: true
      });
      const runtimeCred = adapter.toRuntimeCredential(
        acct,
        manualFromCookie.secret,
        models[0]!
      );
      expect(runtimeCred).toMatchObject({
        provider: "cursor",
        accountId: "acct_cursor_1",
        apiKey: manualJwt,
        baseUrl: "https://api.cursor.example.test"
      });
      expect("refreshToken" in runtimeCred).toBe(false);
      expect("sessionCookie" in runtimeCred).toBe(false);
      expect("sessionCookie" in (runtimeCred.metadata ?? {})).toBe(false);

      // End-to-end IPC subscriptions.importManual returns sanitized snapshot only
      const userDataDir = await createTempDir("writer-sub-mgr-");
      const manager = new SubscriptionAccountManager(userDataDir, {
        registry: new ProviderAdapterRegistry([adapter]),
        secureStorage: createMockSecureStorage()
      });
      const ipcResult = await handleSubscriptionCommands(
        createEnvelope(
          "subscriptions.importManual",
          {
            provider: "cursor" as const,
            token: manualJwt,
            email: "cursor-ipc@example.test"
          },
          { id: "cmd_manual_1" }
        ),
        manager
      );
      expect(ipcResult?.status).toBe("accepted");
      const serialized = JSON.stringify(ipcResult);
      expect(serialized).toContain("cursor-ipc@example.test");
      expect(serialized).not.toContain(manualJwt);
    } finally {
      liveExternalDb.close();
    }

    // Verify original SQLite database file was never modified.
    expect(await sha256File(dbPath)).toBe(originalHash);
  });

  it("reads Windsurf SQLite & JSON configs strictly read-only, supports manual token import, refresh, Prompt/Flow Credits quota, and secret-free runtime credentials", async () => {
    const homeDir = await createTempDir();
    const appDataDir = join(homeDir, "AppData", "Roaming");
    const wsStorageDir = join(appDataDir, "Windsurf", "User", "globalStorage");
    const codeiumDir = join(homeDir, ".codeium", "windsurf");
    await mkdir(wsStorageDir, { recursive: true });
    await mkdir(codeiumDir, { recursive: true });

    const dbPath = join(wsStorageDir, "state.vscdb");
    const db = new DatabaseSync(dbPath);
    db.exec("CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value TEXT)");
    db.prepare("INSERT INTO ItemTable VALUES (?, ?)").run(
      "windsurfAuthStatus",
      JSON.stringify({
        apiKey: "ws-sqlite-apikey-placeholder",
        refreshToken: "ws-sqlite-refresh-1",
        email: "windsurf-db@example.test",
        name: "Windsurf Author",
        planName: "Pro"
      })
    );
    db.close();

    const authJsonPath = join(codeiumDir, "auth.json");
    await writeFile(
      authJsonPath,
      JSON.stringify(
        {
          apiKey: "ws-json-apikey-placeholder",
          email: "windsurf-json@example.test"
        },
        null,
        2
      ),
      "utf8"
    );

    const originalDbHash = await sha256File(dbPath);
    const originalJsonHash = await sha256File(authJsonPath);

    let exhausted = false;
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      if (
        url ===
        "https://auth.windsurf.example.test/exa.seat_management_pb.SeatManagementService/RegisterUser"
      ) {
        const body = JSON.parse(String(init?.body ?? "{}")) as Record<
          string,
          unknown
        >;
        expect(body.firebase_id_token).toBe("ws-sqlite-refresh-1");
        return new Response(
          JSON.stringify({
            apiKey: "ws-refreshed-token-2",
            refreshToken: "ws-refreshed-refresh-2",
            expiresIn: 3600
          }),
          { status: 200 }
        );
      }
      if (
        url ===
        "https://server.windsurf.example.test/exa.seat_management_pb.SeatManagementService/GetUserStatus"
      ) {
        return new Response(
          JSON.stringify({
            userStatus: {
              planStatus: {
                planInfo: { planName: "Pro Ultimate" },
                planEnd: "2026-12-15T00:00:00.000Z",
                availablePromptCredits: exhausted ? 0 : 375,
                usedPromptCredits: exhausted ? 500 : 125,
                availableFlowCredits: exhausted ? 0 : 800,
                usedFlowCredits: exhausted ? 1000 : 200
              }
            }
          }),
          { status: 200 }
        );
      }
      return new Response("not found", { status: 404 });
    });

    const adapter = createWindsurfAdapter({
      homeDir,
      env: { APPDATA: appDataDir },
      now: () => 1_700_000_000_000,
      fetcher,
      apiBaseUrl: "https://server.windsurf.example.test",
      authBaseUrl: "https://auth.windsurf.example.test"
    });

    expect(adapter.meta.unofficialWarning).toBeTruthy();
    const candidates = await adapter.scanLocalCandidates!();
    expect(candidates).toHaveLength(2);
    expect(candidates.map((c) => c.email)).toEqual([
      "windsurf-db@example.test",
      "windsurf-json@example.test"
    ]);

    const imported = await adapter.importLocalCandidate!(
      candidates[0]!.candidateId
    );
    expect(imported).toMatchObject({
      displayName: "Windsurf Author",
      email: "windsurf-db@example.test",
      planTier: "Pro",
      source: "local_import",
      secret: {
        accessToken: "ws-sqlite-apikey-placeholder",
        refreshToken: "ws-sqlite-refresh-1"
      }
    });

    // Manual token import
    const manual = await adapter.importManualToken!({
      token: "ws-manual-key-placeholder",
      email: "ws-manual@example.test"
    });
    expect(manual).toMatchObject({
      displayName: "ws-manual@example.test",
      email: "ws-manual@example.test",
      source: "manual_token",
      secret: { accessToken: "ws-manual-key-placeholder" }
    });

    // Refresh
    const acct = makeStoredAccount("acct_ws_1", "windsurf");
    const refreshed = await adapter.refreshSecret(acct, imported.secret);
    expect(refreshed.accessToken).toBe("ws-refreshed-token-2");
    expect(refreshed.refreshToken).toBe("ws-refreshed-refresh-2");

    // Quota: Prompt Credits + Flow Credits
    const activeQuota = await adapter.fetchQuota(acct, refreshed);
    expect(activeQuota.planTier).toBe("Pro Ultimate");
    expect(activeQuota.status).toBe("active");
    expect(activeQuota.quotaBuckets).toEqual([
      {
        id: "windsurf-prompt-credits",
        label: "Prompt Credits",
        remainingPercent: 75,
        used: 125,
        limit: 500,
        unit: "credits",
        resetsAt: "2026-12-15T00:00:00.000Z"
      },
      {
        id: "windsurf-flow-credits",
        label: "Flow Credits",
        remainingPercent: 80,
        used: 200,
        limit: 1000,
        unit: "credits",
        resetsAt: "2026-12-15T00:00:00.000Z"
      }
    ]);

    exhausted = true;
    const exhaustedQuota = await adapter.fetchQuota(acct, refreshed);
    expect(exhaustedQuota.status).toBe("quota_exhausted");
    expect(exhaustedQuota.cooldownUntil).toBe("2026-12-15T00:00:00.000Z");

    // Models & secret-free runtime credential
    const models = await adapter.listModels(acct, refreshed);
    expect(models[0]).toMatchObject({
      id: "sub:windsurf:swe-2.1",
      api: "windsurf-connect",
      recommended: true
    });
    const runtimeCred = adapter.toRuntimeCredential(
      acct,
      refreshed,
      models[0]!
    );
    expect(runtimeCred).toMatchObject({
      provider: "windsurf",
      accountId: "acct_ws_1",
      apiKey: "ws-refreshed-token-2",
      baseUrl: "https://server.windsurf.example.test"
    });
    expect("refreshToken" in runtimeCred).toBe(false);

    // Guarantee local files were never mutated.
    expect(await sha256File(dbPath)).toBe(originalDbHash);
    expect(await sha256File(authJsonPath)).toBe(originalJsonHash);
  });
});
