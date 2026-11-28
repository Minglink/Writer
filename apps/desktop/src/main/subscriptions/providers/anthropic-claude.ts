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
  throwHttpSubscriptionError,
  toIsoExpiry,
  type ProviderEnvironmentOptions,
  type SubscriptionFetcher
} from "./shared";

const CLAUDE_CLIENT_ID = Buffer.from(
  "OWQxYzI1MGEtZTYxYi00NGQ5LTg4ZWQtNTk0NGQxOTYyZjVl",
  "base64"
).toString("utf8");
const CLAUDE_AUTHORIZE_URL = "https://claude.ai/oauth/authorize";
const CLAUDE_TOKEN_URL = "https://platform.claude.com/v1/oauth/token";
const CLAUDE_API_BASE_URL = "https://api.anthropic.com";
const CLAUDE_USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const CLAUDE_PROFILE_URL = "https://api.anthropic.com/api/oauth/profile";
const CLAUDE_OAUTH_SCOPES =
  "org:create_api_key user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload";
const CLAUDE_CANDIDATE_ID = "claude:cli";
const CLAUDE_USER_AGENT = "claude-cli/2.1.280";

export interface AnthropicClaudeAdapterOptions extends ProviderEnvironmentOptions {
  clientId?: string;
  authorizeUrl?: string;
  tokenUrl?: string;
  apiBaseUrl?: string;
  usageUrl?: string;
  profileUrl?: string;
  preferredPort?: number;
}

export const ANTHROPIC_CLAUDE_BASELINE_MODELS: readonly SubscriptionModelDefinition[] =
  [
    {
      id: "sub:anthropic-claude:claude-opus-5-5",
      provider: "anthropic-claude",
      modelId: "claude-opus-5-5",
      label: "Claude Opus 5.5",
      description: "Claude 订阅旗舰长文写作与深度推理模型",
      api: "anthropic-messages",
      baseUrl: CLAUDE_API_BASE_URL,
      reasoning: true,
      defaultThinkingLevel: "high",
      thinkingLevelOptions: ["low", "medium", "high", "max"],
      contextWindow: 1_000_000,
      maxTokens: 128_000,
      recommended: true
    },
    {
      id: "sub:anthropic-claude:claude-sonnet-5-5",
      provider: "anthropic-claude",
      modelId: "claude-sonnet-5-5",
      label: "Claude Sonnet 5.5",
      description: "Claude 订阅高性价比平衡创作与推理模型",
      api: "anthropic-messages",
      baseUrl: CLAUDE_API_BASE_URL,
      reasoning: true,
      defaultThinkingLevel: "medium",
      thinkingLevelOptions: ["low", "medium", "high", "max"],
      contextWindow: 1_000_000,
      maxTokens: 128_000,
      recommended: false
    },
    {
      id: "sub:anthropic-claude:claude-fable-5-2",
      provider: "anthropic-claude",
      modelId: "claude-fable-5-2",
      label: "Claude Fable 5.2",
      description: "Claude 深度推理与长程任务旗舰模型",
      api: "anthropic-messages",
      baseUrl: CLAUDE_API_BASE_URL,
      reasoning: true,
      defaultThinkingLevel: "high",
      thinkingLevelOptions: ["low", "medium", "high", "max"],
      contextWindow: 1_000_000,
      maxTokens: 128_000,
      recommended: false
    },
    {
      id: "sub:anthropic-claude:claude-haiku-5-5",
      provider: "anthropic-claude",
      modelId: "claude-haiku-5-5",
      label: "Claude Haiku 5.5",
      api: "anthropic-messages",
      baseUrl: CLAUDE_API_BASE_URL,
      reasoning: true,
      defaultThinkingLevel: "low",
      thinkingLevelOptions: ["low", "medium", "high"],
      contextWindow: 1_000_000,
      maxTokens: 128_000,
      recommended: false
    }
  ];

function formatClaudePlanTier(
  subscriptionType: string | undefined,
  rateLimitTier?: string
): string | undefined {
  const combined = `${subscriptionType ?? ""} ${rateLimitTier ?? ""}`
    .trim()
    .toLowerCase();
  if (!combined) return undefined;
  if (combined.includes("max_20x") || combined.includes("20x")) {
    return "Max 20x";
  }
  if (combined.includes("max_5x") || combined.includes("5x")) {
    return "Max 5x";
  }
  if (combined.includes("max")) return "Max";
  if (combined.includes("enterprise")) return "Enterprise";
  if (combined.includes("team")) return "Team";
  if (combined.includes("pro")) return "Pro";
  if (combined.includes("free")) return "Free";
  return nonEmptyString(subscriptionType) ?? nonEmptyString(rateLimitTier);
}

function parseClaudeWindowBucket(
  id: string,
  label: string,
  rawWindow: unknown
): SubscriptionQuotaBucket | undefined {
  if (!isRecord(rawWindow)) return undefined;
  const rawUtil =
    typeof rawWindow.utilization === "number" &&
    Number.isFinite(rawWindow.utilization)
      ? rawWindow.utilization
      : typeof rawWindow.percent === "number" &&
          Number.isFinite(rawWindow.percent)
        ? rawWindow.percent
        : undefined;
  const resetsAt = toIsoExpiry(rawWindow.resets_at ?? rawWindow.resetsAt);
  if (rawUtil === undefined && !resetsAt) return undefined;
  // Anthropic /api/oauth/usage reports utilization/percent on a 0..100 scale.
  const usedPercent =
    rawUtil !== undefined ? Math.min(100, Math.max(0, rawUtil)) : undefined;
  const remainingPercent =
    usedPercent !== undefined
      ? Math.min(100, Math.max(0, 100 - usedPercent))
      : undefined;
  return {
    id,
    label,
    ...(remainingPercent !== undefined ? { remainingPercent } : {}),
    ...(resetsAt ? { resetsAt } : {})
  };
}

function extractClaudeLimitsBuckets(rawLimits: unknown): {
  fiveHour?: SubscriptionQuotaBucket;
  sevenDay?: SubscriptionQuotaBucket;
  sevenDaySonnet?: SubscriptionQuotaBucket;
  sevenDayOpus?: SubscriptionQuotaBucket;
} {
  if (!Array.isArray(rawLimits)) return {};
  const result: {
    fiveHour?: SubscriptionQuotaBucket;
    sevenDay?: SubscriptionQuotaBucket;
    sevenDaySonnet?: SubscriptionQuotaBucket;
    sevenDayOpus?: SubscriptionQuotaBucket;
  } = {};
  const prioritized = [...rawLimits].filter(isRecord).sort((a, b) => {
    const aHasSurface = isRecord(a.scope) && Boolean(a.scope.surface);
    const bHasSurface = isRecord(b.scope) && Boolean(b.scope.surface);
    return Number(aHasSurface) - Number(bHasSurface);
  });
  for (const item of prioritized) {
    const windowKey = (
      nonEmptyString(item.window_key) ??
      nonEmptyString(item.window) ??
      nonEmptyString(item.type) ??
      ""
    ).toLowerCase();
    const scope = isRecord(item.scope) ? item.scope : undefined;
    const scopeModel = (nonEmptyString(scope?.model) ?? "").toLowerCase();
    const isFiveHour =
      windowKey.includes("five_hour") ||
      windowKey.includes("5h") ||
      windowKey === "session";
    const isSevenDay =
      windowKey.includes("seven_day") ||
      windowKey.includes("7d") ||
      windowKey === "weekly";

    if (isFiveHour && !scopeModel && !result.fiveHour) {
      const bucket = parseClaudeWindowBucket(
        "claude-5h",
        "5 小时限流窗口",
        item
      );
      if (bucket) result.fiveHour = bucket;
    } else if (isSevenDay) {
      if (
        (scopeModel.includes("sonnet") || windowKey.includes("sonnet")) &&
        !result.sevenDaySonnet
      ) {
        const bucket = parseClaudeWindowBucket(
          "claude-7d-sonnet",
          "7 天 Sonnet 窗口",
          item
        );
        if (bucket) result.sevenDaySonnet = bucket;
      } else if (
        (scopeModel.includes("opus") || windowKey.includes("opus")) &&
        !result.sevenDayOpus
      ) {
        const bucket = parseClaudeWindowBucket(
          "claude-7d-opus",
          "7 天 Opus 窗口",
          item
        );
        if (bucket) result.sevenDayOpus = bucket;
      } else if (!scopeModel && !result.sevenDay) {
        const bucket = parseClaudeWindowBucket(
          "claude-7d",
          "7 天限流窗口",
          item
        );
        if (bucket) result.sevenDay = bucket;
      }
    }
  }
  return result;
}

function parseExtraUsageBucket(
  rawExtra: unknown
): SubscriptionQuotaBucket | undefined {
  if (!isRecord(rawExtra) || rawExtra.is_enabled === false) return undefined;
  const used =
    typeof rawExtra.used_credits === "number" &&
    Number.isFinite(rawExtra.used_credits)
      ? Math.max(0, rawExtra.used_credits)
      : undefined;
  const limit =
    typeof rawExtra.monthly_limit === "number" &&
    Number.isFinite(rawExtra.monthly_limit) &&
    rawExtra.monthly_limit > 0
      ? rawExtra.monthly_limit
      : undefined;
  const util =
    typeof rawExtra.utilization === "number" &&
    Number.isFinite(rawExtra.utilization)
      ? rawExtra.utilization
      : undefined;
  const remainingPercent =
    util !== undefined
      ? Math.min(100, Math.max(0, 100 - util))
      : used !== undefined && limit !== undefined
        ? Math.min(100, Math.max(0, ((limit - used) / limit) * 100))
        : undefined;
  if (remainingPercent === undefined && used === undefined) return undefined;
  return {
    id: "claude-extra",
    label: "额外用量额度",
    ...(remainingPercent !== undefined ? { remainingPercent } : {}),
    ...(used !== undefined ? { used } : {}),
    ...(limit !== undefined ? { limit } : {}),
    unit: "credits"
  };
}

async function fetchClaudeProfile(
  fetcher: SubscriptionFetcher,
  profileUrl: string,
  accessToken: string,
  signal?: AbortSignal
): Promise<{ displayName?: string; email?: string; planTier?: string }> {
  try {
    const response = await fetcher(profileUrl, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
        "anthropic-beta": "oauth-2025-04-20",
        "User-Agent": CLAUDE_USER_AGENT
      },
      ...(signal ? { signal } : {})
    });
    if (!response.ok) return {};
    const data = (await response.json()) as unknown;
    if (!isRecord(data)) return {};
    const account = isRecord(data.account) ? data.account : data;
    const org = isRecord(data.organization) ? data.organization : undefined;
    const email =
      nonEmptyString(account.email) ?? nonEmptyString(account.email_address);
    const displayName =
      nonEmptyString(account.display_name) ??
      nonEmptyString(account.full_name) ??
      nonEmptyString(account.name) ??
      email;
    const planTier = formatClaudePlanTier(
      nonEmptyString(org?.organization_type) ??
        nonEmptyString(data.subscription_type) ??
        nonEmptyString(account.subscription_type),
      nonEmptyString(org?.rate_limit_tier) ??
        nonEmptyString(data.rate_limit_tier)
    );
    return {
      ...(displayName ? { displayName } : {}),
      ...(email ? { email } : {}),
      ...(planTier ? { planTier } : {})
    };
  } catch {
    return {};
  }
}

export function createAnthropicClaudeAdapter(
  options: AnthropicClaudeAdapterOptions = {}
): SubscriptionProviderAdapter {
  const ctx = resolveAdapterContext(options);
  const clientId = options.clientId ?? CLAUDE_CLIENT_ID;
  const authorizeUrl = options.authorizeUrl ?? CLAUDE_AUTHORIZE_URL;
  const tokenUrl = options.tokenUrl ?? CLAUDE_TOKEN_URL;
  const apiBaseUrl = (options.apiBaseUrl ?? CLAUDE_API_BASE_URL).replace(
    /\/+$/u,
    ""
  );
  const usageUrl = options.usageUrl ?? CLAUDE_USAGE_URL;
  const profileUrl = options.profileUrl ?? CLAUDE_PROFILE_URL;
  const preferredPort = options.preferredPort ?? 53692;
  const meta = DEFAULT_SUBSCRIPTION_PROVIDER_METADATA["anthropic-claude"];

  const readLocalClaudeCredentials = async () => {
    const claudeDir =
      nonEmptyString(ctx.env.CLAUDE_CONFIG_DIR) ??
      resolveHomeSubpath(ctx.homeDir, ".claude");
    const candidatePaths = [
      resolveHomeSubpath(claudeDir, ".credentials.json"),
      resolveHomeSubpath(claudeDir, "credentials.json")
    ];
    for (const credPath of candidatePaths) {
      const raw = await readJsonFileReadOnly(credPath);
      if (!isRecord(raw)) continue;
      const oauth = isRecord(raw.claudeAiOauth) ? raw.claudeAiOauth : raw;
      const accessToken =
        nonEmptyString(oauth.accessToken) ?? nonEmptyString(oauth.access_token);
      const refreshToken =
        nonEmptyString(oauth.refreshToken) ??
        nonEmptyString(oauth.refresh_token);
      if (!accessToken && !refreshToken) continue;

      const claims = decodeJwtPayload(accessToken);
      const email =
        nonEmptyString(oauth.email) ??
        nonEmptyString(raw.email) ??
        nonEmptyString(claims?.email);
      const displayName =
        nonEmptyString(oauth.displayName) ??
        nonEmptyString(oauth.name) ??
        email ??
        "Claude 订阅账号";
      const planTier = formatClaudePlanTier(
        nonEmptyString(oauth.subscriptionType) ??
          nonEmptyString(oauth.subscription_type),
        nonEmptyString(oauth.rateLimitTier) ??
          nonEmptyString(oauth.rate_limit_tier)
      );
      const expiresAt = toIsoExpiry(
        oauth.expiresAt ?? oauth.expires_at ?? claims?.exp,
        ctx.now()
      );
      return {
        credPath,
        accessToken: accessToken ?? "pending-refresh",
        ...(refreshToken ? { refreshToken } : {}),
        ...(expiresAt ? { expiresAt } : {}),
        ...(email ? { email } : {}),
        ...(planTier ? { planTier } : {}),
        displayName
      };
    }
    return undefined;
  };

  return {
    id: "anthropic-claude",
    meta,

    async startAuth(authCtx: AuthFlowContext): Promise<AuthFlowHandle> {
      const pkce = generatePkcePair();
      const state = generateOAuthState();
      const loopback = await ctx.startLoopback({
        state,
        callbackPath: "/callback",
        preferredPort,
        redirectHost: "localhost",
        allowDynamicFallback: true,
        signal: authCtx.signal
      });

      const authUrl = new URL(authorizeUrl);
      authUrl.searchParams.set("code", "true");
      authUrl.searchParams.set("client_id", clientId);
      authUrl.searchParams.set("response_type", "code");
      authUrl.searchParams.set("redirect_uri", loopback.redirectUri);
      authUrl.searchParams.set("scope", CLAUDE_OAUTH_SCOPES);
      authUrl.searchParams.set("code_challenge", pkce.codeChallenge);
      authUrl.searchParams.set(
        "code_challenge_method",
        pkce.codeChallengeMethod
      );
      authUrl.searchParams.set("state", state);

      const verificationUri = authUrl.toString();
      await authCtx.openExternalUrl(verificationUri);

      const completion = (async (): Promise<ImportedAccountResult> => {
        const callback = await loopback.waitForCallback;
        const response = await ctx.fetcher(tokenUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json"
          },
          body: JSON.stringify({
            grant_type: "authorization_code",
            client_id: clientId,
            code: callback.code,
            state,
            redirect_uri: loopback.redirectUri,
            code_verifier: pkce.codeVerifier
          }),
          signal: authCtx.signal
        });
        if (!response.ok) {
          throwHttpSubscriptionError(response.status, "Claude");
        }
        const data = (await response.json()) as unknown;
        if (!isRecord(data) || !nonEmptyString(data.access_token)) {
          throw new SubscriptionError(
            "subscriptions.oauth_exchange_failed",
            "Claude OAuth 未返回有效的访问令牌。"
          );
        }
        const accessToken = data.access_token as string;
        const refreshToken = nonEmptyString(data.refresh_token);
        const expiresAt =
          typeof data.expires_in === "number" && data.expires_in > 0
            ? new Date(
                ctx.now() + Math.max(60, data.expires_in - 300) * 1_000
              ).toISOString()
            : toIsoExpiry(data.expires_at, ctx.now());

        const tokenAccount = isRecord(data.account) ? data.account : undefined;
        const tokenOrg = isRecord(data.organization)
          ? data.organization
          : undefined;
        const profile = await fetchClaudeProfile(
          ctx.fetcher,
          profileUrl,
          accessToken,
          authCtx.signal
        );
        const email =
          nonEmptyString(tokenAccount?.email_address) ?? profile.email;
        const planTier =
          formatClaudePlanTier(
            nonEmptyString(tokenOrg?.organization_type),
            nonEmptyString(tokenOrg?.rate_limit_tier)
          ) ?? profile.planTier;
        const displayName = profile.displayName ?? email ?? "Claude 订阅账号";

        return {
          displayName,
          ...(email ? { email } : {}),
          ...(planTier ? { planTier } : {}),
          source: "oauth",
          secret: {
            accessToken,
            ...(refreshToken ? { refreshToken } : {}),
            ...(expiresAt ? { expiresAt } : {}),
            ...(planTier ? { extra: { planTier } } : {})
          }
        };
      })();

      return {
        method: "oauth",
        verificationUri,
        completion,
        cancel: () => loopback.close()
      };
    },

    async scanLocalCandidates(): Promise<LocalCredentialCandidate[]> {
      const local = await readLocalClaudeCredentials();
      if (!local) return [];
      return [
        {
          candidateId: CLAUDE_CANDIDATE_ID,
          provider: "anthropic-claude",
          displayName: local.displayName,
          ...(local.email ? { email: local.email } : {}),
          sourceLabel: "Claude Code 本地配置",
          sourcePathHint: maskPathHint(local.credPath, ctx.homeDir)
        }
      ];
    },

    async importLocalCandidate(
      candidateId: string
    ): Promise<ImportedAccountResult> {
      if (candidateId !== CLAUDE_CANDIDATE_ID) {
        throw new SubscriptionError(
          "subscriptions.candidate_not_found",
          "未找到指定的 Claude Code 本机凭证。"
        );
      }
      const local = await readLocalClaudeCredentials();
      if (!local) {
        throw new SubscriptionError(
          "subscriptions.candidate_not_found",
          "未在本机找到 ~/.claude/.credentials.json 凭证文件。"
        );
      }
      const profile =
        !local.email && local.accessToken !== "pending-refresh"
          ? await fetchClaudeProfile(ctx.fetcher, profileUrl, local.accessToken)
          : {};
      const email = local.email ?? profile.email;
      const planTier = local.planTier ?? profile.planTier;
      return {
        displayName:
          local.displayName !== "Claude 订阅账号"
            ? local.displayName
            : (profile.displayName ?? email ?? local.displayName),
        ...(email ? { email } : {}),
        ...(planTier ? { planTier } : {}),
        source: "local_import",
        secret: {
          accessToken: local.accessToken,
          ...(local.refreshToken ? { refreshToken: local.refreshToken } : {}),
          ...(local.expiresAt ? { expiresAt: local.expiresAt } : {}),
          ...(planTier ? { extra: { planTier } } : {})
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
          "当前 Claude 账号缺少刷新令牌，请重新登录。"
        );
      }
      const response = await ctx.fetcher(tokenUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        body: JSON.stringify({
          grant_type: "refresh_token",
          client_id: clientId,
          refresh_token: secret.refreshToken
        }),
        ...(signal ? { signal } : {})
      });
      if (!response.ok) {
        throwHttpSubscriptionError(response.status, "Claude");
      }
      const data = (await response.json()) as unknown;
      if (!isRecord(data) || !nonEmptyString(data.access_token)) {
        throw new SubscriptionError(
          "subscriptions.secret_refresh_failed",
          "Claude 刷新令牌响应缺少访问令牌。"
        );
      }
      const accessToken = data.access_token as string;
      const refreshToken =
        nonEmptyString(data.refresh_token) ?? secret.refreshToken;
      const expiresAt =
        typeof data.expires_in === "number" && data.expires_in > 0
          ? new Date(
              ctx.now() + Math.max(60, data.expires_in - 300) * 1_000
            ).toISOString()
          : (toIsoExpiry(data.expires_at, ctx.now()) ?? secret.expiresAt);
      return {
        ...secret,
        accessToken,
        refreshToken,
        ...(expiresAt ? { expiresAt } : {})
      };
    },

    async fetchQuota(
      account: StoredAccountRecord,
      secret: StoredAccountSecret,
      signal?: AbortSignal
    ): Promise<QuotaFetchResult> {
      const response = await ctx.fetcher(usageUrl, {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${secret.accessToken}`,
          "anthropic-beta": "oauth-2025-04-20",
          "User-Agent": CLAUDE_USER_AGENT
        },
        ...(signal ? { signal } : {})
      });
      if (!response.ok) {
        throwHttpSubscriptionError(response.status, "Claude");
      }
      const data = (await response.json()) as unknown;
      if (!isRecord(data)) {
        return { quotaBuckets: [] };
      }
      const buckets: SubscriptionQuotaBucket[] = [];
      const fromLimits = extractClaudeLimitsBuckets(data.limits);
      const fiveHour =
        fromLimits.fiveHour ??
        parseClaudeWindowBucket("claude-5h", "5 小时限流窗口", data.five_hour);
      if (fiveHour) buckets.push(fiveHour);
      const sevenDay =
        fromLimits.sevenDay ??
        parseClaudeWindowBucket("claude-7d", "7 天限流窗口", data.seven_day);
      if (sevenDay) buckets.push(sevenDay);
      const sevenDaySonnet =
        fromLimits.sevenDaySonnet ??
        parseClaudeWindowBucket(
          "claude-7d-sonnet",
          "7 天 Sonnet 窗口",
          data.seven_day_sonnet
        );
      if (sevenDaySonnet) buckets.push(sevenDaySonnet);
      const sevenDayOpus =
        fromLimits.sevenDayOpus ??
        parseClaudeWindowBucket(
          "claude-7d-opus",
          "7 天 Opus 窗口",
          data.seven_day_opus
        );
      if (sevenDayOpus) buckets.push(sevenDayOpus);
      const extraUsage = parseExtraUsageBucket(data.extra_usage);
      if (extraUsage) buckets.push(extraUsage);

      const planTier =
        formatClaudePlanTier(
          nonEmptyString(data.subscription_type) ?? nonEmptyString(data.plan),
          nonEmptyString(data.rate_limit_tier)
        ) ??
        secret.extra?.planTier ??
        account.planTier;

      const blockedBuckets = [fiveHour, sevenDay].filter(
        (b): b is SubscriptionQuotaBucket =>
          b !== undefined &&
          b.remainingPercent !== undefined &&
          b.remainingPercent <= 0
      );
      const exhausted = blockedBuckets.length > 0;
      const earliestReset = blockedBuckets
        .map((b) => b.resetsAt)
        .filter((v): v is string => Boolean(v))
        .sort()[0];

      return {
        ...(planTier ? { planTier } : {}),
        quotaBuckets: buckets,
        status: exhausted ? "quota_exhausted" : "active",
        ...(exhausted && earliestReset ? { cooldownUntil: earliestReset } : {})
      };
    },

    async listModels(
      _account,
      secret,
      signal
    ): Promise<SubscriptionModelDefinition[]> {
      const token = secret?.accessToken?.trim();
      if (!token || token === "pending-refresh") {
        return [...ANTHROPIC_CLAUDE_BASELINE_MODELS];
      }
      try {
        const response = await ctx.fetcher(
          `${apiBaseUrl.replace(/\/+$/u, "")}/v1/models?limit=100`,
          {
            method: "GET",
            headers: {
              Accept: "application/json",
              Authorization: `Bearer ${token}`,
              "anthropic-version": "2023-06-01",
              "anthropic-beta": "oauth-2025-04-20",
              "User-Agent": CLAUDE_USER_AGENT,
              "x-app": "cli"
            },
            ...(signal ? { signal } : {})
          }
        );
        if (!response.ok) {
          return [...ANTHROPIC_CLAUDE_BASELINE_MODELS];
        }
        const raw = (await response.json()) as unknown;
        if (!isRecord(raw) || !Array.isArray(raw.data)) {
          return [...ANTHROPIC_CLAUDE_BASELINE_MODELS];
        }
        const byBaseline = new Map(
          ANTHROPIC_CLAUDE_BASELINE_MODELS.map((item) => [item.modelId, item])
        );
        const models: SubscriptionModelDefinition[] = [];
        for (const item of raw.data) {
          if (!isRecord(item)) continue;
          const modelId = nonEmptyString(item.id);
          if (!modelId || !/^claude-/iu.test(modelId)) continue;
          const id = `sub:anthropic-claude:${modelId.toLowerCase()}`;
          if (id.length > 120) continue;
          const baseline = byBaseline.get(modelId);
          const maxInput =
            typeof item.max_input_tokens === "number" &&
            item.max_input_tokens >= 1_024
              ? item.max_input_tokens
              : undefined;
          const maxOutput =
            typeof item.max_tokens === "number" && item.max_tokens >= 1
              ? item.max_tokens
              : undefined;
          models.push({
            ...(baseline ?? {
              id,
              provider: "anthropic-claude",
              modelId,
              label: nonEmptyString(item.display_name) ?? modelId,
              api: "anthropic-messages",
              baseUrl: apiBaseUrl,
              reasoning: true,
              defaultThinkingLevel: /opus/iu.test(modelId)
                ? "high"
                : /haiku/iu.test(modelId)
                  ? "low"
                  : "medium",
              thinkingLevelOptions: ["low", "medium", "high", "max"],
              contextWindow: maxInput ?? 200_000,
              maxTokens: maxOutput ?? 64_000,
              recommended: models.length === 0
            }),
            ...(maxInput ? { contextWindow: maxInput } : {}),
            ...(maxOutput ? { maxTokens: maxOutput } : {}),
            baseUrl: apiBaseUrl
          });
        }
        if (models.length === 0) {
          return [...ANTHROPIC_CLAUDE_BASELINE_MODELS];
        }
        if (!models.some((m) => m.recommended)) {
          models[0] = { ...models[0]!, recommended: true };
        }
        return models;
      } catch {
        return [...ANTHROPIC_CLAUDE_BASELINE_MODELS];
      }
    },

    toRuntimeCredential(account, secret) {
      return {
        provider: "anthropic-claude",
        accountId: account.id,
        apiKey: secret.accessToken,
        baseUrl: apiBaseUrl,
        ...(secret.expiresAt ? { expiresAt: secret.expiresAt } : {}),
        extraHeaders: {
          "x-app": "cli"
        }
      };
    }
  };
}
