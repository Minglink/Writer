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
  type ProviderEnvironmentOptions
} from "./shared";

const CODEX_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const CODEX_AUTH_BASE_URL = "https://auth.openai.com";
const CODEX_BASE_URL = "https://chatgpt.com/backend-api";
const CODEX_SCOPE = "openid profile email offline_access";
const OPENAI_AUTH_CLAIM = "https://api.openai.com/auth";
const CODEX_CANDIDATE_ID = "codex:default";

export interface OpenAICodexAdapterOptions extends ProviderEnvironmentOptions {
  clientId?: string;
  authBaseUrl?: string;
  apiBaseUrl?: string;
  preferredPort?: number;
}

export const OPENAI_CODEX_BASELINE_MODELS: readonly SubscriptionModelDefinition[] =
  [
    {
      id: "sub:openai-codex:gpt-6.2-astra",
      provider: "openai-codex",
      modelId: "gpt-6.2-astra",
      label: "GPT-6.2 Astra",
      description: "ChatGPT / Codex 订阅最新旗舰推理与创作模型",
      api: "openai-codex-responses",
      baseUrl: CODEX_BASE_URL,
      reasoning: true,
      defaultThinkingLevel: "medium",
      thinkingLevelOptions: ["low", "medium", "high", "xhigh", "max"],
      contextWindow: 1_050_000,
      maxTokens: 128_000,
      recommended: true
    },
    {
      id: "sub:openai-codex:gpt-6.2-sol",
      provider: "openai-codex",
      modelId: "gpt-6.2-sol",
      label: "GPT-6.2 Sol",
      api: "openai-codex-responses",
      baseUrl: CODEX_BASE_URL,
      reasoning: true,
      defaultThinkingLevel: "medium",
      thinkingLevelOptions: ["low", "medium", "high", "xhigh", "max"],
      contextWindow: 1_050_000,
      maxTokens: 128_000,
      recommended: false
    },
    {
      id: "sub:openai-codex:gpt-6.1-sol",
      provider: "openai-codex",
      modelId: "gpt-6.1-sol",
      label: "GPT-6.1 Sol",
      api: "openai-codex-responses",
      baseUrl: CODEX_BASE_URL,
      reasoning: true,
      defaultThinkingLevel: "medium",
      thinkingLevelOptions: ["low", "medium", "high", "xhigh", "max"],
      contextWindow: 272_000,
      maxTokens: 128_000,
      recommended: false
    },
    {
      id: "sub:openai-codex:gpt-6-astra",
      provider: "openai-codex",
      modelId: "gpt-6-astra",
      label: "GPT-6 Astra",
      api: "openai-codex-responses",
      baseUrl: CODEX_BASE_URL,
      reasoning: true,
      defaultThinkingLevel: "medium",
      thinkingLevelOptions: ["low", "medium", "high", "xhigh", "max"],
      contextWindow: 272_000,
      maxTokens: 128_000,
      recommended: false
    },
    {
      id: "sub:openai-codex:gpt-6-luna",
      provider: "openai-codex",
      modelId: "gpt-6-luna",
      label: "GPT-6 Luna",
      api: "openai-codex-responses",
      baseUrl: CODEX_BASE_URL,
      reasoning: true,
      defaultThinkingLevel: "low",
      thinkingLevelOptions: ["low", "medium", "high", "xhigh"],
      contextWindow: 272_000,
      maxTokens: 128_000,
      recommended: false
    },
    {
      id: "sub:openai-codex:gpt-5.3-codex",
      provider: "openai-codex",
      modelId: "gpt-5.3-codex",
      label: "GPT-5.3 Codex",
      api: "openai-codex-responses",
      baseUrl: CODEX_BASE_URL,
      reasoning: true,
      defaultThinkingLevel: "medium",
      thinkingLevelOptions: ["low", "medium", "high", "xhigh"],
      contextWindow: 400_000,
      maxTokens: 128_000,
      recommended: false
    }
  ];

function formatCodexPlanTier(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const lower = raw.trim().toLowerCase();
  if (lower === "plus") return "Plus";
  if (lower === "pro") return "Pro";
  if (lower === "team") return "Team";
  if (lower === "enterprise") return "Enterprise";
  if (lower === "free") return "Free";
  return raw;
}

function extractCodexClaims(
  accessToken: string | undefined,
  idToken?: string
): {
  chatgptAccountId?: string;
  email?: string;
  displayName?: string;
  planTier?: string;
  expiresAt?: string;
} {
  const accessPayload = decodeJwtPayload(accessToken);
  const idPayload = decodeJwtPayload(idToken);
  const accessAuth = isRecord(accessPayload?.[OPENAI_AUTH_CLAIM])
    ? (accessPayload?.[OPENAI_AUTH_CLAIM] as Record<string, unknown>)
    : undefined;
  const idAuth = isRecord(idPayload?.[OPENAI_AUTH_CLAIM])
    ? (idPayload?.[OPENAI_AUTH_CLAIM] as Record<string, unknown>)
    : undefined;
  const chatgptAccountId =
    nonEmptyString(accessAuth?.chatgpt_account_id) ??
    nonEmptyString(idAuth?.chatgpt_account_id);
  const planTier = formatCodexPlanTier(
    nonEmptyString(accessAuth?.chatgpt_plan_type) ??
      nonEmptyString(idAuth?.chatgpt_plan_type)
  );
  const email =
    nonEmptyString(idPayload?.email) ??
    nonEmptyString(accessPayload?.email) ??
    (isRecord(accessPayload?.["https://api.openai.com/profile"])
      ? nonEmptyString(
          (
            accessPayload["https://api.openai.com/profile"] as Record<
              string,
              unknown
            >
          ).email
        )
      : undefined);
  const displayName =
    nonEmptyString(idPayload?.name) ??
    nonEmptyString(accessPayload?.name) ??
    email;
  const expiresAt = toIsoExpiry(accessPayload?.exp);
  return {
    ...(chatgptAccountId ? { chatgptAccountId } : {}),
    ...(email ? { email } : {}),
    ...(displayName ? { displayName } : {}),
    ...(planTier ? { planTier } : {}),
    ...(expiresAt ? { expiresAt } : {})
  };
}

function parseCodexWindowBucket(
  id: string,
  label: string,
  window: unknown
): SubscriptionQuotaBucket | undefined {
  if (!isRecord(window)) return undefined;
  const usedPercent =
    typeof window.used_percent === "number" &&
    Number.isFinite(window.used_percent)
      ? Math.min(100, Math.max(0, window.used_percent))
      : undefined;
  const resetsAt =
    toIsoExpiry(window.reset_at) ??
    (typeof window.reset_after_seconds === "number"
      ? new Date(Date.now() + window.reset_after_seconds * 1_000).toISOString()
      : undefined);
  if (usedPercent === undefined && !resetsAt) return undefined;
  return {
    id,
    label,
    ...(usedPercent !== undefined
      ? { remainingPercent: 100 - usedPercent }
      : {}),
    ...(resetsAt ? { resetsAt } : {})
  };
}

export function createOpenAICodexAdapter(
  options: OpenAICodexAdapterOptions = {}
): SubscriptionProviderAdapter {
  const ctx = resolveAdapterContext(options);
  const clientId = options.clientId ?? CODEX_CLIENT_ID;
  const authBaseUrl = (options.authBaseUrl ?? CODEX_AUTH_BASE_URL).replace(
    /\/+$/u,
    ""
  );
  const apiBaseUrl = (options.apiBaseUrl ?? CODEX_BASE_URL).replace(
    /\/+$/u,
    ""
  );
  const preferredPort = options.preferredPort ?? 1455;
  const meta = DEFAULT_SUBSCRIPTION_PROVIDER_METADATA["openai-codex"];

  const readLocalCodexAuth = async () => {
    const codexHome =
      nonEmptyString(ctx.env.CODEX_HOME) ??
      resolveHomeSubpath(ctx.homeDir, ".codex");
    const authPath = resolveHomeSubpath(codexHome, "auth.json");
    const raw = await readJsonFileReadOnly(authPath);
    if (!isRecord(raw)) return undefined;

    const tokens = isRecord(raw.tokens) ? raw.tokens : raw;
    const accessToken =
      nonEmptyString(tokens.access_token) ?? nonEmptyString(tokens.accessToken);
    const refreshToken =
      nonEmptyString(tokens.refresh_token) ??
      nonEmptyString(tokens.refreshToken);
    if (!accessToken && !refreshToken) return undefined;

    const idToken =
      nonEmptyString(tokens.id_token) ?? nonEmptyString(tokens.idToken);
    const claims = extractCodexClaims(accessToken, idToken);
    const accountId =
      nonEmptyString(tokens.account_id) ??
      nonEmptyString(tokens.accountId) ??
      claims.chatgptAccountId;

    return {
      authPath,
      accessToken: accessToken ?? "",
      ...(refreshToken ? { refreshToken } : {}),
      ...(idToken ? { idToken } : {}),
      ...(accountId ? { chatgptAccountId: accountId } : {}),
      ...(claims.email ? { email: claims.email } : {}),
      ...(claims.planTier ? { planTier: claims.planTier } : {}),
      ...(claims.expiresAt ? { expiresAt: claims.expiresAt } : {}),
      displayName: claims.displayName ?? claims.email ?? "OpenAI Codex 账号"
    };
  };

  return {
    id: "openai-codex",
    meta,

    async startAuth(authCtx: AuthFlowContext): Promise<AuthFlowHandle> {
      const pkce = generatePkcePair();
      const state = generateOAuthState();
      const loopback = await ctx.startLoopback({
        state,
        callbackPath: "/auth/callback",
        preferredPort,
        redirectHost: "localhost",
        allowDynamicFallback: false,
        signal: authCtx.signal
      });

      const authUrl = new URL(`${authBaseUrl}/oauth/authorize`);
      authUrl.searchParams.set("response_type", "code");
      authUrl.searchParams.set("client_id", clientId);
      authUrl.searchParams.set("redirect_uri", loopback.redirectUri);
      authUrl.searchParams.set("scope", CODEX_SCOPE);
      authUrl.searchParams.set("code_challenge", pkce.codeChallenge);
      authUrl.searchParams.set(
        "code_challenge_method",
        pkce.codeChallengeMethod
      );
      authUrl.searchParams.set("state", state);
      authUrl.searchParams.set("id_token_add_organizations", "true");
      authUrl.searchParams.set("codex_cli_simplified_flow", "true");
      authUrl.searchParams.set("originator", "pi");

      const verificationUri = authUrl.toString();
      await authCtx.openExternalUrl(verificationUri);

      const completion = (async (): Promise<ImportedAccountResult> => {
        const callback = await loopback.waitForCallback;
        const response = await ctx.fetcher(`${authBaseUrl}/oauth/token`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            grant_type: "authorization_code",
            client_id: clientId,
            code: callback.code,
            code_verifier: pkce.codeVerifier,
            redirect_uri: loopback.redirectUri
          }),
          signal: authCtx.signal
        });
        if (!response.ok) {
          throwHttpSubscriptionError(response.status, "OpenAI Codex");
        }
        const data = (await response.json()) as unknown;
        if (!isRecord(data) || !nonEmptyString(data.access_token)) {
          throw new SubscriptionError(
            "subscriptions.oauth_exchange_failed",
            "OpenAI Codex OAuth 未返回有效的访问令牌。"
          );
        }
        const accessToken = data.access_token as string;
        const refreshToken = nonEmptyString(data.refresh_token);
        const idToken = nonEmptyString(data.id_token);
        const claims = extractCodexClaims(accessToken, idToken);
        const expiresAt =
          toIsoExpiry(data.expires_in, ctx.now()) ?? claims.expiresAt;

        return {
          displayName:
            claims.displayName ?? claims.email ?? "OpenAI Codex 账号",
          ...(claims.email ? { email: claims.email } : {}),
          ...(claims.planTier ? { planTier: claims.planTier } : {}),
          source: "oauth",
          secret: {
            accessToken,
            ...(refreshToken ? { refreshToken } : {}),
            ...(idToken ? { idToken } : {}),
            ...(expiresAt ? { expiresAt } : {}),
            ...(claims.chatgptAccountId
              ? { extra: { chatgptAccountId: claims.chatgptAccountId } }
              : {})
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
      const local = await readLocalCodexAuth();
      if (!local) return [];
      return [
        {
          candidateId: CODEX_CANDIDATE_ID,
          provider: "openai-codex",
          displayName: local.displayName,
          ...(local.email ? { email: local.email } : {}),
          sourceLabel: "Codex CLI 本地配置",
          sourcePathHint: maskPathHint(local.authPath, ctx.homeDir)
        }
      ];
    },

    async importLocalCandidate(
      candidateId: string
    ): Promise<ImportedAccountResult> {
      if (candidateId !== CODEX_CANDIDATE_ID) {
        throw new SubscriptionError(
          "subscriptions.candidate_not_found",
          "未找到指定的 Codex CLI 本机凭证。"
        );
      }
      const local = await readLocalCodexAuth();
      if (!local) {
        throw new SubscriptionError(
          "subscriptions.candidate_not_found",
          "未在本机找到 ~/.codex/auth.json 凭证文件。"
        );
      }
      return {
        displayName: local.displayName,
        ...(local.email ? { email: local.email } : {}),
        ...(local.planTier ? { planTier: local.planTier } : {}),
        source: "local_import",
        secret: {
          accessToken: local.accessToken || "pending-refresh",
          ...(local.refreshToken ? { refreshToken: local.refreshToken } : {}),
          ...(local.idToken ? { idToken: local.idToken } : {}),
          ...(local.expiresAt ? { expiresAt: local.expiresAt } : {}),
          ...(local.chatgptAccountId
            ? { extra: { chatgptAccountId: local.chatgptAccountId } }
            : {})
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
          "当前 OpenAI Codex 账号缺少刷新令牌，请重新登录。"
        );
      }
      const response = await ctx.fetcher(`${authBaseUrl}/oauth/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: secret.refreshToken,
          client_id: clientId
        }),
        ...(signal ? { signal } : {})
      });
      if (!response.ok) {
        throwHttpSubscriptionError(response.status, "OpenAI Codex");
      }
      const data = (await response.json()) as unknown;
      if (!isRecord(data) || !nonEmptyString(data.access_token)) {
        throw new SubscriptionError(
          "subscriptions.secret_refresh_failed",
          "OpenAI Codex 刷新令牌响应缺少访问令牌。"
        );
      }
      const accessToken = data.access_token as string;
      const refreshToken =
        nonEmptyString(data.refresh_token) ?? secret.refreshToken;
      const idToken = nonEmptyString(data.id_token) ?? secret.idToken;
      const claims = extractCodexClaims(accessToken, idToken);
      const expiresAt =
        toIsoExpiry(data.expires_in, ctx.now()) ??
        claims.expiresAt ??
        secret.expiresAt;
      const chatgptAccountId =
        claims.chatgptAccountId ?? secret.extra?.chatgptAccountId;
      return {
        ...secret,
        accessToken,
        refreshToken,
        ...(idToken ? { idToken } : {}),
        ...(expiresAt ? { expiresAt } : {}),
        ...(chatgptAccountId
          ? { extra: { ...(secret.extra ?? {}), chatgptAccountId } }
          : {})
      };
    },

    async fetchQuota(
      _account: StoredAccountRecord,
      secret: StoredAccountSecret,
      signal?: AbortSignal
    ): Promise<QuotaFetchResult> {
      const headers: Record<string, string> = {
        Accept: "application/json",
        Authorization: `Bearer ${secret.accessToken}`
      };
      if (secret.extra?.chatgptAccountId) {
        headers["chatgpt-account-id"] = secret.extra.chatgptAccountId;
      }
      const response = await ctx.fetcher(`${apiBaseUrl}/wham/usage`, {
        method: "GET",
        headers,
        ...(signal ? { signal } : {})
      });
      if (!response.ok) {
        throwHttpSubscriptionError(response.status, "OpenAI Codex");
      }
      const data = (await response.json()) as unknown;
      if (!isRecord(data)) {
        return { quotaBuckets: [] };
      }
      const planTier = formatCodexPlanTier(nonEmptyString(data.plan_type));
      const rateLimit = isRecord(data.rate_limit) ? data.rate_limit : undefined;
      const buckets: SubscriptionQuotaBucket[] = [];
      const primary = parseCodexWindowBucket(
        "codex-5h",
        "5 小时窗口",
        rateLimit?.primary_window
      );
      if (primary) buckets.push(primary);
      const secondary = parseCodexWindowBucket(
        "codex-weekly",
        "每周限额窗口",
        rateLimit?.secondary_window
      );
      if (secondary) buckets.push(secondary);

      const limitReached = rateLimit?.limit_reached === true;
      const earliestReset =
        primary?.remainingPercent === 0
          ? primary.resetsAt
          : secondary?.remainingPercent === 0
            ? secondary.resetsAt
            : undefined;
      return {
        ...(planTier ? { planTier } : {}),
        quotaBuckets: buckets,
        status: limitReached ? "quota_exhausted" : "active",
        ...(limitReached && earliestReset
          ? { cooldownUntil: earliestReset }
          : {})
      };
    },

    async listModels(
      _account,
      secret,
      signal
    ): Promise<SubscriptionModelDefinition[]> {
      const token = secret?.accessToken?.trim();
      if (!token || token === "pending-refresh") {
        return [...OPENAI_CODEX_BASELINE_MODELS];
      }
      const claims = extractCodexClaims(token, secret?.idToken);
      const chatgptAccountId =
        secret?.extra?.chatgptAccountId ?? claims.chatgptAccountId;
      try {
        const response = await ctx.fetcher(
          `${apiBaseUrl.replace(/\/+$/u, "")}/codex/models?client_version=0.172.0`,
          {
            method: "GET",
            headers: {
              Accept: "application/json",
              Authorization: `Bearer ${token}`,
              ...(chatgptAccountId
                ? { "chatgpt-account-id": chatgptAccountId }
                : {})
            },
            ...(signal ? { signal } : {})
          }
        );
        if (!response.ok) {
          return [...OPENAI_CODEX_BASELINE_MODELS];
        }
        const raw = (await response.json()) as unknown;
        const list =
          isRecord(raw) && Array.isArray(raw.models)
            ? raw.models
            : isRecord(raw) && Array.isArray(raw.data)
              ? raw.data
              : [];
        if (list.length === 0) {
          return [...OPENAI_CODEX_BASELINE_MODELS];
        }
        const byBaseline = new Map(
          OPENAI_CODEX_BASELINE_MODELS.map((item) => [item.modelId, item])
        );
        const models: SubscriptionModelDefinition[] = [];
        for (const item of list) {
          if (!isRecord(item)) continue;
          if (item.visibility === "hide" || item.supported_in_api === false) {
            continue;
          }
          const modelId = nonEmptyString(item.slug) ?? nonEmptyString(item.id);
          if (!modelId) continue;
          const id = `sub:openai-codex:${modelId.toLowerCase()}`;
          if (id.length > 120) continue;
          const baseline = byBaseline.get(modelId);
          const ctxWindow =
            typeof item.context_window === "number" &&
            item.context_window >= 1_024
              ? item.context_window
              : undefined;
          const maxOut =
            typeof item.max_output_tokens === "number" &&
            item.max_output_tokens >= 1
              ? item.max_output_tokens
              : undefined;
          const rawLevels = Array.isArray(item.supported_reasoning_levels)
            ? item.supported_reasoning_levels
                .map((entry) =>
                  typeof entry === "string"
                    ? entry.trim()
                    : isRecord(entry)
                      ? nonEmptyString(entry.effort)
                      : undefined
                )
                .filter(
                  (v): v is string =>
                    Boolean(v) &&
                    [
                      "minimal",
                      "low",
                      "medium",
                      "high",
                      "xhigh",
                      "max"
                    ].includes(v!)
                )
            : [];
          const levels =
            rawLevels.length > 0
              ? ([
                  ...new Set(rawLevels)
                ] as SubscriptionModelDefinition["thinkingLevelOptions"])
              : undefined;
          const defaultEffort = nonEmptyString(item.default_reasoning_level);
          const validDefault =
            defaultEffort && levels?.includes(defaultEffort)
              ? defaultEffort
              : levels?.[0];
          const description = nonEmptyString(item.description);
          models.push({
            ...(baseline ?? {
              id,
              provider: "openai-codex",
              modelId,
              label: nonEmptyString(item.display_name) ?? modelId,
              ...(description ? { description } : {}),
              api: "openai-codex-responses",
              baseUrl: apiBaseUrl,
              reasoning: true,
              defaultThinkingLevel:
                (validDefault as SubscriptionModelDefinition["defaultThinkingLevel"]) ??
                "medium",
              thinkingLevelOptions: levels ?? [
                "low",
                "medium",
                "high",
                "xhigh"
              ],
              contextWindow: ctxWindow ?? 272_000,
              maxTokens: maxOut ?? 128_000,
              recommended: models.length === 0
            }),
            ...(ctxWindow ? { contextWindow: ctxWindow } : {}),
            ...(maxOut ? { maxTokens: maxOut } : {}),
            ...(levels ? { thinkingLevelOptions: levels } : {}),
            ...(validDefault
              ? {
                  defaultThinkingLevel:
                    validDefault as SubscriptionModelDefinition["defaultThinkingLevel"]
                }
              : {}),
            baseUrl: apiBaseUrl
          });
        }
        if (models.length === 0) {
          return [...OPENAI_CODEX_BASELINE_MODELS];
        }
        if (!models.some((m) => m.recommended)) {
          models[0] = { ...models[0]!, recommended: true };
        }
        return models;
      } catch {
        return [...OPENAI_CODEX_BASELINE_MODELS];
      }
    },

    toRuntimeCredential(account, secret) {
      const claims = extractCodexClaims(secret.accessToken, secret.idToken);
      const chatgptAccountId =
        secret.extra?.chatgptAccountId ?? claims.chatgptAccountId;
      return {
        provider: "openai-codex",
        accountId: account.id,
        apiKey: secret.accessToken,
        baseUrl: apiBaseUrl,
        ...(secret.expiresAt ? { expiresAt: secret.expiresAt } : {}),
        ...(chatgptAccountId
          ? { extraHeaders: { "chatgpt-account-id": chatgptAccountId } }
          : {})
      };
    }
  };
}
