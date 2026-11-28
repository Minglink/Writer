import { readdir } from "node:fs/promises";
import type { SubscriptionQuotaBucket } from "@writer/contracts";
import { generateOAuthState, generatePkcePair } from "../oauth-loopback";
import { DEFAULT_SUBSCRIPTION_PROVIDER_METADATA } from "../registry";
import {
  SubscriptionError,
  type AuthFlowContext,
  type AuthFlowHandle,
  type ImportedAccountResult,
  type LocalCredentialCandidate,
  type QuotaFetchResult,
  type StoredAccountRecord,
  type StoredAccountSecret,
  type SubscriptionModelDefinition,
  type SubscriptionProviderAdapter
} from "../types";
import {
  decodeJwtPayload,
  isRecord,
  maskPathHint,
  nonEmptyString,
  readJsonFileReadOnly,
  resolveAdapterContext,
  resolveHomeSubpath,
  sleepWithAbort,
  throwHttpSubscriptionError,
  toIsoExpiry,
  type ProviderEnvironmentOptions
} from "./shared";

const KIRO_DEFAULT_REGION = "us-east-1";
const KIRO_BUILDER_ID_START_URL = "https://view.awsapps.com/start";
const KIRO_OIDC_SCOPES = [
  "codewhisperer:completions",
  "codewhisperer:analysis",
  "codewhisperer:conversations"
];
const KIRO_SOCIAL_AUTH_BASE_URL =
  "https://prod.us-east-1.auth.desktop.kiro.dev";
const KIRO_SOCIAL_SIGNIN_URL = "https://app.kiro.dev/signin";
const KIRO_SOCIAL_OAUTH_PORTS = [
  3128, 4649, 6588, 8008, 9091, 49153, 50153, 51153, 52153, 53153
] as const;

function defaultOidcBaseUrl(region: string): string {
  return `https://oidc.${region}.amazonaws.com`;
}

function defaultCodeWhispererBaseUrl(region: string): string {
  return `https://q.${region}.amazonaws.com`;
}

function resolveRegionFromProfileArn(
  profileArn: string | undefined
): string | undefined {
  if (!profileArn) return undefined;
  const match = /^arn:aws[^:]*:[^:]*:([a-z0-9-]+):/iu.exec(profileArn.trim());
  return match?.[1];
}

export interface KiroAdapterOptions extends ProviderEnvironmentOptions {
  region?: string;
  oidcBaseUrl?: string;
  socialAuthBaseUrl?: string;
  socialSigninUrl?: string;
  codeWhispererBaseUrl?: string;
  builderIdStartUrl?: string;
  preferredPort?: number;
}

export const KIRO_BASELINE_MODELS: readonly SubscriptionModelDefinition[] = [
  {
    id: "sub:kiro:claude-sonnet-5.5",
    provider: "kiro",
    modelId: "claude-sonnet-5.5",
    label: "Claude Sonnet 5.5 (Kiro)",
    description: "Kiro (AWS) 订阅主力 Claude Sonnet 5.5 模型",
    api: "kiro-codewhisperer",
    baseUrl: defaultCodeWhispererBaseUrl(KIRO_DEFAULT_REGION),
    reasoning: true,
    defaultThinkingLevel: "medium",
    thinkingLevelOptions: ["low", "medium", "high"],
    contextWindow: 1_000_000,
    maxTokens: 128_000,
    recommended: true
  },
  {
    id: "sub:kiro:claude-opus-5.5",
    provider: "kiro",
    modelId: "claude-opus-5.5",
    label: "Claude Opus 5.5 (Kiro)",
    api: "kiro-codewhisperer",
    baseUrl: defaultCodeWhispererBaseUrl(KIRO_DEFAULT_REGION),
    reasoning: true,
    defaultThinkingLevel: "high",
    thinkingLevelOptions: ["low", "medium", "high"],
    contextWindow: 1_000_000,
    maxTokens: 128_000,
    recommended: false
  },
  {
    id: "sub:kiro:claude-fable-5.2",
    provider: "kiro",
    modelId: "claude-fable-5.2",
    label: "Claude Fable 5.2 (Kiro)",
    api: "kiro-codewhisperer",
    baseUrl: defaultCodeWhispererBaseUrl(KIRO_DEFAULT_REGION),
    reasoning: true,
    defaultThinkingLevel: "high",
    thinkingLevelOptions: ["low", "medium", "high"],
    contextWindow: 1_000_000,
    maxTokens: 128_000,
    recommended: false
  },
  {
    id: "sub:kiro:claude-haiku-5.5",
    provider: "kiro",
    modelId: "claude-haiku-5.5",
    label: "Claude Haiku 5.5 (Kiro)",
    api: "kiro-codewhisperer",
    baseUrl: defaultCodeWhispererBaseUrl(KIRO_DEFAULT_REGION),
    reasoning: true,
    defaultThinkingLevel: "low",
    thinkingLevelOptions: ["low", "medium", "high"],
    contextWindow: 1_000_000,
    maxTokens: 128_000,
    recommended: false
  },
  {
    id: "sub:kiro:gpt-6.2-astra",
    provider: "kiro",
    modelId: "gpt-6.2-astra",
    label: "GPT-6.2 Astra · Enterprise Preview (Kiro)",
    api: "kiro-codewhisperer",
    baseUrl: defaultCodeWhispererBaseUrl(KIRO_DEFAULT_REGION),
    reasoning: true,
    defaultThinkingLevel: "high",
    thinkingLevelOptions: ["low", "medium", "high"],
    contextWindow: 1_000_000,
    recommended: false
  },
  {
    id: "sub:kiro:grok-4.7",
    provider: "kiro",
    modelId: "grok-4.7",
    label: "Grok 4.7 (Kiro)",
    api: "kiro-codewhisperer",
    baseUrl: defaultCodeWhispererBaseUrl(KIRO_DEFAULT_REGION),
    reasoning: true,
    defaultThinkingLevel: "high",
    thinkingLevelOptions: ["low", "medium", "high"],
    contextWindow: 500_000,
    recommended: false
  },
  {
    id: "sub:kiro:kimi-k3",
    provider: "kiro",
    modelId: "kimi-k3",
    label: "Kimi K3 (Kiro)",
    api: "kiro-codewhisperer",
    baseUrl: defaultCodeWhispererBaseUrl(KIRO_DEFAULT_REGION),
    reasoning: true,
    defaultThinkingLevel: "high",
    thinkingLevelOptions: ["low", "medium", "high"],
    contextWindow: 1_000_000,
    recommended: false
  }
];

interface DiscoveredKiroCandidate {
  candidateId: string;
  displayName: string;
  email?: string;
  sourceLabel: string;
  sourcePathHint: string;
  authMethod: "builder_id" | "social";
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string;
  region: string;
  profileArn?: string;
  clientId?: string;
  clientSecret?: string;
  startUrl?: string;
}

function formatKiroPlanTier(
  title: string | undefined,
  rawType?: string
): string | undefined {
  const combined = `${title ?? ""} ${rawType ?? ""}`.trim();
  if (!combined) return undefined;
  const lower = combined.toLowerCase();
  if (lower.includes("power")) return "Power";
  if (lower.includes("pro+") || lower.includes("pro_plus")) return "Pro+";
  if (lower.includes("pro")) return "Pro";
  if (lower.includes("free")) return "Free";
  return nonEmptyString(title) ?? nonEmptyString(rawType);
}

function extractEmailFromTokens(
  accessToken: string | undefined,
  profileArn?: string
): string | undefined {
  const payload = decodeJwtPayload(accessToken);
  const jwtEmail =
    nonEmptyString(payload?.email) ??
    nonEmptyString(payload?.preferred_username);
  if (jwtEmail) return jwtEmail;
  if (profileArn && profileArn.includes("@")) {
    return profileArn;
  }
  return undefined;
}

function parseKiroUsageBuckets(
  data: Record<string, unknown>,
  nowMs: number
): {
  buckets: SubscriptionQuotaBucket[];
  resetsAt?: string;
  exhausted: boolean;
} {
  const resetsAt = toIsoExpiry(
    data.nextDateReset ?? data.next_date_reset,
    nowMs
  );
  const breakdowns = Array.isArray(data.usageBreakdownList)
    ? data.usageBreakdownList
    : [];
  const buckets: SubscriptionQuotaBucket[] = [];

  for (let i = 0; i < breakdowns.length; i += 1) {
    const item = breakdowns[i];
    if (!isRecord(item)) continue;
    const baseName =
      nonEmptyString(item.displayNamePlural) ??
      nonEmptyString(item.displayName) ??
      nonEmptyString(item.resourceType) ??
      `额度 ${i + 1}`;
    const limit =
      typeof item.usageLimitWithPrecision === "number" &&
      Number.isFinite(item.usageLimitWithPrecision)
        ? item.usageLimitWithPrecision
        : typeof item.usageLimit === "number" &&
            Number.isFinite(item.usageLimit)
          ? item.usageLimit
          : undefined;
    const used =
      typeof item.currentUsageWithPrecision === "number" &&
      Number.isFinite(item.currentUsageWithPrecision)
        ? Math.max(0, item.currentUsageWithPrecision)
        : typeof item.currentUsage === "number" &&
            Number.isFinite(item.currentUsage)
          ? Math.max(0, item.currentUsage)
          : undefined;
    const itemReset =
      toIsoExpiry(item.nextDateReset ?? item.resetDate, nowMs) ?? resetsAt;
    if (limit !== undefined && limit > 0 && used !== undefined) {
      const remaining = Math.max(0, limit - used);
      const remainingPercent = Math.min(
        100,
        Math.max(0, (remaining / limit) * 100)
      );
      buckets.push({
        id: `kiro-${(nonEmptyString(item.resourceType) ?? `base-${i}`).toLowerCase()}`,
        label: baseName,
        remainingPercent,
        used: Number(used.toFixed(2)),
        limit: Number(limit.toFixed(2)),
        unit: "credits",
        ...(itemReset ? { resetsAt: itemReset } : {})
      });
    }

    const freeTrial = isRecord(item.freeTrialInfo)
      ? item.freeTrialInfo
      : undefined;
    if (
      freeTrial &&
      nonEmptyString(freeTrial.freeTrialStatus)?.toUpperCase() === "ACTIVE"
    ) {
      const trialLimit =
        typeof freeTrial.usageLimitWithPrecision === "number"
          ? freeTrial.usageLimitWithPrecision
          : typeof freeTrial.usageLimit === "number"
            ? freeTrial.usageLimit
            : undefined;
      const trialUsed =
        typeof freeTrial.currentUsageWithPrecision === "number"
          ? Math.max(0, freeTrial.currentUsageWithPrecision)
          : typeof freeTrial.currentUsage === "number"
            ? Math.max(0, freeTrial.currentUsage)
            : undefined;
      const trialExpiry = toIsoExpiry(freeTrial.freeTrialExpiry, nowMs);
      if (
        trialLimit !== undefined &&
        trialLimit > 0 &&
        trialUsed !== undefined
      ) {
        const remaining = Math.max(0, trialLimit - trialUsed);
        buckets.push({
          id: `kiro-trial-${i}`,
          label: "赠送体验额度",
          remainingPercent: Math.min(
            100,
            Math.max(0, (remaining / trialLimit) * 100)
          ),
          used: Number(trialUsed.toFixed(2)),
          limit: Number(trialLimit.toFixed(2)),
          unit: "credits",
          ...(trialExpiry ? { resetsAt: trialExpiry } : {})
        });
      }
    }
  }

  const exhausted =
    buckets.length > 0 &&
    buckets.every(
      (b) => b.remainingPercent !== undefined && b.remainingPercent <= 0
    );
  return {
    buckets,
    ...(resetsAt ? { resetsAt } : {}),
    exhausted
  };
}

export function createKiroAdapter(
  options: KiroAdapterOptions = {}
): SubscriptionProviderAdapter {
  const ctx = resolveAdapterContext(options);
  const defaultRegion = options.region ?? KIRO_DEFAULT_REGION;
  const builderIdStartUrl =
    options.builderIdStartUrl ?? KIRO_BUILDER_ID_START_URL;
  const socialAuthBaseUrl = (
    options.socialAuthBaseUrl ?? KIRO_SOCIAL_AUTH_BASE_URL
  ).replace(/\/+$/u, "");
  const socialSigninUrl = options.socialSigninUrl ?? KIRO_SOCIAL_SIGNIN_URL;
  const socialPreferredPorts = options.preferredPort
    ? [
        options.preferredPort,
        ...KIRO_SOCIAL_OAUTH_PORTS.filter((p) => p !== options.preferredPort)
      ]
    : [...KIRO_SOCIAL_OAUTH_PORTS];
  const meta = DEFAULT_SUBSCRIPTION_PROVIDER_METADATA.kiro;

  const resolveOidcBase = (region: string) =>
    (options.oidcBaseUrl ?? defaultOidcBaseUrl(region)).replace(/\/+$/u, "");

  const resolveCodeWhispererBase = (region: string) =>
    (
      options.codeWhispererBaseUrl ?? defaultCodeWhispererBaseUrl(region)
    ).replace(/\/+$/u, "");

  const readClientRegistrationByHash = async (
    ssoCacheDir: string,
    clientIdHash: string | undefined
  ): Promise<{ clientId?: string; clientSecret?: string }> => {
    if (!clientIdHash) return {};
    const direct = await readJsonFileReadOnly(
      resolveHomeSubpath(ssoCacheDir, `${clientIdHash}.json`)
    );
    if (isRecord(direct)) {
      const clientId = nonEmptyString(direct.clientId);
      const clientSecret = nonEmptyString(direct.clientSecret);
      if (clientId && clientSecret) return { clientId, clientSecret };
    }
    try {
      const entries = await readdir(ssoCacheDir);
      for (const name of entries) {
        if (!name.endsWith(".json") || name === "kiro-auth-token.json") {
          continue;
        }
        const raw = await readJsonFileReadOnly(
          resolveHomeSubpath(ssoCacheDir, name)
        );
        if (!isRecord(raw)) continue;
        const clientId = nonEmptyString(raw.clientId);
        const clientSecret = nonEmptyString(raw.clientSecret);
        if (clientId && clientSecret) {
          return { clientId, clientSecret };
        }
      }
    } catch {
      // Cache directory unreadable or absent.
    }
    return {};
  };

  const scanKiroLocalFiles = async (): Promise<DiscoveredKiroCandidate[]> => {
    const ssoCacheDir =
      nonEmptyString(ctx.env.AWS_SSO_CACHE_DIR) ??
      resolveHomeSubpath(ctx.homeDir, ".aws", "sso", "cache");
    const candidateFiles: Array<{ path: string; sourceLabel: string }> = [
      {
        path: resolveHomeSubpath(ssoCacheDir, "kiro-auth-token.json"),
        sourceLabel: "Kiro AWS SSO 本地凭证"
      },
      {
        path: resolveHomeSubpath(ctx.homeDir, ".kiro", "auth.json"),
        sourceLabel: "Kiro 本地配置"
      }
    ];
    if (ctx.env.KIRO_AUTH_DIR) {
      candidateFiles.unshift({
        path: resolveHomeSubpath(ctx.env.KIRO_AUTH_DIR, "kiro-auth-token.json"),
        sourceLabel: "Kiro 自定义目录凭证"
      });
    }
    if (ctx.env.APPDATA) {
      candidateFiles.push({
        path: resolveHomeSubpath(
          ctx.env.APPDATA,
          "Kiro",
          "User",
          "globalStorage",
          "kiro-auth-token.json"
        ),
        sourceLabel: "Kiro IDE 本地凭证"
      });
    }

    const found: DiscoveredKiroCandidate[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < candidateFiles.length; i += 1) {
      const entry = candidateFiles[i]!;
      const raw = await readJsonFileReadOnly(entry.path);
      if (!isRecord(raw)) continue;
      const accessToken =
        nonEmptyString(raw.accessToken) ?? nonEmptyString(raw.access_token);
      const refreshToken =
        nonEmptyString(raw.refreshToken) ?? nonEmptyString(raw.refresh_token);
      if (!accessToken && !refreshToken) continue;

      const region = nonEmptyString(raw.region) ?? defaultRegion;
      const rawAuthMethod = (
        nonEmptyString(raw.authMethod) ?? ""
      ).toLowerCase();
      const clientIdHash = nonEmptyString(raw.clientIdHash);
      const inlineClientId = nonEmptyString(raw.clientId);
      const inlineClientSecret = nonEmptyString(raw.clientSecret);
      const clientReg =
        inlineClientId && inlineClientSecret
          ? { clientId: inlineClientId, clientSecret: inlineClientSecret }
          : await readClientRegistrationByHash(ssoCacheDir, clientIdHash);
      const isBuilderId =
        rawAuthMethod === "idc" ||
        rawAuthMethod === "builder_id" ||
        rawAuthMethod === "builderid" ||
        Boolean(clientReg.clientId);
      const profileArn = nonEmptyString(raw.profileArn);
      const startUrl = nonEmptyString(raw.startUrl);
      const email =
        nonEmptyString(raw.email) ??
        extractEmailFromTokens(accessToken, profileArn);
      const displayName =
        nonEmptyString(raw.displayName) ??
        email ??
        (isBuilderId ? "AWS Builder ID (Kiro)" : "Kiro 账号");
      const dedupeKey = `${isBuilderId ? "idc" : "social"}:${email ?? displayName}:${(refreshToken ?? accessToken ?? "").slice(-6)}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      const expiresAt = toIsoExpiry(raw.expiresAt ?? raw.expires_at, ctx.now());
      found.push({
        candidateId: `kiro:local:${i}:${isBuilderId ? "builder" : "social"}`,
        displayName,
        ...(email ? { email } : {}),
        sourceLabel: entry.sourceLabel,
        sourcePathHint: maskPathHint(entry.path, ctx.homeDir),
        authMethod: isBuilderId ? "builder_id" : "social",
        accessToken: accessToken ?? "pending-refresh",
        ...(refreshToken ? { refreshToken } : {}),
        ...(expiresAt ? { expiresAt } : {}),
        region,
        ...(profileArn ? { profileArn } : {}),
        ...(clientReg.clientId ? { clientId: clientReg.clientId } : {}),
        ...(clientReg.clientSecret
          ? { clientSecret: clientReg.clientSecret }
          : {}),
        ...(startUrl ? { startUrl } : {})
      });
    }
    return found;
  };

  return {
    id: "kiro",
    meta,

    async startAuth(authCtx: AuthFlowContext): Promise<AuthFlowHandle> {
      if (authCtx.method === "oauth") {
        const pkce = generatePkcePair();
        const state = generateOAuthState();
        const loopback = await ctx.startLoopback({
          state,
          callbackPath: "/oauth/callback",
          callbackPaths: ["/oauth/callback", "/signin/callback"],
          preferredPorts: socialPreferredPorts,
          redirectHost: "localhost",
          allowDynamicFallback: false,
          signal: authCtx.signal
        });

        const baseRedirectOrigin = `http://localhost:${loopback.port}`;
        const authUrl = new URL(socialSigninUrl);
        authUrl.searchParams.set("state", state);
        authUrl.searchParams.set("code_challenge", pkce.codeChallenge);
        authUrl.searchParams.set(
          "code_challenge_method",
          pkce.codeChallengeMethod
        );
        authUrl.searchParams.set("redirect_uri", baseRedirectOrigin);
        authUrl.searchParams.set("redirect_from", "KiroIDE");

        const verificationUri = authUrl.toString();
        await authCtx.openExternalUrl(verificationUri);

        const completion = (async (): Promise<ImportedAccountResult> => {
          const callback = await loopback.waitForCallback;
          const callbackPath = callback.callbackPath || "/oauth/callback";
          const loginOption = nonEmptyString(callback.params.login_option);
          const exchangeRedirectUri = loginOption
            ? `${baseRedirectOrigin}${callbackPath}?login_option=${encodeURIComponent(loginOption)}`
            : `${baseRedirectOrigin}${callbackPath}`;
          const tokenResp = await ctx.fetcher(
            `${socialAuthBaseUrl}/oauth/token`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Accept: "application/json"
              },
              body: JSON.stringify({
                code: callback.code,
                code_verifier: pkce.codeVerifier,
                redirect_uri: exchangeRedirectUri
              }),
              signal: authCtx.signal
            }
          );
          if (!tokenResp.ok) {
            throwHttpSubscriptionError(tokenResp.status, "Kiro");
          }
          const data = (await tokenResp.json()) as unknown;
          if (!isRecord(data) || !nonEmptyString(data.accessToken)) {
            throw new SubscriptionError(
              "subscriptions.oauth_exchange_failed",
              "Kiro Social OAuth 未返回有效的访问令牌。"
            );
          }
          const accessToken = data.accessToken as string;
          const refreshToken = nonEmptyString(data.refreshToken);
          const profileArn = nonEmptyString(data.profileArn);
          const expiresAt = toIsoExpiry(
            data.expiresIn ?? data.expiresAt,
            ctx.now()
          );
          const email =
            nonEmptyString(data.email) ??
            extractEmailFromTokens(accessToken, profileArn);
          return {
            displayName: email ?? "Kiro 账号",
            ...(email ? { email } : {}),
            source: "oauth",
            secret: {
              accessToken,
              ...(refreshToken ? { refreshToken } : {}),
              ...(expiresAt ? { expiresAt } : {}),
              extra: {
                authMethod: "social",
                region: defaultRegion,
                ...(profileArn ? { profileArn } : {})
              }
            }
          };
        })();

        return {
          method: "oauth",
          verificationUri,
          completion,
          cancel: () => loopback.close()
        };
      }

      // Default interactive auth: AWS Builder ID Device Flow.
      const oidcBase = resolveOidcBase(defaultRegion);
      const registerResp = await ctx.fetcher(`${oidcBase}/client/register`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        body: JSON.stringify({
          clientName: "Writer",
          clientType: "public",
          scopes: KIRO_OIDC_SCOPES,
          grantTypes: [
            "urn:ietf:params:oauth:grant-type:device_code",
            "refresh_token"
          ]
        }),
        signal: authCtx.signal
      });
      if (!registerResp.ok) {
        throwHttpSubscriptionError(
          registerResp.status,
          "Kiro (AWS Builder ID)"
        );
      }
      const regData = (await registerResp.json()) as unknown;
      if (
        !isRecord(regData) ||
        !nonEmptyString(regData.clientId) ||
        !nonEmptyString(regData.clientSecret)
      ) {
        throw new SubscriptionError(
          "subscriptions.device_flow_failed",
          "AWS Builder ID 客户端注册响应无效。"
        );
      }
      const clientId = regData.clientId as string;
      const clientSecret = regData.clientSecret as string;

      const deviceResp = await ctx.fetcher(`${oidcBase}/device_authorization`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        body: JSON.stringify({
          clientId,
          clientSecret,
          startUrl: builderIdStartUrl
        }),
        signal: authCtx.signal
      });
      if (!deviceResp.ok) {
        throwHttpSubscriptionError(deviceResp.status, "Kiro (AWS Builder ID)");
      }
      const deviceData = (await deviceResp.json()) as unknown;
      if (
        !isRecord(deviceData) ||
        !nonEmptyString(deviceData.deviceCode) ||
        !nonEmptyString(deviceData.userCode) ||
        !(
          nonEmptyString(deviceData.verificationUriComplete) ||
          nonEmptyString(deviceData.verificationUri)
        )
      ) {
        throw new SubscriptionError(
          "subscriptions.device_flow_failed",
          "AWS Builder ID 设备授权响应无效。"
        );
      }

      const deviceCode = deviceData.deviceCode as string;
      const userCode = deviceData.userCode as string;
      const verificationUri =
        nonEmptyString(deviceData.verificationUriComplete) ??
        (deviceData.verificationUri as string);
      let intervalSec =
        typeof deviceData.interval === "number" && deviceData.interval > 0
          ? deviceData.interval
          : 5;
      const expiresIn =
        typeof deviceData.expiresIn === "number" && deviceData.expiresIn > 0
          ? deviceData.expiresIn
          : 600;
      const deadlineMs = ctx.now() + expiresIn * 1_000;
      const expiresAt = new Date(deadlineMs).toISOString();

      let cancelled = false;
      const completion = (async (): Promise<ImportedAccountResult> => {
        let accessToken = "";
        let refreshToken: string | undefined;
        let tokenExpiresAt: string | undefined;

        while (
          !cancelled &&
          !authCtx.signal.aborted &&
          ctx.now() < deadlineMs
        ) {
          await sleepWithAbort(intervalSec * 1_000, authCtx.signal);
          const pollResp = await ctx.fetcher(`${oidcBase}/token`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json"
            },
            body: JSON.stringify({
              clientId,
              clientSecret,
              grantType: "urn:ietf:params:oauth:grant-type:device_code",
              deviceCode
            }),
            signal: authCtx.signal
          });
          const pollData = (await pollResp
            .json()
            .catch(() => undefined)) as unknown;
          if (pollResp.ok && isRecord(pollData)) {
            const token = nonEmptyString(pollData.accessToken);
            if (token) {
              accessToken = token;
              refreshToken = nonEmptyString(pollData.refreshToken);
              tokenExpiresAt = toIsoExpiry(pollData.expiresIn, ctx.now());
              break;
            }
          }
          const errCode = isRecord(pollData)
            ? (
                nonEmptyString(pollData.error) ??
                nonEmptyString(pollData.errorCode) ??
                ""
              ).toLowerCase()
            : "";
          if (errCode === "authorization_pending") {
            continue;
          }
          if (errCode === "slow_down") {
            intervalSec += 5;
            continue;
          }
          if (errCode === "expired_token") {
            throw new SubscriptionError(
              "subscriptions.auth_timeout",
              "AWS Builder ID 设备码已过期，请重新获取。"
            );
          }
          if (errCode === "access_denied") {
            throw new SubscriptionError(
              "subscriptions.auth_denied",
              "AWS Builder ID 授权被拒绝，请重新发起。"
            );
          }
          if (!pollResp.ok) {
            throwHttpSubscriptionError(
              pollResp.status,
              "Kiro (AWS Builder ID)"
            );
          }
        }

        if (!accessToken) {
          throw new SubscriptionError(
            "subscriptions.auth_timeout",
            "AWS Builder ID 设备授权超时，请重新发起。"
          );
        }

        const email = extractEmailFromTokens(accessToken);
        return {
          displayName: email ?? "AWS Builder ID (Kiro)",
          ...(email ? { email } : {}),
          source: "device_flow",
          secret: {
            accessToken,
            ...(refreshToken ? { refreshToken } : {}),
            ...(tokenExpiresAt ? { expiresAt: tokenExpiresAt } : {}),
            extra: {
              authMethod: "builder_id",
              region: defaultRegion,
              clientId,
              clientSecret,
              startUrl: builderIdStartUrl
            }
          }
        };
      })();

      return {
        method: "device_flow",
        verificationUri,
        userCode,
        expiresAt,
        completion,
        cancel: () => {
          cancelled = true;
        }
      };
    },

    async scanLocalCandidates(): Promise<LocalCredentialCandidate[]> {
      const candidates = await scanKiroLocalFiles();
      return candidates.map((item) => ({
        candidateId: item.candidateId,
        provider: "kiro",
        displayName: item.displayName,
        ...(item.email ? { email: item.email } : {}),
        sourceLabel: item.sourceLabel,
        sourcePathHint: item.sourcePathHint
      }));
    },

    async importLocalCandidate(
      candidateId: string
    ): Promise<ImportedAccountResult> {
      const candidates = await scanKiroLocalFiles();
      const target = candidates.find(
        (item) => item.candidateId === candidateId
      );
      if (!target) {
        throw new SubscriptionError(
          "subscriptions.candidate_not_found",
          "未在本机找到指定的 Kiro 凭证。"
        );
      }
      return {
        displayName: target.displayName,
        ...(target.email ? { email: target.email } : {}),
        source: "local_import",
        secret: {
          accessToken: target.accessToken,
          ...(target.refreshToken ? { refreshToken: target.refreshToken } : {}),
          ...(target.expiresAt ? { expiresAt: target.expiresAt } : {}),
          extra: {
            authMethod: target.authMethod,
            region: target.region,
            ...(target.profileArn ? { profileArn: target.profileArn } : {}),
            ...(target.clientId ? { clientId: target.clientId } : {}),
            ...(target.clientSecret
              ? { clientSecret: target.clientSecret }
              : {}),
            ...(target.startUrl ? { startUrl: target.startUrl } : {})
          }
        }
      };
    },

    async refreshSecret(
      _account: StoredAccountRecord,
      secret: StoredAccountSecret,
      signal?: AbortSignal
    ): Promise<StoredAccountSecret> {
      if (!secret.refreshToken) {
        throw new SubscriptionError(
          "subscriptions.secret_refresh_failed",
          "当前 Kiro 账号缺少刷新令牌，请重新授权。"
        );
      }
      const region = secret.extra?.region ?? defaultRegion;
      const isBuilderId =
        secret.extra?.authMethod === "builder_id" ||
        Boolean(secret.extra?.clientId && secret.extra?.clientSecret);

      if (isBuilderId) {
        const clientId = secret.extra?.clientId;
        const clientSecret = secret.extra?.clientSecret;
        if (!clientId || !clientSecret) {
          throw new SubscriptionError(
            "subscriptions.secret_refresh_failed",
            "当前 AWS Builder ID 账号缺少 OIDC 客户端凭据，请重新设备码登录。"
          );
        }
        const oidcBase = resolveOidcBase(region);
        const response = await ctx.fetcher(`${oidcBase}/token`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json"
          },
          body: JSON.stringify({
            clientId,
            clientSecret,
            grantType: "refresh_token",
            refreshToken: secret.refreshToken
          }),
          ...(signal ? { signal } : {})
        });
        if (!response.ok) {
          throwHttpSubscriptionError(response.status, "Kiro (AWS Builder ID)");
        }
        const data = (await response.json()) as unknown;
        if (!isRecord(data) || !nonEmptyString(data.accessToken)) {
          throw new SubscriptionError(
            "subscriptions.secret_refresh_failed",
            "AWS Builder ID 刷新令牌响应缺少访问令牌。"
          );
        }
        const refreshedExpiresAt =
          toIsoExpiry(data.expiresIn, ctx.now()) ?? secret.expiresAt;
        return {
          ...secret,
          accessToken: data.accessToken as string,
          refreshToken:
            nonEmptyString(data.refreshToken) ?? secret.refreshToken,
          ...(refreshedExpiresAt ? { expiresAt: refreshedExpiresAt } : {})
        };
      }

      const response = await ctx.fetcher(`${socialAuthBaseUrl}/refreshToken`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        body: JSON.stringify({
          refreshToken: secret.refreshToken
        }),
        ...(signal ? { signal } : {})
      });
      if (!response.ok) {
        throwHttpSubscriptionError(response.status, "Kiro");
      }
      const data = (await response.json()) as unknown;
      if (!isRecord(data) || !nonEmptyString(data.accessToken)) {
        throw new SubscriptionError(
          "subscriptions.secret_refresh_failed",
          "Kiro Social 刷新令牌响应缺少访问令牌。"
        );
      }
      const profileArn =
        nonEmptyString(data.profileArn) ?? secret.extra?.profileArn;
      const socialExpiresAt =
        toIsoExpiry(data.expiresIn ?? data.expiresAt, ctx.now()) ??
        secret.expiresAt;
      return {
        ...secret,
        accessToken: data.accessToken as string,
        refreshToken: nonEmptyString(data.refreshToken) ?? secret.refreshToken,
        ...(socialExpiresAt ? { expiresAt: socialExpiresAt } : {}),
        extra: {
          ...(secret.extra ?? {}),
          ...(profileArn ? { profileArn } : {})
        }
      };
    },

    async fetchQuota(
      _account: StoredAccountRecord,
      secret: StoredAccountSecret,
      signal?: AbortSignal
    ): Promise<QuotaFetchResult> {
      const region =
        resolveRegionFromProfileArn(secret.extra?.profileArn) ??
        secret.extra?.region ??
        defaultRegion;
      const baseUrl = resolveCodeWhispererBase(region);
      const url = new URL(`${baseUrl}/getUsageLimits`);
      url.searchParams.set("origin", "AI_EDITOR");
      url.searchParams.set("resourceType", "AGENTIC_REQUEST");
      url.searchParams.set("isEmailRequired", "true");
      if (secret.extra?.profileArn) {
        url.searchParams.set("profileArn", secret.extra.profileArn);
      }

      const response = await ctx.fetcher(url.toString(), {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${secret.accessToken}`,
          "User-Agent": "aws-sdk-js/1.0.0 KiroIDE/0.7.0"
        },
        ...(signal ? { signal } : {})
      });
      if (!response.ok) {
        throwHttpSubscriptionError(response.status, "Kiro");
      }
      const data = (await response.json()) as unknown;
      if (!isRecord(data)) {
        return { quotaBuckets: [] };
      }

      const subInfo = isRecord(data.subscriptionInfo)
        ? data.subscriptionInfo
        : undefined;
      const planTier = formatKiroPlanTier(
        nonEmptyString(subInfo?.subscriptionTitle),
        nonEmptyString(subInfo?.type)
      );
      const parsed = parseKiroUsageBuckets(data, ctx.now());
      return {
        ...(planTier ? { planTier } : {}),
        quotaBuckets: parsed.buckets,
        status: parsed.exhausted ? "quota_exhausted" : "active",
        ...(parsed.exhausted && parsed.resetsAt
          ? { cooldownUntil: parsed.resetsAt }
          : {})
      };
    },

    async listModels(
      _account,
      secret,
      signal
    ): Promise<SubscriptionModelDefinition[]> {
      const profileArn = secret?.extra?.profileArn;
      const region =
        resolveRegionFromProfileArn(profileArn) ??
        secret?.extra?.region ??
        defaultRegion;
      const baseUrl = resolveCodeWhispererBase(region);
      const token = secret?.accessToken?.trim();
      if (!token || token === "pending-refresh") {
        return KIRO_BASELINE_MODELS.map((item) => ({ ...item, baseUrl }));
      }
      try {
        const url = new URL(`${baseUrl}/ListAvailableModels`);
        url.searchParams.set("origin", "AI_EDITOR");
        if (profileArn) {
          url.searchParams.set("profileArn", profileArn);
        }
        const response = await ctx.fetcher(url.toString(), {
          method: "GET",
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${token}`,
            "User-Agent": "aws-sdk-js/1.0.0 KiroIDE/0.7.0"
          },
          ...(signal ? { signal } : {})
        });
        if (!response.ok) {
          return KIRO_BASELINE_MODELS.map((item) => ({ ...item, baseUrl }));
        }
        const raw = (await response.json()) as unknown;
        const list =
          isRecord(raw) && Array.isArray(raw.models)
            ? raw.models
            : isRecord(raw) && Array.isArray(raw.availableModels)
              ? raw.availableModels
              : [];
        if (list.length === 0) {
          return KIRO_BASELINE_MODELS.map((item) => ({ ...item, baseUrl }));
        }
        const byBaseline = new Map(
          KIRO_BASELINE_MODELS.map((item) => [item.modelId, item])
        );
        const models: SubscriptionModelDefinition[] = [];
        for (const item of list) {
          if (!isRecord(item)) continue;
          const modelId =
            nonEmptyString(item.modelId) ?? nonEmptyString(item.id);
          if (!modelId) continue;
          const id = `sub:kiro:${modelId.toLowerCase()}`;
          if (id.length > 120) continue;
          const baseline = byBaseline.get(modelId);
          const limits = isRecord(item.tokenLimits)
            ? item.tokenLimits
            : undefined;
          const ctxWindow =
            typeof limits?.maxInputTokens === "number" &&
            limits.maxInputTokens >= 1_024
              ? limits.maxInputTokens
              : undefined;
          const maxOut =
            typeof limits?.maxOutputTokens === "number" &&
            limits.maxOutputTokens >= 1
              ? limits.maxOutputTokens
              : undefined;
          const description = nonEmptyString(item.description);
          models.push({
            ...(baseline ?? {
              id,
              provider: "kiro",
              modelId,
              label:
                nonEmptyString(item.modelName) ??
                nonEmptyString(item.name) ??
                `${modelId} (Kiro)`,
              ...(description ? { description } : {}),
              api: "kiro-codewhisperer",
              baseUrl,
              reasoning: true,
              defaultThinkingLevel: /opus/iu.test(modelId)
                ? "high"
                : /haiku/iu.test(modelId)
                  ? "low"
                  : "medium",
              thinkingLevelOptions: ["low", "medium", "high"],
              contextWindow: ctxWindow ?? 200_000,
              maxTokens: maxOut ?? 64_000,
              recommended: models.length === 0
            }),
            ...(ctxWindow ? { contextWindow: ctxWindow } : {}),
            ...(maxOut ? { maxTokens: maxOut } : {}),
            baseUrl
          });
        }
        if (models.length === 0) {
          return KIRO_BASELINE_MODELS.map((item) => ({ ...item, baseUrl }));
        }
        if (!models.some((m) => m.recommended)) {
          models[0] = { ...models[0]!, recommended: true };
        }
        return models;
      } catch {
        return KIRO_BASELINE_MODELS.map((item) => ({ ...item, baseUrl }));
      }
    },

    toRuntimeCredential(account, secret) {
      const profileArn = secret.extra?.profileArn;
      const region =
        resolveRegionFromProfileArn(profileArn) ??
        secret.extra?.region ??
        defaultRegion;
      const baseUrl = resolveCodeWhispererBase(region);
      return {
        provider: "kiro",
        accountId: account.id,
        apiKey: secret.accessToken,
        baseUrl,
        ...(secret.expiresAt ? { expiresAt: secret.expiresAt } : {}),
        metadata: {
          region,
          endpoint: baseUrl,
          ...(profileArn ? { profileArn } : {})
        }
      };
    }
  };
}
