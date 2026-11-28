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
import {
  createAnthropicClaudeAdapter,
  createDefaultSubscriptionRegistry,
  createKiroAdapter,
  type LoopbackStarter
} from "./index";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))
  );
});

async function createTempHome(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "writer-sub-phase2-"));
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

describe("Phase 2 Subscription Provider Adapters (Claude & Kiro)", () => {
  it("registers all 9 Phase 1–3 subscription adapters in the default registry", () => {
    const registry = createDefaultSubscriptionRegistry();
    expect(registry.has("anthropic-claude")).toBe(true);
    expect(registry.has("kiro")).toBe(true);
    expect(registry.has("cursor")).toBe(true);
    expect(registry.has("windsurf")).toBe(true);
    expect(registry.has("codebuddy")).toBe(true);
    expect(registry.listAdapters().map((a) => a.id)).toEqual([
      "google-gemini-cli",
      "google-antigravity",
      "openai-codex",
      "github-copilot",
      "anthropic-claude",
      "kiro",
      "cursor",
      "windsurf",
      "codebuddy"
    ]);
  });

  it("supports Anthropic Claude OAuth PKCE, read-only ~/.claude/.credentials.json import, refresh, quota, and secret-free runtime credentials", async () => {
    const homeDir = await createTempHome();
    const claudeDir = join(homeDir, ".claude");
    await mkdir(claudeDir, { recursive: true });
    const credPath = join(claudeDir, ".credentials.json");
    const originalCreds = JSON.stringify(
      {
        claudeAiOauth: {
          accessToken: "sk-ant-oat01-local-placeholder",
          refreshToken: "sk-ant-ort01-local-refresh",
          expiresAt: 1_900_000_000_000,
          subscriptionType: "max_5x",
          rateLimitTier: "default_claude_max_5x"
        }
      },
      null,
      2
    );
    await writeFile(credPath, originalCreds, "utf8");
    const originalHash = createHash("sha256")
      .update(originalCreds)
      .digest("hex");

    const startLoopback: LoopbackStarter = vi.fn(async (opts) => ({
      port: 53692,
      redirectUri: `http://localhost:53692${opts.callbackPath}`,
      waitForCallback: Promise.resolve({
        code: "claude-auth-code-123",
        state: opts.state,
        params: { code: "claude-auth-code-123", state: opts.state }
      }),
      close: vi.fn(async () => undefined)
    }));

    let usageExhausted = false;
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "https://platform.claude.example.test/v1/oauth/token") {
        const body = JSON.parse(String(init?.body ?? "{}")) as Record<
          string,
          unknown
        >;
        if (body.grant_type === "refresh_token") {
          expect(body.refresh_token).toBe("sk-ant-ort01-local-refresh");
          return new Response(
            JSON.stringify({
              access_token: "sk-ant-oat01-refreshed-token",
              refresh_token: "sk-ant-ort01-rotated-refresh",
              expires_in: 3600
            }),
            { status: 200 }
          );
        }
        expect(body.grant_type).toBe("authorization_code");
        expect(body.code).toBe("claude-auth-code-123");
        return new Response(
          JSON.stringify({
            access_token: "sk-ant-oat01-oauth-token",
            refresh_token: "sk-ant-ort01-oauth-refresh",
            expires_in: 7200,
            account: { email_address: "claude-author@example.test" },
            organization: { organization_type: "claude_pro" }
          }),
          { status: 200 }
        );
      }
      if (url === "https://api.claude.example.test/api/oauth/profile") {
        return new Response(
          JSON.stringify({
            account: {
              email: "claude-local@example.test",
              display_name: "Claude Writer"
            },
            organization: {
              organization_type: "claude_max",
              rate_limit_tier: "default_claude_max_5x"
            }
          }),
          { status: 200 }
        );
      }
      if (url === "https://api.claude.example.test/api/oauth/usage") {
        const headers = new Headers(init?.headers);
        expect(headers.get("authorization")).toMatch(/^Bearer /u);
        expect(headers.get("anthropic-beta")).toContain("oauth-2025-04-20");
        return new Response(
          JSON.stringify({
            five_hour: {
              utilization: usageExhausted ? 100 : 28,
              resets_at: "2026-11-28T06:00:00.000Z"
            },
            seven_day: {
              utilization: 45,
              resets_at: "2026-12-03T00:00:00.000Z"
            },
            extra_usage: {
              is_enabled: true,
              used_credits: 12,
              monthly_limit: 50
            }
          }),
          { status: 200 }
        );
      }
      return new Response("not found", { status: 404 });
    });

    const adapter = createAnthropicClaudeAdapter({
      homeDir,
      env: {},
      now: () => 1_700_000_000_000,
      startLoopback,
      fetcher,
      clientId: "claude-test-client",
      authorizeUrl: "https://claude.example.test/oauth/authorize",
      tokenUrl: "https://platform.claude.example.test/v1/oauth/token",
      apiBaseUrl: "https://api.claude.example.test",
      usageUrl: "https://api.claude.example.test/api/oauth/usage",
      profileUrl: "https://api.claude.example.test/api/oauth/profile"
    });

    const openedUrls: string[] = [];
    const authCtx: AuthFlowContext = {
      authSessionId: "claude_auth_1",
      method: "oauth",
      signal: new AbortController().signal,
      openExternalUrl: async (u) => {
        openedUrls.push(u);
      },
      onProgress: vi.fn()
    };

    const handle = await adapter.startAuth!(authCtx);
    expect(handle.method).toBe("oauth");
    expect(handle.verificationUri).toContain("code_challenge_method=S256");
    expect(openedUrls).toEqual([handle.verificationUri]);

    const oauthResult = await handle.completion;
    expect(oauthResult).toMatchObject({
      email: "claude-author@example.test",
      planTier: "Pro",
      source: "oauth",
      secret: {
        accessToken: "sk-ant-oat01-oauth-token",
        refreshToken: "sk-ant-ort01-oauth-refresh"
      }
    });

    // Read-only scan and import of ~/.claude/.credentials.json
    const candidates = await adapter.scanLocalCandidates!();
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      provider: "anthropic-claude",
      sourceLabel: "Claude Code 本地配置",
      sourcePathHint: "~/.claude/.credentials.json"
    });

    const imported = await adapter.importLocalCandidate!(
      candidates[0]!.candidateId
    );
    expect(imported).toMatchObject({
      displayName: "Claude Writer",
      email: "claude-local@example.test",
      planTier: "Max 5x",
      source: "local_import",
      secret: {
        accessToken: "sk-ant-oat01-local-placeholder",
        refreshToken: "sk-ant-ort01-local-refresh"
      }
    });
    // Guarantee local file was never mutated.
    expect(
      createHash("sha256")
        .update(await readFile(credPath, "utf8"))
        .digest("hex")
    ).toBe(originalHash);

    const acct = makeStoredAccount("acct_claude_1", "anthropic-claude");
    const refreshed: StoredAccountSecret = await adapter.refreshSecret(
      acct,
      imported.secret
    );
    expect(refreshed.accessToken).toBe("sk-ant-oat01-refreshed-token");
    expect(refreshed.refreshToken).toBe("sk-ant-ort01-rotated-refresh");

    const activeQuota = await adapter.fetchQuota(acct, refreshed);
    expect(activeQuota.planTier).toBe("Max 5x");
    expect(activeQuota.status).toBe("active");
    expect(activeQuota.quotaBuckets).toEqual([
      {
        id: "claude-5h",
        label: "5 小时限流窗口",
        remainingPercent: 72,
        resetsAt: "2026-11-28T06:00:00.000Z"
      },
      {
        id: "claude-7d",
        label: "7 天限流窗口",
        remainingPercent: 55,
        resetsAt: "2026-12-03T00:00:00.000Z"
      },
      {
        id: "claude-extra",
        label: "额外用量额度",
        remainingPercent: 76,
        used: 12,
        limit: 50,
        unit: "credits"
      }
    ]);

    usageExhausted = true;
    const exhaustedQuota = await adapter.fetchQuota(acct, refreshed);
    expect(exhaustedQuota.status).toBe("quota_exhausted");
    expect(exhaustedQuota.cooldownUntil).toBe("2026-11-28T06:00:00.000Z");

    const models = await adapter.listModels(acct, refreshed);
    expect(models.length).toBeGreaterThanOrEqual(4);
    expect(models[0]).toMatchObject({
      id: "sub:anthropic-claude:claude-opus-5-5",
      api: "anthropic-messages",
      recommended: true
    });

    const runtimeCred = adapter.toRuntimeCredential(
      acct,
      refreshed,
      models[0]!
    );
    expect(runtimeCred).toMatchObject({
      provider: "anthropic-claude",
      accountId: "acct_claude_1",
      apiKey: "sk-ant-oat01-refreshed-token",
      baseUrl: "https://api.claude.example.test",
      extraHeaders: {
        "x-app": "cli"
      }
    });
    expect(runtimeCred.extraHeaders?.["anthropic-beta"]).toBeUndefined();
    expect("refreshToken" in runtimeCred).toBe(false);

    // Regression: utilization: 1 means 1% used (99% remaining), not 100%, and limits[] is parsed.
    const limitsFetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            limits: [
              {
                window_key: "five_hour",
                percent: 1,
                resets_at: "2026-11-28T09:00:00.000Z"
              },
              {
                window_key: "seven_day",
                percent: 12,
                resets_at: "2026-12-05T00:00:00.000Z",
                scope: { model: "sonnet" }
              }
            ]
          }),
          { status: 200 }
        )
    );
    const limitsAdapter = createAnthropicClaudeAdapter({
      homeDir,
      env: {},
      fetcher: limitsFetcher,
      usageUrl: "https://api.claude.example.test/api/oauth/usage"
    });
    const limitsQuota = await limitsAdapter.fetchQuota(acct, refreshed);
    expect(limitsQuota.status).toBe("active");
    expect(limitsQuota.quotaBuckets).toEqual([
      {
        id: "claude-5h",
        label: "5 小时限流窗口",
        remainingPercent: 99,
        resetsAt: "2026-11-28T09:00:00.000Z"
      },
      {
        id: "claude-7d-sonnet",
        label: "7 天 Sonnet 窗口",
        remainingPercent: 88,
        resetsAt: "2026-12-05T00:00:00.000Z"
      }
    ]);
  });

  it("supports Kiro AWS Builder ID Device Flow, Social OAuth PKCE, read-only local SSO import, refresh, quota, and secret-free runtime credentials", async () => {
    const homeDir = await createTempHome();
    const ssoCacheDir = join(homeDir, ".aws", "sso", "cache");
    await mkdir(ssoCacheDir, { recursive: true });

    const clientHash = "abcdef123456";
    const kiroTokenPath = join(ssoCacheDir, "kiro-auth-token.json");
    const clientRegPath = join(ssoCacheDir, `${clientHash}.json`);
    const localTokenContent = JSON.stringify(
      {
        accessToken: makeFakeJwt({ email: "kiro-builder@example.test" }),
        refreshToken: "kiro-local-refresh-1",
        expiresAt: "2026-12-01T00:00:00.000Z",
        authMethod: "IdC",
        region: "us-east-1",
        clientIdHash: clientHash,
        startUrl: "https://view.awsapps.example.test/start"
      },
      null,
      2
    );
    const clientRegContent = JSON.stringify(
      {
        clientId: "oidc-local-client-id",
        clientSecret: "oidc-local-client-secret"
      },
      null,
      2
    );
    await writeFile(kiroTokenPath, localTokenContent, "utf8");
    await writeFile(clientRegPath, clientRegContent, "utf8");
    const originalTokenHash = createHash("sha256")
      .update(localTokenContent)
      .digest("hex");

    const startLoopback: LoopbackStarter = vi.fn(async (opts) => ({
      port: 49153,
      redirectUri: `http://example.test:49153${opts.callbackPath}`,
      waitForCallback: Promise.resolve({
        code: "kiro-social-code",
        state: opts.state,
        params: { code: "kiro-social-code", state: opts.state }
      }),
      close: vi.fn(async () => undefined)
    }));

    let pollCount = 0;
    let quotaExhausted = false;
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "https://oidc.example.test/client/register") {
        return new Response(
          JSON.stringify({
            clientId: "oidc-dyn-client",
            clientSecret: "oidc-dyn-secret"
          }),
          { status: 200 }
        );
      }
      if (url === "https://oidc.example.test/device_authorization") {
        return new Response(
          JSON.stringify({
            deviceCode: "dev-code-1",
            userCode: "KIRO-9876",
            verificationUri: "https://device.aws.example.test",
            verificationUriComplete:
              "https://device.aws.example.test/?user_code=KIRO-9876",
            interval: 0.01,
            expiresIn: 600
          }),
          { status: 200 }
        );
      }
      if (url === "https://oidc.example.test/token") {
        const body = JSON.parse(String(init?.body ?? "{}")) as Record<
          string,
          unknown
        >;
        if (body.grantType === "refresh_token") {
          expect(body.clientId).toBe("oidc-local-client-id");
          expect(body.clientSecret).toBe("oidc-local-client-secret");
          return new Response(
            JSON.stringify({
              accessToken: "kiro-builder-refreshed-access",
              refreshToken: "kiro-builder-rotated-refresh",
              expiresIn: 3600
            }),
            { status: 200 }
          );
        }
        pollCount += 1;
        if (pollCount === 1) {
          return new Response(
            JSON.stringify({ error: "authorization_pending" }),
            { status: 400 }
          );
        }
        return new Response(
          JSON.stringify({
            accessToken: makeFakeJwt({ email: "builder-device@example.test" }),
            refreshToken: "kiro-device-refresh",
            expiresIn: 3600
          }),
          { status: 200 }
        );
      }
      if (url === "https://social.kiro.example.test/oauth/token") {
        return new Response(
          JSON.stringify({
            accessToken: "kiro-social-access",
            refreshToken: "kiro-social-refresh",
            profileArn:
              "arn:aws:codewhisperer:us-east-1:000000000000:profile/social",
            email: "social-user@example.test",
            expiresIn: 3600
          }),
          { status: 200 }
        );
      }
      if (url === "https://social.kiro.example.test/refreshToken") {
        return new Response(
          JSON.stringify({
            accessToken: "kiro-social-refreshed",
            refreshToken: "kiro-social-refresh-2",
            expiresIn: 3600
          }),
          { status: 200 }
        );
      }
      if (url.startsWith("https://cw.example.test/getUsageLimits")) {
        return new Response(
          JSON.stringify({
            subscriptionInfo: {
              subscriptionTitle: "KIRO PRO",
              type: "Q_DEVELOPER_STANDALONE_PRO"
            },
            nextDateReset: 1_767_225_600,
            usageBreakdownList: [
              {
                resourceType: "CREDIT",
                displayNamePlural: "月度额度",
                usageLimitWithPrecision: 1000,
                currentUsageWithPrecision: quotaExhausted ? 1000 : 250,
                freeTrialInfo: quotaExhausted
                  ? { freeTrialStatus: "EXPIRED" }
                  : {
                      freeTrialStatus: "ACTIVE",
                      usageLimitWithPrecision: 500,
                      currentUsageWithPrecision: 100,
                      freeTrialExpiry: 1_767_000_000
                    }
              }
            ]
          }),
          { status: 200 }
        );
      }
      return new Response("not found", { status: 404 });
    });

    const adapter = createKiroAdapter({
      homeDir,
      env: {},
      now: () => 1_700_000_000_000,
      startLoopback,
      fetcher,
      oidcBaseUrl: "https://oidc.example.test",
      socialAuthBaseUrl: "https://social.kiro.example.test",
      codeWhispererBaseUrl: "https://cw.example.test",
      builderIdStartUrl: "https://view.awsapps.example.test/start"
    });

    // 1. AWS Builder ID Device Flow
    const deviceHandle = await adapter.startAuth!({
      authSessionId: "kiro_device_1",
      method: "device_flow",
      signal: new AbortController().signal,
      openExternalUrl: vi.fn(async () => undefined),
      onProgress: vi.fn()
    });
    expect(deviceHandle.method).toBe("device_flow");
    expect(deviceHandle.userCode).toBe("KIRO-9876");
    expect(deviceHandle.verificationUri).toContain("KIRO-9876");
    const deviceResult = await deviceHandle.completion;
    expect(pollCount).toBe(2);
    expect(deviceResult).toMatchObject({
      email: "builder-device@example.test",
      source: "device_flow",
      secret: {
        refreshToken: "kiro-device-refresh",
        extra: {
          authMethod: "builder_id",
          clientId: "oidc-dyn-client",
          clientSecret: "oidc-dyn-secret"
        }
      }
    });

    // 2. Social OAuth PKCE & Social refresh
    const socialUrls: string[] = [];
    const socialHandle = await adapter.startAuth!({
      authSessionId: "kiro_social_1",
      method: "oauth",
      signal: new AbortController().signal,
      openExternalUrl: async (u) => {
        socialUrls.push(u);
      },
      onProgress: vi.fn()
    });
    expect(socialUrls[0]).toContain("code_challenge_method=S256");
    const socialResult = await socialHandle.completion;
    expect(socialResult).toMatchObject({
      email: "social-user@example.test",
      source: "oauth",
      secret: {
        accessToken: "kiro-social-access",
        extra: {
          authMethod: "social",
          profileArn:
            "arn:aws:codewhisperer:us-east-1:000000000000:profile/social"
        }
      }
    });
    const socialAcct = makeStoredAccount("acct_kiro_social", "kiro", "oauth");
    const refreshedSocial = await adapter.refreshSecret(
      socialAcct,
      socialResult.secret
    );
    expect(refreshedSocial.accessToken).toBe("kiro-social-refreshed");

    // 3. Read-only local scan & import + Builder ID refresh
    const candidates = await adapter.scanLocalCandidates!();
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      provider: "kiro",
      email: "kiro-builder@example.test",
      sourcePathHint: "~/.aws/sso/cache/kiro-auth-token.json"
    });
    const imported = await adapter.importLocalCandidate!(
      candidates[0]!.candidateId
    );
    expect(imported.secret.extra).toMatchObject({
      authMethod: "builder_id",
      clientId: "oidc-local-client-id",
      clientSecret: "oidc-local-client-secret"
    });
    expect(
      createHash("sha256")
        .update(await readFile(kiroTokenPath, "utf8"))
        .digest("hex")
    ).toBe(originalTokenHash);

    const builderAcct = makeStoredAccount(
      "acct_kiro_builder",
      "kiro",
      "local_import"
    );
    const refreshedBuilder = await adapter.refreshSecret(
      builderAcct,
      imported.secret
    );
    expect(refreshedBuilder.accessToken).toBe("kiro-builder-refreshed-access");
    expect(refreshedBuilder.refreshToken).toBe("kiro-builder-rotated-refresh");

    // 4. Quota & reset time parsing
    const activeQuota = await adapter.fetchQuota(builderAcct, refreshedBuilder);
    expect(activeQuota.planTier).toBe("Pro");
    expect(activeQuota.status).toBe("active");
    expect(activeQuota.quotaBuckets).toHaveLength(2);
    expect(activeQuota.quotaBuckets[0]).toMatchObject({
      id: "kiro-credit",
      label: "月度额度",
      remainingPercent: 75,
      used: 250,
      limit: 1000,
      unit: "credits"
    });
    expect(activeQuota.quotaBuckets[1]).toMatchObject({
      id: "kiro-trial-0",
      label: "赠送体验额度",
      remainingPercent: 80,
      used: 100,
      limit: 500
    });

    quotaExhausted = true;
    const exhaustedQuota = await adapter.fetchQuota(
      builderAcct,
      refreshedBuilder
    );
    expect(exhaustedQuota.status).toBe("quota_exhausted");
    expect(exhaustedQuota.cooldownUntil).toBe(
      new Date(1_767_225_600 * 1_000).toISOString()
    );

    // 5. Models & secret-free runtime credential
    const models = await adapter.listModels(socialAcct, refreshedSocial);
    expect(models[0]).toMatchObject({
      id: "sub:kiro:claude-sonnet-5.5",
      api: "kiro-codewhisperer",
      recommended: true
    });
    const runtimeCred = adapter.toRuntimeCredential(
      socialAcct,
      refreshedSocial,
      models[0]!
    );
    expect(runtimeCred).toMatchObject({
      provider: "kiro",
      accountId: "acct_kiro_social",
      apiKey: "kiro-social-refreshed",
      baseUrl: "https://cw.example.test",
      metadata: {
        region: "us-east-1",
        endpoint: "https://cw.example.test",
        profileArn:
          "arn:aws:codewhisperer:us-east-1:000000000000:profile/social"
      }
    });
    expect("refreshToken" in runtimeCred).toBe(false);
    expect("clientSecret" in runtimeCred).toBe(false);
    expect("clientSecret" in (runtimeCred.metadata ?? {})).toBe(false);
  });
});
