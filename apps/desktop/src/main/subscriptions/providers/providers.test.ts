import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  AuthFlowContext,
  StoredAccountRecord,
  StoredAccountSecret
} from "../types";
import type { LoopbackStarter } from "./shared";
import { createGoogleGeminiCliAdapter } from "./google-gemini-cli";
import {
  createGoogleAntigravityAdapter,
  ANTIGRAVITY_OAUTH_CLIENT
} from "./google-antigravity";
import { createOpenAICodexAdapter } from "./openai-codex";
import { createGitHubCopilotAdapter } from "./github-copilot";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))
  );
});

async function createTempHome(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "writer-sub-providers-"));
  tempDirs.push(dir);
  return dir;
}

function makeFakeJwt(payload: Record<string, unknown>): string {
  const h = Buffer.from(JSON.stringify({ alg: "RS256" })).toString("base64url");
  const p = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${h}.${p}.fake_sig`;
}

function createAuthContext(): {
  ctx: AuthFlowContext;
  openedUrls: string[];
} {
  const openedUrls: string[] = [];
  const controller = new AbortController();
  return {
    openedUrls,
    ctx: {
      authSessionId: "auth_test_1",
      method: "oauth",
      signal: controller.signal,
      openExternalUrl: async (url) => {
        openedUrls.push(url);
      },
      onProgress: vi.fn()
    }
  };
}

function makeStoredAccount(
  id: string,
  provider: StoredAccountRecord["provider"],
  source: StoredAccountRecord["source"] = "oauth"
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

describe("Phase 1 Subscription Provider Adapters", () => {
  it.each([createGoogleGeminiCliAdapter, createGoogleAntigravityAdapter])(
    "signals the Google callback and distinguishes an expired authorization code",
    async (createAdapter) => {
      const setup = createAuthContext();
      const adapter = createAdapter({
        oauthClient: { clientId: "fixture-client" },
        startLoopback: async ({ state }) => ({
          port: 1234,
          redirectUri: "https://callback.example.test/return",
          waitForCallback: Promise.resolve({
            code: "fixture-code",
            state,
            params: {}
          }),
          close: async () => {}
        }),
        fetcher: async () =>
          Response.json(
            {
              error: "invalid_grant",
              error_description: "private fixture diagnostic"
            },
            { status: 400 }
          )
      });
      const handle = await adapter.startAuth!(setup.ctx);
      await expect(handle.completion).rejects.toMatchObject({
        code: "subscriptions.oauth_code_rejected"
      });
      expect(setup.ctx.onProgress).toHaveBeenCalledWith({
        status: "pending",
        code: "subscriptions.oauth_callback_received"
      });
      expect(
        new URL(handle.verificationUri!).searchParams.get("prompt")?.split(" ")
      ).toContain("select_account");
    }
  );

  it("uses locally configured Google Gemini CLI OAuth client credentials", async () => {
    const { ctx } = createAuthContext();
    const startLoopback: LoopbackStarter = vi.fn(async ({ state }) => ({
      port: 43110,
      redirectUri: "https://callback.example.test/return",
      waitForCallback: Promise.resolve({
        code: "fixture-code",
        state,
        params: {}
      }),
      close: vi.fn(async () => undefined)
    }));
    await expect(
      createGoogleGeminiCliAdapter({ env: {}, startLoopback }).startAuth!(ctx)
    ).rejects.toMatchObject({
      code: "subscriptions.oauth_client_not_configured"
    });
    expect(startLoopback).not.toHaveBeenCalled();

    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      const params = new URLSearchParams(String(init?.body));
      expect(params.get("client_id")).toBe("local-client-id");
      expect(params.get("client_secret")).toBe("local-client-secret");
      return Response.json({ error: "invalid_grant" }, { status: 400 });
    });
    const adapter = createGoogleGeminiCliAdapter({
      env: {
        WRITER_GOOGLE_GEMINI_CLIENT_ID: "local-client-id",
        WRITER_GOOGLE_GEMINI_CLIENT_SECRET: "local-client-secret"
      },
      authBaseUrl: "https://auth.example.test/authorize",
      tokenUrl: "https://token.example.test/exchange",
      startLoopback,
      fetcher
    });
    const handle = await adapter.startAuth!(ctx);
    const url = new URL(handle.verificationUri!);
    expect(url.searchParams.get("client_id")).toBe("local-client-id");
    expect(url.searchParams.has("client_secret")).toBe(false);
    await expect(handle.completion).rejects.toMatchObject({
      code: "subscriptions.oauth_code_rejected"
    });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("ships the approved Antigravity OAuth client, and lets local configuration override it", async () => {
    const { ctx } = createAuthContext();
    const startLoopback: LoopbackStarter = vi.fn(async ({ state }) => ({
      port: 43110,
      redirectUri: "https://callback.example.test/return",
      waitForCallback: Promise.resolve({
        code: "fixture-code",
        state,
        params: {}
      }),
      close: vi.fn(async () => undefined)
    }));
    const sentBodies: URLSearchParams[] = [];
    const runAuth = async (env: NodeJS.ProcessEnv) => {
      const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
        const params = new URLSearchParams(String(init?.body ?? ""));
        if (params.get("grant_type") === "authorization_code") {
          sentBodies.push(params);
        }
        return Response.json({ access_token: "ag-access" }, { status: 200 });
      });
      const adapter = createGoogleAntigravityAdapter({
        env,
        authBaseUrl: "https://auth.example.test/authorize",
        tokenUrl: "https://token.example.test/exchange",
        startLoopback,
        fetcher
      });
      const handle = await adapter.startAuth!(ctx);
      const url = new URL(handle.verificationUri!);
      expect(url.searchParams.has("client_secret")).toBe(false);
      await handle.completion;
      const sent = sentBodies.at(-1)!;
      expect(sent.get("code_verifier")).toBeTruthy();
      return {
        linkClientId: url.searchParams.get("client_id"),
        sentClientId: sent.get("client_id"),
        sentClientSecret: sent.get("client_secret")
      };
    };

    expect(await runAuth({})).toEqual({
      linkClientId: ANTIGRAVITY_OAUTH_CLIENT.clientId,
      sentClientId: ANTIGRAVITY_OAUTH_CLIENT.clientId,
      sentClientSecret: ANTIGRAVITY_OAUTH_CLIENT.clientSecret
    });

    expect(
      await runAuth({
        WRITER_GOOGLE_ANTIGRAVITY_CLIENT_ID: "local-client-id",
        WRITER_GOOGLE_ANTIGRAVITY_CLIENT_SECRET: "local-client-secret"
      })
    ).toEqual({
      linkClientId: "local-client-id",
      sentClientId: "local-client-id",
      sentClientSecret: "local-client-secret"
    });
  });

  it("supports Google Gemini CLI OAuth PKCE, read-only local import, quota check, refresh, and secret-free runtime credentials", async () => {
    const homeDir = await createTempHome();
    const authSetup = createAuthContext();

    const startLoopback: LoopbackStarter = vi.fn(async (opts) => ({
      port: 43111,
      redirectUri: `http://example.test:43111${opts.callbackPath}`,
      waitForCallback: Promise.resolve({
        code: "gemini-code-123",
        state: opts.state,
        callbackPath: opts.callbackPath ?? "/oauth2callback",
        params: { code: "gemini-code-123", state: opts.state }
      }),
      close: vi.fn(async () => undefined)
    }));

    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith("https://token.example.test/token")) {
        const body = new URLSearchParams(String(init?.body ?? ""));
        if (body.get("grant_type") === "refresh_token") {
          return new Response(
            JSON.stringify({
              access_token: "gem-access-refreshed",
              expires_in: 3600
            }),
            { status: 200 }
          );
        }
        return new Response(
          JSON.stringify({
            access_token: "gem-access-1",
            refresh_token: "gem-refresh-1",
            expires_in: 3600
          }),
          { status: 200 }
        );
      }
      if (url.startsWith("https://userinfo.example.test/")) {
        return new Response(
          JSON.stringify({
            email: "gemini@example.test",
            name: "Gemini Author"
          }),
          { status: 200 }
        );
      }
      if (url.includes(":loadCodeAssist")) {
        return new Response(
          JSON.stringify({
            cloudaicompanionProject: "gem-proj-1",
            currentTier: { name: "Gemini Pro" }
          }),
          { status: 200 }
        );
      }
      if (url.includes(":retrieveUserQuota")) {
        return new Response(
          JSON.stringify({
            buckets: [
              {
                modelId: "gemini-2.5-pro",
                remainingFraction: 0,
                resetTime: "2026-11-28T05:00:00.000Z"
              }
            ]
          }),
          { status: 200 }
        );
      }
      return new Response("not found", { status: 404 });
    });

    const adapter = createGoogleGeminiCliAdapter({
      homeDir,
      env: {},
      now: () => 1_700_000_000_000,
      startLoopback,
      fetcher,
      oauthClient: { clientId: "gem-client-id" },
      authBaseUrl: "https://auth.example.test/o/oauth2/v2/auth",
      tokenUrl: "https://token.example.test/token",
      userInfoUrl: "https://userinfo.example.test/userinfo",
      cloudCodeBaseUrl: "https://cloudcode.example.test"
    });

    const handle = await adapter.startAuth!(authSetup.ctx);
    expect(handle.verificationUri).toContain("code_challenge_method=S256");
    expect(authSetup.openedUrls).toEqual([handle.verificationUri]);

    const oauthResult = await handle.completion;
    expect(oauthResult).toMatchObject({
      displayName: "Gemini Author",
      email: "gemini@example.test",
      planTier: "Pro",
      source: "oauth",
      secret: {
        accessToken: "gem-access-1",
        refreshToken: "gem-refresh-1",
        extra: { projectId: "gem-proj-1", oauthClientId: "gem-client-id" }
      }
    });

    const geminiDir = join(homeDir, ".gemini");
    await mkdir(geminiDir, { recursive: true });
    const credsPath = join(geminiDir, "oauth_creds.json");
    const accountsPath = join(geminiDir, "google_accounts.json");
    const originalCreds = JSON.stringify(
      {
        access_token: "",
        refresh_token: "gem-local-refresh",
        client_id: "gem-local-client",
        id_token: makeFakeJwt({
          email: "local@example.test",
          name: "Local CLI User"
        })
      },
      null,
      2
    );
    const originalAccounts = JSON.stringify({ active: "local@example.test" });
    await writeFile(credsPath, originalCreds, "utf8");
    await writeFile(accountsPath, originalAccounts, "utf8");

    const candidates = await adapter.scanLocalCandidates!();
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.sourcePathHint).toContain("oauth_creds.json");

    const imported = await adapter.importLocalCandidate!(
      candidates[0]!.candidateId
    );
    expect(imported.secret.accessToken).toBe("gem-access-refreshed");
    expect(imported.secret.refreshToken).toBe("gem-local-refresh");
    expect(await readFile(credsPath, "utf8")).toBe(originalCreds);
    expect(await readFile(accountsPath, "utf8")).toBe(originalAccounts);

    const acct = makeStoredAccount("acct_gem_1", "google-gemini-cli");
    const refreshed = await adapter.refreshSecret(acct, oauthResult.secret);
    expect(refreshed.accessToken).toBe("gem-access-refreshed");

    const quota = await adapter.fetchQuota(acct, refreshed);
    expect(quota.status).toBe("quota_exhausted");
    expect(quota.cooldownUntil).toBe("2026-11-28T05:00:00.000Z");

    const models = await adapter.listModels(acct, refreshed);
    expect(models.map((model) => model.modelId)).toEqual(["gemini-2.5-pro"]);
    const runtimeCred = adapter.toRuntimeCredential(
      acct,
      refreshed,
      models[0]!
    );
    expect(runtimeCred).toEqual({
      provider: "google-gemini-cli",
      accountId: "acct_gem_1",
      apiKey: "gem-access-refreshed",
      baseUrl: "https://cloudcode.example.test",
      expiresAt: refreshed.expiresAt,
      metadata: { projectId: "gem-proj-1" }
    });
    expect("refreshToken" in runtimeCred).toBe(false);
  });

  it("supports Google Antigravity OAuth, Cockpit-Tools & legacy read-only import, and available models quota", async () => {
    const homeDir = await createTempHome();
    const cockpitDir = join(homeDir, ".antigravity_tools", "accounts");
    const legacyDir = join(homeDir, ".gemini", "antigravity");
    await mkdir(cockpitDir, { recursive: true });
    await mkdir(legacyDir, { recursive: true });

    const indexContent = JSON.stringify([
      {
        id: "ag_cockpit_1",
        email: "ag-one@example.test",
        name: "Cockpit One",
        subscription_tier: "Ultra",
        token: {
          access_token: "ag-access-1",
          refresh_token: "ag-refresh-1",
          project_id: "ag-proj-1",
          client_id: "ag-client-1"
        }
      }
    ]);
    const accountFileContent = JSON.stringify({
      id: "ag_file_2",
      email: "ag-two@example.test",
      access_token: "ag-access-2",
      refresh_token: "ag-refresh-2"
    });
    const legacyContent = JSON.stringify({
      email: "ag-one@example.test",
      access_token: "duplicate-ignored"
    });

    const indexPath = join(homeDir, ".antigravity_tools", "accounts.json");
    const accountFilePath = join(cockpitDir, "extra.json");
    const legacyPath = join(legacyDir, "oauth_creds.json");
    await writeFile(indexPath, indexContent, "utf8");
    await writeFile(accountFilePath, accountFileContent, "utf8");
    await writeFile(legacyPath, legacyContent, "utf8");

    const startLoopback: LoopbackStarter = vi.fn(async (opts) => ({
      port: 43222,
      redirectUri: `http://example.test:43222${opts.callbackPath}`,
      waitForCallback: Promise.resolve({
        code: "ag-code-1",
        state: opts.state,
        params: { code: "ag-code-1", state: opts.state }
      }),
      close: vi.fn(async () => undefined)
    }));

    const fetcher = vi.fn(async (url: string) => {
      if (url.startsWith("https://token.example.test/token")) {
        return new Response(
          JSON.stringify({
            access_token: "ag-oauth-access",
            refresh_token: "ag-oauth-refresh",
            expires_in: 3600
          }),
          { status: 200 }
        );
      }
      if (url.startsWith("https://userinfo.example.test/")) {
        return new Response(
          JSON.stringify({ email: "ag-oauth@example.test" }),
          { status: 200 }
        );
      }
      if (url.includes(":fetchAvailableModels")) {
        return new Response(
          JSON.stringify({
            models: {
              "gemini-3-pro-high": {
                displayName: "Gemini 3 Pro High",
                quotaInfo: {
                  remainingFraction: 0.65,
                  resetTime: "2026-11-28T06:00:00.000Z"
                }
              },
              "claude-sonnet-4-5-thinking": {
                displayName: "Claude Sonnet 4.5 Thinking",
                quotaInfo: { remainingFraction: 0.4 }
              }
            }
          }),
          { status: 200 }
        );
      }
      return new Response("not found", { status: 404 });
    });

    const adapter = createGoogleAntigravityAdapter({
      homeDir,
      env: {},
      startLoopback,
      fetcher,
      oauthClient: { clientId: "ag-client-1" },
      authBaseUrl: "https://auth.example.test/o/oauth2/v2/auth",
      tokenUrl: "https://token.example.test/token",
      userInfoUrl: "https://userinfo.example.test/userinfo",
      endpointUrl: "https://antigravity.example.test"
    });
    expect(adapter.meta.unofficialWarning).toBeTruthy();

    const authSetup = createAuthContext();
    const flow = await adapter.startAuth!(authSetup.ctx);
    const authRes = await flow.completion;
    expect(authRes.email).toBe("ag-oauth@example.test");

    const candidates = await adapter.scanLocalCandidates!();
    // ag-one@example.test is deduped across accounts.json & legacy oauth_creds.json.
    expect(candidates.map((c) => c.candidateId)).toEqual([
      "antigravity:cockpit:ag_cockpit_1",
      "antigravity:file:ag_file_2"
    ]);
    const imported = await adapter.importLocalCandidate!(
      "antigravity:cockpit:ag_cockpit_1"
    );
    expect(imported.planTier).toBe("Ultra");
    expect(await readFile(indexPath, "utf8")).toBe(indexContent);
    expect(await readFile(accountFilePath, "utf8")).toBe(accountFileContent);
    expect(await readFile(legacyPath, "utf8")).toBe(legacyContent);

    const acct = makeStoredAccount("acct_ag_1", "google-antigravity");
    const quota = await adapter.fetchQuota(acct, imported.secret);
    expect(quota.status).toBe("active");
    expect(quota.quotaBuckets).toHaveLength(2);

    const models = await adapter.listModels(acct, imported.secret);
    expect(models.map((m) => m.modelId)).toEqual([
      "gemini-3-pro-high",
      "claude-sonnet-4-5-thinking"
    ]);
    const runtimeCred = adapter.toRuntimeCredential(
      acct,
      imported.secret,
      models[0]!
    );
    expect(runtimeCred).toEqual({
      provider: "google-antigravity",
      accountId: "acct_ag_1",
      apiKey: "ag-access-1",
      baseUrl: "https://antigravity.example.test",
      metadata: {
        projectId: "ag-proj-1",
        endpoint: "https://antigravity.example.test"
      }
    });
    expect("refreshToken" in runtimeCred).toBe(false);
  });

  it("supports OpenAI Codex PKCE on localhost:1455, ~/.codex/auth.json read-only import, refresh, and /wham/usage", async () => {
    const homeDir = await createTempHome();
    const codexDir = join(homeDir, ".codex");
    await mkdir(codexDir, { recursive: true });
    const accessJwt = makeFakeJwt({
      email: "codex-local@example.test",
      "https://api.openai.com/auth": {
        chatgpt_account_id: "acct_local_01",
        chatgpt_plan_type: "plus"
      }
    });
    const authJsonPath = join(codexDir, "auth.json");
    const originalAuthJson = JSON.stringify({
      tokens: {
        access_token: accessJwt,
        refresh_token: "codex-refresh-local"
      }
    });
    await writeFile(authJsonPath, originalAuthJson, "utf8");

    const loopbackOpts: Array<{
      redirectHost?: string;
      preferredPort?: number;
    }> = [];
    const startLoopback: LoopbackStarter = vi.fn(async (opts) => {
      loopbackOpts.push({
        ...(opts.redirectHost ? { redirectHost: opts.redirectHost } : {}),
        ...(opts.preferredPort !== undefined
          ? { preferredPort: opts.preferredPort }
          : {})
      });
      return {
        port: 1455,
        redirectUri: `http://localhost:1455${opts.callbackPath}`,
        waitForCallback: Promise.resolve({
          code: "codex-code-1",
          state: opts.state,
          params: { code: "codex-code-1", state: opts.state }
        }),
        close: vi.fn(async () => undefined)
      };
    });

    const proJwt = makeFakeJwt({
      email: "codex-pro@example.test",
      "https://api.openai.com/auth": {
        chatgpt_account_id: "acct_pro_99",
        chatgpt_plan_type: "pro"
      }
    });

    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/oauth/token")) {
        const body = new URLSearchParams(String(init?.body ?? ""));
        if (body.get("grant_type") === "refresh_token") {
          return new Response(
            JSON.stringify({ access_token: proJwt, expires_in: 3600 }),
            { status: 200 }
          );
        }
        return new Response(
          JSON.stringify({
            access_token: proJwt,
            refresh_token: "codex-refresh-oauth",
            expires_in: 3600
          }),
          { status: 200 }
        );
      }
      if (url.endsWith("/wham/usage")) {
        return new Response(
          JSON.stringify({
            plan_type: "plus",
            rate_limit: {
              limit_reached: true,
              primary_window: {
                used_percent: 100,
                reset_at: 1_800_000_000
              },
              secondary_window: {
                used_percent: 35,
                reset_at: 1_800_500_000
              }
            }
          }),
          { status: 200 }
        );
      }
      return new Response("not found", { status: 404 });
    });

    const adapter = createOpenAICodexAdapter({
      homeDir,
      env: {},
      startLoopback,
      fetcher,
      authBaseUrl: "https://codex-auth.example.test",
      apiBaseUrl: "https://codex-api.example.test/backend-api"
    });

    const authSetup = createAuthContext();
    const authFlow = await adapter.startAuth!(authSetup.ctx);
    const oauthRes = await authFlow.completion;
    expect(loopbackOpts[0]).toEqual({
      redirectHost: "localhost",
      preferredPort: 1455
    });
    expect(oauthRes.planTier).toBe("Pro");
    expect(oauthRes.secret.extra?.chatgptAccountId).toBe("acct_pro_99");

    const candidates = await adapter.scanLocalCandidates!();
    expect(candidates).toHaveLength(1);
    const imported = await adapter.importLocalCandidate!(
      candidates[0]!.candidateId
    );
    expect(imported.planTier).toBe("Plus");
    expect(await readFile(authJsonPath, "utf8")).toBe(originalAuthJson);

    const acct = makeStoredAccount("acct_codex_1", "openai-codex");
    const refreshed = await adapter.refreshSecret(acct, imported.secret);
    expect(refreshed.accessToken).toBe(proJwt);

    const quota = await adapter.fetchQuota(acct, refreshed);
    expect(quota.status).toBe("quota_exhausted");
    expect(quota.planTier).toBe("Plus");
    expect(quota.quotaBuckets).toHaveLength(2);
    expect(quota.quotaBuckets[0]?.remainingPercent).toBe(0);
    expect(quota.cooldownUntil).toBe(
      new Date(1_800_000_000 * 1_000).toISOString()
    );

    const models = await adapter.listModels(acct, refreshed);
    const runtimeCred = adapter.toRuntimeCredential(
      acct,
      refreshed,
      models[0]!
    );
    expect(runtimeCred).toEqual({
      provider: "openai-codex",
      accountId: "acct_codex_1",
      apiKey: proJwt,
      baseUrl: "https://codex-api.example.test/backend-api",
      expiresAt: refreshed.expiresAt,
      extraHeaders: { "chatgpt-account-id": "acct_pro_99" }
    });
    expect("refreshToken" in runtimeCred).toBe(false);
  });

  it("supports GitHub Copilot Device Flow, short-lived token exchange, read-only local import, quota, and models", async () => {
    const homeDir = await createTempHome();
    const copilotConfigDir = join(homeDir, ".config", "github-copilot");
    const localAppData = join(homeDir, "AppData", "Local");
    const localAppCopilotDir = join(localAppData, "github-copilot");
    await mkdir(copilotConfigDir, { recursive: true });
    await mkdir(localAppCopilotDir, { recursive: true });

    const hostsPath = join(copilotConfigDir, "hosts.json");
    const appsPath = join(localAppCopilotDir, "apps.json");
    const originalHosts = JSON.stringify({
      "gh.example.test": {
        user: "local-copilot",
        oauth_token: "gho_fake_local_token_001"
      }
    });
    const originalApps = JSON.stringify({
      "gh.example.test:Iv1.0000": {
        user: "local-copilot-app",
        oauth_token: "gho_fake_local_token_002"
      }
    });
    await writeFile(hostsPath, originalHosts, "utf8");
    await writeFile(appsPath, originalApps, "utf8");

    let pollCount = 0;
    const fetcher = vi.fn(async (url: string) => {
      if (url.endsWith("/login/device/code")) {
        return new Response(
          JSON.stringify({
            device_code: "dev_code_1",
            user_code: "ABCD-1234",
            verification_uri: "https://gh.example.test/login/device",
            interval: 0.005,
            expires_in: 600
          }),
          { status: 200 }
        );
      }
      if (url.endsWith("/login/oauth/access_token")) {
        pollCount += 1;
        if (pollCount === 1) {
          return new Response(
            JSON.stringify({ error: "authorization_pending" }),
            { status: 200 }
          );
        }
        return new Response(
          JSON.stringify({ access_token: "gho_fake_device_oauth" }),
          { status: 200 }
        );
      }
      if (url.endsWith("/copilot_internal/v2/token")) {
        return new Response(
          JSON.stringify({
            token: "tid=fake;proxy-ep=proxy.copilot.example.test;",
            expires_at: Math.floor(Date.now() / 1_000) + 1800
          }),
          { status: 200 }
        );
      }
      if (url.endsWith("/copilot_internal/user")) {
        return new Response(
          JSON.stringify({
            copilot_plan: "individual",
            quota_reset_date: "2026-12-01T00:00:00.000Z",
            quota_snapshots: {
              premium_interactions: {
                entitlement: 300,
                remaining: 240,
                percent_remaining: 80
              },
              chat: {
                unlimited: true
              }
            }
          }),
          { status: 200 }
        );
      }
      if (new URL(url).pathname === "/user") {
        return new Response(
          JSON.stringify({
            login: "copilot-author",
            email: "copilot@example.test"
          }),
          { status: 200 }
        );
      }
      if (url.endsWith("/models")) {
        return new Response(
          JSON.stringify({
            data: [
              { id: "gpt-5.3-codex", model_picker_enabled: true },
              { id: "disabled-model", policy: { state: "disabled" } },
              { id: "hidden-model", model_picker_enabled: false }
            ]
          }),
          { status: 200 }
        );
      }
      return new Response("not found", { status: 404 });
    });

    const adapter = createGitHubCopilotAdapter({
      homeDir,
      env: { LOCALAPPDATA: localAppData },
      fetcher,
      githubDomain: "gh.example.test",
      githubApiBaseUrl: "https://api.gh.example.test"
    });

    const controller = new AbortController();
    const deviceHandle = await adapter.startAuth!({
      authSessionId: "device_1",
      method: "device_flow",
      signal: controller.signal,
      openExternalUrl: vi.fn(async () => undefined),
      onProgress: vi.fn()
    });
    expect(deviceHandle.method).toBe("device_flow");
    expect(deviceHandle.userCode).toBe("ABCD-1234");
    const deviceResult = await deviceHandle.completion;
    expect(pollCount).toBe(2);
    expect(deviceResult.secret.refreshToken).toBe("gho_fake_device_oauth");
    expect(deviceResult.secret.providerToken).toContain("tid=fake;");
    expect(deviceResult.secret.extra?.baseUrl).toBe(
      "https://api.copilot.example.test"
    );

    const candidates = await adapter.scanLocalCandidates!();
    expect(candidates).toHaveLength(2);
    const imported = await adapter.importLocalCandidate!(
      candidates[0]!.candidateId
    );
    expect(imported.secret.refreshToken).toBe("gho_fake_local_token_001");
    expect(await readFile(hostsPath, "utf8")).toBe(originalHosts);
    expect(await readFile(appsPath, "utf8")).toBe(originalApps);
    expect(createHash("sha256").update(originalHosts).digest("hex")).toBe(
      createHash("sha256")
        .update(await readFile(hostsPath, "utf8"))
        .digest("hex")
    );

    const acct = makeStoredAccount(
      "acct_cop_1",
      "github-copilot",
      "device_flow"
    );
    const refreshed: StoredAccountSecret = await adapter.refreshSecret(
      acct,
      imported.secret
    );
    expect(refreshed.accessToken).toBe(refreshed.providerToken);

    const quota = await adapter.fetchQuota(acct, refreshed);
    expect(quota.planTier).toBe("Pro");
    expect(quota.status).toBe("active");
    expect(quota.quotaBuckets).toHaveLength(2);

    const models = await adapter.listModels(acct, refreshed);
    expect(models.map((m) => m.modelId)).toEqual(["gpt-5.3-codex"]);

    const runtimeCred = adapter.toRuntimeCredential(
      acct,
      refreshed,
      models[0]!
    );
    expect(runtimeCred.apiKey).toBe(refreshed.providerToken);
    expect(runtimeCred.baseUrl).toBe("https://api.copilot.example.test");
    expect("refreshToken" in runtimeCred).toBe(false);
  });
});
