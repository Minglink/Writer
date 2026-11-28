import type { SubscriptionQuotaBucket } from "@writer/contracts";
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
  isRecord,
  maskPathHint,
  nonEmptyString,
  readJsonFileReadOnly,
  resolveAdapterContext,
  resolveHomeSubpath,
  sleepWithAbort,
  throwHttpSubscriptionError,
  toIsoExpiry,
  type ProviderEnvironmentOptions,
  type SubscriptionFetcher
} from "./shared";

const COPILOT_CLIENT_ID = Buffer.from(
  "SXYxLmI1MDdhMDhjODdlY2ZlOTg=",
  "base64"
).toString("utf8");
const COPILOT_DEFAULT_BASE_URL = "https://api.individual.githubcopilot.com";
const COPILOT_HEADERS: Record<string, string> = {
  "User-Agent": "GitHubCopilotChat/0.35.0",
  "Editor-Version": "vscode/1.107.0",
  "Editor-Plugin-Version": "copilot-chat/0.35.0",
  "Copilot-Integration-Id": "vscode-chat"
};
const GITHUB_API_VERSION_HEADER = {
  "X-GitHub-Api-Version": "2025-04-01"
};

export interface GitHubCopilotAdapterOptions extends ProviderEnvironmentOptions {
  clientId?: string;
  githubDomain?: string;
  githubApiBaseUrl?: string;
}

export const GITHUB_COPILOT_BASELINE_MODELS: readonly SubscriptionModelDefinition[] =
  [
    {
      id: "sub:github-copilot:gpt-6.2-astra",
      provider: "github-copilot",
      modelId: "gpt-6.2-astra",
      label: "GPT-6.2 Astra (Copilot)",
      description: "GitHub Copilot 订阅最新 GPT-6.2 旗舰模型",
      api: "github-copilot",
      baseUrl: COPILOT_DEFAULT_BASE_URL,
      reasoning: true,
      defaultThinkingLevel: "medium",
      thinkingLevelOptions: ["low", "medium", "high", "xhigh"],
      contextWindow: 1_050_000,
      maxTokens: 128_000,
      recommended: true
    },
    {
      id: "sub:github-copilot:gpt-6.2-sol",
      provider: "github-copilot",
      modelId: "gpt-6.2-sol",
      label: "GPT-6.2 Sol (Copilot)",
      api: "github-copilot",
      baseUrl: COPILOT_DEFAULT_BASE_URL,
      reasoning: true,
      defaultThinkingLevel: "medium",
      thinkingLevelOptions: ["low", "medium", "high", "xhigh"],
      contextWindow: 1_050_000,
      maxTokens: 128_000,
      recommended: false
    },
    {
      id: "sub:github-copilot:gpt-6.1-sol",
      provider: "github-copilot",
      modelId: "gpt-6.1-sol",
      label: "GPT-6.1 Sol (Copilot)",
      api: "github-copilot",
      baseUrl: COPILOT_DEFAULT_BASE_URL,
      reasoning: true,
      defaultThinkingLevel: "medium",
      thinkingLevelOptions: ["low", "medium", "high", "xhigh"],
      contextWindow: 1_050_000,
      maxTokens: 128_000,
      recommended: false
    },
    {
      id: "sub:github-copilot:claude-fable-5.2",
      provider: "github-copilot",
      modelId: "claude-fable-5.2",
      label: "Claude Fable 5.2 (Copilot)",
      api: "github-copilot",
      baseUrl: COPILOT_DEFAULT_BASE_URL,
      reasoning: true,
      defaultThinkingLevel: "high",
      thinkingLevelOptions: ["low", "medium", "high", "max"],
      contextWindow: 1_000_000,
      maxTokens: 128_000,
      recommended: false
    },
    {
      id: "sub:github-copilot:claude-opus-5.5",
      provider: "github-copilot",
      modelId: "claude-opus-5.5",
      label: "Claude Opus 5.5 (Copilot)",
      api: "github-copilot",
      baseUrl: COPILOT_DEFAULT_BASE_URL,
      reasoning: true,
      defaultThinkingLevel: "high",
      thinkingLevelOptions: ["low", "medium", "high", "max"],
      contextWindow: 1_000_000,
      maxTokens: 128_000,
      recommended: false
    },
    {
      id: "sub:github-copilot:claude-sonnet-5.5",
      provider: "github-copilot",
      modelId: "claude-sonnet-5.5",
      label: "Claude Sonnet 5.5 (Copilot)",
      api: "github-copilot",
      baseUrl: COPILOT_DEFAULT_BASE_URL,
      reasoning: true,
      defaultThinkingLevel: "medium",
      thinkingLevelOptions: ["low", "medium", "high", "max"],
      contextWindow: 1_000_000,
      maxTokens: 128_000,
      recommended: false
    },
    {
      id: "sub:github-copilot:gemini-3.8-flash",
      provider: "github-copilot",
      modelId: "gemini-3.8-flash",
      label: "Gemini 3.8 Flash (Copilot)",
      api: "github-copilot",
      baseUrl: COPILOT_DEFAULT_BASE_URL,
      reasoning: true,
      defaultThinkingLevel: "medium",
      thinkingLevelOptions: ["low", "medium", "high"],
      contextWindow: 1_000_000,
      maxTokens: 64_000,
      recommended: false
    },
    {
      id: "sub:github-copilot:gpt-5.3-codex",
      provider: "github-copilot",
      modelId: "gpt-5.3-codex",
      label: "GPT-5.3 Codex (Copilot)",
      api: "github-copilot",
      baseUrl: COPILOT_DEFAULT_BASE_URL,
      reasoning: true,
      defaultThinkingLevel: "medium",
      thinkingLevelOptions: ["low", "medium", "high", "xhigh"],
      contextWindow: 1_000_000,
      maxTokens: 128_000,
      recommended: false
    }
  ];

interface DiscoveredCopilotCandidate {
  candidateId: string;
  displayName: string;
  oauthToken: string;
  domain: string;
  sourcePathHint: string;
}

function getBaseUrlFromCopilotToken(token: string): string | undefined {
  const match = /proxy-ep=([^;\s]+)/iu.exec(token);
  if (!match?.[1]) return undefined;
  return `https://${match[1].replace(/^proxy\./iu, "api.")}`;
}

function formatCopilotPlan(rawPlan: string | undefined): string | undefined {
  if (!rawPlan) return undefined;
  const lower = rawPlan.trim().toLowerCase();
  if (lower === "free" || lower === "copilot_free") return "Free";
  if (lower === "pro" || lower === "individual" || lower === "copilot_pro") {
    return "Pro";
  }
  if (lower === "pro_plus" || lower === "copilot_pro_plus") return "Pro+";
  if (lower === "business" || lower === "copilot_business") return "Business";
  if (lower === "enterprise" || lower === "copilot_enterprise") {
    return "Enterprise";
  }
  return rawPlan;
}

async function exchangeCopilotToken(
  fetcher: SubscriptionFetcher,
  githubApiBaseUrl: string,
  oauthToken: string,
  signal?: AbortSignal
): Promise<{
  providerToken: string;
  providerTokenExpiresAt: string;
  baseUrl: string;
}> {
  const response = await fetcher(
    `${githubApiBaseUrl.replace(/\/+$/u, "")}/copilot_internal/v2/token`,
    {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `token ${oauthToken}`,
        ...GITHUB_API_VERSION_HEADER,
        ...COPILOT_HEADERS
      },
      ...(signal ? { signal } : {})
    }
  );
  if (!response.ok) {
    throwHttpSubscriptionError(response.status, "GitHub Copilot");
  }
  const data = (await response.json()) as unknown;
  if (!isRecord(data) || !nonEmptyString(data.token)) {
    throw new SubscriptionError(
      "subscriptions.secret_refresh_failed",
      "GitHub Copilot 未返回有效的短效访问令牌。"
    );
  }
  const providerToken = data.token as string;
  // Refresh 5 minutes before upstream expiration.
  const rawExpires =
    typeof data.expires_at === "number"
      ? data.expires_at * 1_000 - 5 * 60 * 1_000
      : Date.now() + 25 * 60 * 1_000;
  const baseUrl =
    getBaseUrlFromCopilotToken(providerToken) ?? COPILOT_DEFAULT_BASE_URL;
  return {
    providerToken,
    providerTokenExpiresAt: new Date(rawExpires).toISOString(),
    baseUrl
  };
}

async function fetchGitHubUserProfile(
  fetcher: SubscriptionFetcher,
  githubApiBaseUrl: string,
  oauthToken: string,
  signal?: AbortSignal
): Promise<{ displayName?: string; email?: string }> {
  const apiRoot = githubApiBaseUrl.replace(/\/+$/u, "");
  const headers = {
    Accept: "application/json",
    Authorization: `token ${oauthToken}`,
    ...GITHUB_API_VERSION_HEADER,
    ...COPILOT_HEADERS
  };
  try {
    const response = await fetcher(`${apiRoot}/user`, {
      method: "GET",
      headers,
      ...(signal ? { signal } : {})
    });
    if (!response.ok) return {};
    const data = (await response.json()) as unknown;
    if (!isRecord(data)) return {};
    let email = nonEmptyString(data.email);
    if (!email) {
      try {
        const emailRes = await fetcher(`${apiRoot}/user/emails`, {
          method: "GET",
          headers,
          ...(signal ? { signal } : {})
        });
        if (emailRes.ok) {
          const emailList = (await emailRes.json()) as unknown;
          if (Array.isArray(emailList)) {
            const primary = emailList.find(
              (entry) =>
                isRecord(entry) &&
                entry.primary === true &&
                nonEmptyString(entry.email)
            );
            const fallback = emailList.find(
              (entry) => isRecord(entry) && nonEmptyString(entry.email)
            );
            email =
              (isRecord(primary) ? nonEmptyString(primary.email) : undefined) ??
              (isRecord(fallback) ? nonEmptyString(fallback.email) : undefined);
          }
        }
      } catch {
        // Optional fallback; ignore if token lacks user:email scope.
      }
    }
    const displayName =
      nonEmptyString(data.login) ?? nonEmptyString(data.name) ?? email;
    return {
      ...(displayName ? { displayName } : {}),
      ...(email ? { email } : {})
    };
  } catch {
    return {};
  }
}

function parseCopilotQuotaSnapshot(
  id: string,
  label: string,
  snapshot: unknown,
  resetsAt: string | undefined
): SubscriptionQuotaBucket | undefined {
  if (!isRecord(snapshot)) return undefined;
  if (snapshot.has_quota === false) return undefined;
  if (snapshot.unlimited === true) {
    return {
      id,
      label,
      unlimited: true,
      ...(resetsAt ? { resetsAt } : {})
    };
  }
  const entitlement =
    typeof snapshot.entitlement === "number" &&
    Number.isFinite(snapshot.entitlement)
      ? snapshot.entitlement
      : undefined;
  if (entitlement !== undefined && entitlement <= 0) {
    return undefined;
  }
  const remaining =
    typeof snapshot.remaining === "number" &&
    Number.isFinite(snapshot.remaining)
      ? Math.max(0, snapshot.remaining)
      : undefined;
  const percentRemaining =
    typeof snapshot.percent_remaining === "number" &&
    Number.isFinite(snapshot.percent_remaining)
      ? Math.min(100, Math.max(0, snapshot.percent_remaining))
      : entitlement && remaining !== undefined
        ? Math.min(100, Math.max(0, (remaining / entitlement) * 100))
        : undefined;
  if (
    percentRemaining === undefined &&
    entitlement === undefined &&
    remaining === undefined
  ) {
    return undefined;
  }
  const used =
    entitlement !== undefined && remaining !== undefined
      ? Math.max(0, entitlement - remaining)
      : undefined;
  return {
    id,
    label,
    ...(percentRemaining !== undefined
      ? { remainingPercent: percentRemaining }
      : {}),
    ...(used !== undefined ? { used } : {}),
    ...(entitlement !== undefined && entitlement > 0
      ? { limit: entitlement }
      : {}),
    unit: "requests",
    ...(resetsAt ? { resetsAt } : {})
  };
}

export function createGitHubCopilotAdapter(
  options: GitHubCopilotAdapterOptions = {}
): SubscriptionProviderAdapter {
  const ctx = resolveAdapterContext(options);
  const clientId = options.clientId ?? COPILOT_CLIENT_ID;
  const githubDomain = options.githubDomain ?? "github.com";
  const githubApiBaseUrl =
    options.githubApiBaseUrl ?? `https://api.${githubDomain}`;
  const meta = DEFAULT_SUBSCRIPTION_PROVIDER_METADATA["github-copilot"];

  const scanCopilotLocalFiles = async (): Promise<
    DiscoveredCopilotCandidate[]
  > => {
    const candidateFiles: string[] = [
      resolveHomeSubpath(
        ctx.homeDir,
        ".config",
        "github-copilot",
        "hosts.json"
      ),
      resolveHomeSubpath(ctx.homeDir, ".config", "github-copilot", "apps.json")
    ];
    if (ctx.env.LOCALAPPDATA) {
      candidateFiles.push(
        resolveHomeSubpath(
          ctx.env.LOCALAPPDATA,
          "github-copilot",
          "hosts.json"
        ),
        resolveHomeSubpath(ctx.env.LOCALAPPDATA, "github-copilot", "apps.json")
      );
    }
    if (ctx.env.APPDATA) {
      candidateFiles.push(
        resolveHomeSubpath(ctx.env.APPDATA, "github-copilot", "hosts.json"),
        resolveHomeSubpath(ctx.env.APPDATA, "github-copilot", "apps.json")
      );
    }

    const found: DiscoveredCopilotCandidate[] = [];
    const seen = new Set<string>();
    for (const filePath of candidateFiles) {
      const raw = await readJsonFileReadOnly(filePath);
      if (!isRecord(raw)) continue;
      for (const [entryKey, entryVal] of Object.entries(raw)) {
        if (!isRecord(entryVal)) continue;
        const oauthToken = nonEmptyString(entryVal.oauth_token);
        if (!oauthToken) continue;
        const domain = entryKey.split(":")[0] || githubDomain;
        const user =
          nonEmptyString(entryVal.user) ??
          nonEmptyString(entryVal.login) ??
          domain;
        const dedupeKey = `${domain}:${user}:${oauthToken.slice(-6)}`;
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);
        found.push({
          candidateId: `copilot:${domain}:${user}`,
          displayName: user,
          oauthToken,
          domain,
          sourcePathHint: maskPathHint(filePath, ctx.homeDir)
        });
      }
    }
    return found;
  };

  return {
    id: "github-copilot",
    meta,

    async startAuth(authCtx: AuthFlowContext): Promise<AuthFlowHandle> {
      const deviceResp = await ctx.fetcher(
        `https://${githubDomain}/login/device/code`,
        {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": COPILOT_HEADERS["User-Agent"]!
          },
          body: new URLSearchParams({
            client_id: clientId,
            scope: "read:user"
          }),
          signal: authCtx.signal
        }
      );
      if (!deviceResp.ok) {
        throwHttpSubscriptionError(deviceResp.status, "GitHub Copilot");
      }
      const deviceData = (await deviceResp.json()) as unknown;
      if (
        !isRecord(deviceData) ||
        !nonEmptyString(deviceData.device_code) ||
        !nonEmptyString(deviceData.user_code) ||
        !nonEmptyString(deviceData.verification_uri)
      ) {
        throw new SubscriptionError(
          "subscriptions.device_flow_failed",
          "GitHub Device Flow 响应格式无效。"
        );
      }
      const deviceCode = deviceData.device_code as string;
      const userCode = deviceData.user_code as string;
      const verificationUri = deviceData.verification_uri as string;
      let intervalSec =
        typeof deviceData.interval === "number" && deviceData.interval > 0
          ? deviceData.interval
          : 5;
      const expiresIn =
        typeof deviceData.expires_in === "number" && deviceData.expires_in > 0
          ? deviceData.expires_in
          : 900;
      const deadlineMs = ctx.now() + expiresIn * 1_000;
      const expiresAt = new Date(deadlineMs).toISOString();

      let cancelled = false;
      const completion = (async (): Promise<ImportedAccountResult> => {
        let oauthToken = "";
        while (
          !cancelled &&
          !authCtx.signal.aborted &&
          ctx.now() < deadlineMs
        ) {
          await sleepWithAbort(intervalSec * 1_000, authCtx.signal);
          const pollResp = await ctx.fetcher(
            `https://${githubDomain}/login/oauth/access_token`,
            {
              method: "POST",
              headers: {
                Accept: "application/json",
                "Content-Type": "application/x-www-form-urlencoded",
                "User-Agent": COPILOT_HEADERS["User-Agent"]!
              },
              body: new URLSearchParams({
                client_id: clientId,
                device_code: deviceCode,
                grant_type: "urn:ietf:params:oauth:grant-type:device_code"
              }),
              signal: authCtx.signal
            }
          );
          if (!pollResp.ok) {
            throwHttpSubscriptionError(pollResp.status, "GitHub Copilot");
          }
          const pollData = (await pollResp.json()) as unknown;
          if (!isRecord(pollData)) continue;
          const token = nonEmptyString(pollData.access_token);
          if (token) {
            oauthToken = token;
            break;
          }
          const err = nonEmptyString(pollData.error);
          if (err === "authorization_pending") {
            continue;
          }
          if (err === "slow_down") {
            intervalSec =
              typeof pollData.interval === "number" && pollData.interval > 0
                ? pollData.interval
                : intervalSec + 5;
            continue;
          }
          if (err === "expired_token") {
            throw new SubscriptionError(
              "subscriptions.auth_timeout",
              "GitHub Copilot 设备码已过期，请重新获取。"
            );
          }
          if (err === "access_denied") {
            throw new SubscriptionError(
              "subscriptions.auth_denied",
              "GitHub Copilot 授权被拒绝，请重新发起。"
            );
          }
        }
        if (!oauthToken) {
          throw new SubscriptionError(
            "subscriptions.auth_timeout",
            "GitHub Copilot 设备授权超时，请重新发起。"
          );
        }

        const [exchanged, profile] = await Promise.all([
          exchangeCopilotToken(
            ctx.fetcher,
            githubApiBaseUrl,
            oauthToken,
            authCtx.signal
          ),
          fetchGitHubUserProfile(
            ctx.fetcher,
            githubApiBaseUrl,
            oauthToken,
            authCtx.signal
          )
        ]);
        return {
          displayName: profile.displayName ?? "GitHub Copilot 账号",
          ...(profile.email ? { email: profile.email } : {}),
          source: "device_flow",
          secret: {
            accessToken: exchanged.providerToken,
            refreshToken: oauthToken,
            expiresAt: exchanged.providerTokenExpiresAt,
            providerToken: exchanged.providerToken,
            providerTokenExpiresAt: exchanged.providerTokenExpiresAt,
            extra: { baseUrl: exchanged.baseUrl }
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
      const candidates = await scanCopilotLocalFiles();
      return candidates.map((item) => ({
        candidateId: item.candidateId,
        provider: "github-copilot",
        displayName: item.displayName,
        sourceLabel: "GitHub Copilot 本地配置",
        sourcePathHint: item.sourcePathHint
      }));
    },

    async importLocalCandidate(
      candidateId: string
    ): Promise<ImportedAccountResult> {
      const candidates = await scanCopilotLocalFiles();
      const target = candidates.find(
        (item) => item.candidateId === candidateId
      );
      if (!target) {
        throw new SubscriptionError(
          "subscriptions.candidate_not_found",
          "未在本机找到指定的 GitHub Copilot 凭证。"
        );
      }
      const apiBase =
        target.domain === "github.com"
          ? githubApiBaseUrl
          : `https://api.${target.domain}`;
      const [exchanged, profile] = await Promise.all([
        exchangeCopilotToken(ctx.fetcher, apiBase, target.oauthToken),
        fetchGitHubUserProfile(ctx.fetcher, apiBase, target.oauthToken)
      ]);
      return {
        displayName: profile.displayName ?? target.displayName,
        ...(profile.email ? { email: profile.email } : {}),
        source: "local_import",
        secret: {
          accessToken: exchanged.providerToken,
          refreshToken: target.oauthToken,
          expiresAt: exchanged.providerTokenExpiresAt,
          providerToken: exchanged.providerToken,
          providerTokenExpiresAt: exchanged.providerTokenExpiresAt,
          extra: {
            baseUrl: exchanged.baseUrl,
            ...(target.domain !== "github.com"
              ? { enterpriseDomain: target.domain }
              : {})
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
          "当前 GitHub Copilot 账号缺少 OAuth 令牌，请重新授权。"
        );
      }
      const apiBase = secret.extra?.enterpriseDomain
        ? `https://api.${secret.extra.enterpriseDomain}`
        : githubApiBaseUrl;
      const exchanged = await exchangeCopilotToken(
        ctx.fetcher,
        apiBase,
        secret.refreshToken,
        signal
      );
      return {
        ...secret,
        accessToken: exchanged.providerToken,
        expiresAt: exchanged.providerTokenExpiresAt,
        providerToken: exchanged.providerToken,
        providerTokenExpiresAt: exchanged.providerTokenExpiresAt,
        extra: {
          ...(secret.extra ?? {}),
          baseUrl: exchanged.baseUrl
        }
      };
    },

    async fetchQuota(
      _account: StoredAccountRecord,
      secret: StoredAccountSecret,
      signal?: AbortSignal
    ): Promise<QuotaFetchResult> {
      const oauthToken = secret.refreshToken;
      if (!oauthToken) {
        return { quotaBuckets: [] };
      }
      const apiBase = secret.extra?.enterpriseDomain
        ? `https://api.${secret.extra.enterpriseDomain}`
        : githubApiBaseUrl;
      const response = await ctx.fetcher(
        `${apiBase.replace(/\/+$/u, "")}/copilot_internal/user`,
        {
          method: "GET",
          headers: {
            Accept: "application/json",
            Authorization: `token ${oauthToken}`,
            ...GITHUB_API_VERSION_HEADER,
            ...COPILOT_HEADERS
          },
          ...(signal ? { signal } : {})
        }
      );
      if (!response.ok) {
        throwHttpSubscriptionError(response.status, "GitHub Copilot");
      }
      const data = (await response.json()) as unknown;
      if (!isRecord(data)) return { quotaBuckets: [] };
      const planTier = formatCopilotPlan(nonEmptyString(data.copilot_plan));
      const resetsAt = toIsoExpiry(data.quota_reset_date);
      const snapshots = isRecord(data.quota_snapshots)
        ? data.quota_snapshots
        : undefined;
      const buckets: SubscriptionQuotaBucket[] = [];
      const premium = parseCopilotQuotaSnapshot(
        "copilot-premium",
        "高级请求配额",
        snapshots?.premium_models ?? snapshots?.premium_interactions,
        resetsAt
      );
      if (premium) buckets.push(premium);
      const chat = parseCopilotQuotaSnapshot(
        "copilot-chat",
        "对话请求配额",
        snapshots?.chat,
        resetsAt
      );
      if (chat) buckets.push(chat);
      const exhausted =
        premium !== undefined &&
        premium.remainingPercent !== undefined &&
        premium.remainingPercent <= 0;
      return {
        ...(planTier ? { planTier } : {}),
        quotaBuckets: buckets,
        status: exhausted ? "quota_exhausted" : "active",
        ...(exhausted && resetsAt ? { cooldownUntil: resetsAt } : {})
      };
    },

    async listModels(
      _account,
      secret,
      signal
    ): Promise<SubscriptionModelDefinition[]> {
      const token = secret?.providerToken ?? secret?.accessToken;
      if (!token) {
        return [...GITHUB_COPILOT_BASELINE_MODELS];
      }
      const baseUrl = secret?.extra?.baseUrl ?? COPILOT_DEFAULT_BASE_URL;
      const rootUrl = baseUrl.replace(/\/+$/u, "");
      try {
        const response = await ctx.fetcher(`${rootUrl}/models`, {
          method: "GET",
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${token}`,
            ...COPILOT_HEADERS
          },
          ...(signal ? { signal } : {})
        });
        if (!response.ok) {
          return [...GITHUB_COPILOT_BASELINE_MODELS];
        }
        const raw = (await response.json()) as unknown;
        if (!isRecord(raw) || !Array.isArray(raw.data)) {
          return [...GITHUB_COPILOT_BASELINE_MODELS];
        }
        const byBaseline = new Map(
          GITHUB_COPILOT_BASELINE_MODELS.map((item) => [item.modelId, item])
        );
        const candidates = raw.data.filter(
          (item): item is Record<string, unknown> =>
            isRecord(item) && Boolean(nonEmptyString(item.id))
        );
        const pickerModels = candidates.filter(
          (item) => item.model_picker_enabled !== false
        );
        // Individual Copilot accounts sometimes omit model_picker_enabled on all
        // models; fall back to policy-enabled/unconfigured entries in that case.
        const selectedRaw =
          pickerModels.length > 0
            ? pickerModels
            : candidates.filter(
                (item) =>
                  !isRecord(item.policy) ||
                  item.policy.state === "enabled" ||
                  item.policy.state === "unconfigured"
              );
        const unconfiguredIds: string[] = [];
        const models: SubscriptionModelDefinition[] = [];
        for (const item of selectedRaw) {
          const modelId = nonEmptyString(item.id);
          if (!modelId) continue;
          if (isRecord(item.policy) && item.policy.state === "disabled") {
            continue;
          }
          if (isRecord(item.policy) && item.policy.state === "unconfigured") {
            unconfiguredIds.push(modelId);
          }
          const baseline = byBaseline.get(modelId);
          const id = `sub:github-copilot:${modelId.toLowerCase()}`;
          if (id.length > 120) continue;
          const caps = isRecord(item.capabilities)
            ? item.capabilities
            : undefined;
          const limits = isRecord(caps?.limits) ? caps.limits : undefined;
          const supports = isRecord(caps?.supports) ? caps.supports : undefined;
          const remoteContext =
            typeof limits?.max_context_window_tokens === "number" &&
            limits.max_context_window_tokens >= 1_024
              ? limits.max_context_window_tokens
              : undefined;
          const remoteMaxOut =
            typeof limits?.max_output_tokens === "number" &&
            limits.max_output_tokens >= 1
              ? limits.max_output_tokens
              : undefined;
          const remoteReasoning =
            typeof supports?.thinking === "boolean"
              ? supports.thinking
              : typeof supports?.reasoning === "boolean"
                ? supports.reasoning
                : undefined;
          models.push({
            ...(baseline ?? {
              id,
              provider: "github-copilot",
              modelId,
              label: nonEmptyString(item.name) ?? modelId,
              api: "github-copilot",
              baseUrl,
              reasoning: remoteReasoning ?? true,
              defaultThinkingLevel:
                remoteReasoning === false ? "off" : "medium",
              ...(remoteContext ? { contextWindow: remoteContext } : {}),
              ...(remoteMaxOut ? { maxTokens: remoteMaxOut } : {}),
              recommended: modelId === "gpt-5.3-codex"
            }),
            ...(remoteContext ? { contextWindow: remoteContext } : {}),
            ...(remoteMaxOut ? { maxTokens: remoteMaxOut } : {}),
            baseUrl
          });
        }
        // Best-effort enable unconfigured models (such as Claude/Grok) so chat works immediately.
        for (const modelId of unconfiguredIds) {
          try {
            const policyRes = await ctx.fetcher(
              `${rootUrl}/models/${encodeURIComponent(modelId)}/policy`,
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${token}`,
                  ...COPILOT_HEADERS,
                  "openai-intent": "chat-policy",
                  "x-interaction-type": "chat-policy"
                },
                body: JSON.stringify({ state: "enabled" }),
                ...(signal ? { signal } : {})
              }
            );
            if (policyRes.status === 429) break;
          } catch {
            if (signal?.aborted) break;
          }
        }
        return models.length > 0 ? models : [...GITHUB_COPILOT_BASELINE_MODELS];
      } catch {
        return [...GITHUB_COPILOT_BASELINE_MODELS];
      }
    },

    toRuntimeCredential(account, secret) {
      const token = secret.providerToken ?? secret.accessToken;
      const baseUrl =
        secret.extra?.baseUrl ??
        getBaseUrlFromCopilotToken(token) ??
        COPILOT_DEFAULT_BASE_URL;
      const expiresAt = secret.providerTokenExpiresAt ?? secret.expiresAt;
      return {
        provider: "github-copilot",
        accountId: account.id,
        apiKey: token,
        baseUrl,
        ...(expiresAt ? { expiresAt } : {})
      };
    }
  };
}
