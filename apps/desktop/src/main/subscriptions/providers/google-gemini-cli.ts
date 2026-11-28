import type { SubscriptionQuotaBucket } from "@writer/contracts";
import { generateOAuthState, generatePkcePair } from "../oauth-loopback";
import {
  exchangeGoogleLoginCode,
  googleOAuthClient,
  resolveGoogleOAuthClient,
  type GoogleOAuthClientConfig
} from "./google-oauth";
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

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo";
const CLOUD_CODE_ASSIST_BASE_URL = "https://cloudcode-pa.googleapis.com";
const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/cloud-platform",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile"
].join(" ");
const GEMINI_CLI_CANDIDATE_ID = "gemini-cli:default";

export interface GoogleGeminiCliAdapterOptions extends ProviderEnvironmentOptions {
  oauthClient?: GoogleOAuthClientConfig;
  bundledOAuthClient?: GoogleOAuthClientConfig | undefined;
  authBaseUrl?: string;
  tokenUrl?: string;
  userInfoUrl?: string;
  cloudCodeBaseUrl?: string;
}

export const GEMINI_CLI_BASELINE_MODELS: readonly SubscriptionModelDefinition[] =
  [
    {
      id: "sub:google-gemini-cli:gemini-3.5-flash",
      provider: "google-gemini-cli",
      modelId: "gemini-3.5-flash",
      label: "Gemini 3.5 Flash",
      api: "google-cloud-code-assist",
      baseUrl: CLOUD_CODE_ASSIST_BASE_URL,
      reasoning: true,
      defaultThinkingLevel: "medium",
      thinkingLevelOptions: ["minimal", "low", "medium", "high"],
      contextWindow: 1_048_576,
      maxTokens: 65_536,
      recommended: true
    },
    {
      id: "sub:google-gemini-cli:gemini-3.1-pro-preview",
      provider: "google-gemini-cli",
      modelId: "gemini-3.1-pro-preview",
      label: "Gemini 3.1 Pro Preview",
      api: "google-cloud-code-assist",
      baseUrl: CLOUD_CODE_ASSIST_BASE_URL,
      reasoning: true,
      defaultThinkingLevel: "medium",
      thinkingLevelOptions: ["minimal", "low", "medium", "high"],
      contextWindow: 1_048_576,
      maxTokens: 65_536,
      recommended: false
    }
  ];

function resolveGeminiOAuthClient(
  options: GoogleGeminiCliAdapterOptions,
  env: NodeJS.ProcessEnv,
  extra?: Record<string, string>
): GoogleOAuthClientConfig | undefined {
  return resolveGoogleOAuthClient(
    extra,
    options.oauthClient,
    googleOAuthClient(
      env.WRITER_GOOGLE_GEMINI_CLIENT_ID,
      env.WRITER_GOOGLE_GEMINI_CLIENT_SECRET
    ),
    googleOAuthClient(
      env.GEMINI_CLI_OAUTH_CLIENT_ID,
      env.GEMINI_CLI_OAUTH_CLIENT_SECRET
    ),
    options.bundledOAuthClient
  );
}

function formatGoogleTier(rawTier: unknown): string | undefined {
  const id = isRecord(rawTier)
    ? (nonEmptyString(rawTier.id) ?? nonEmptyString(rawTier.name))
    : nonEmptyString(rawTier);
  if (!id) return undefined;
  const lower = id.toLowerCase();
  if (lower.includes("ultra")) return "Ultra";
  if (lower.includes("pro") || lower.includes("standard")) return "Pro";
  if (lower.includes("free") || lower.includes("legacy")) return "Free";
  return id;
}

async function fetchGoogleUserInfo(
  fetcher: SubscriptionFetcher,
  userInfoUrl: string,
  accessToken: string,
  signal?: AbortSignal
): Promise<{ email?: string; displayName?: string }> {
  try {
    const response = await fetcher(userInfoUrl, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`
      },
      ...(signal ? { signal } : {})
    });
    if (!response.ok) return {};
    const data = (await response.json()) as unknown;
    if (!isRecord(data)) return {};
    const email = nonEmptyString(data.email);
    const displayName = nonEmptyString(data.name) ?? email;
    return {
      ...(email ? { email } : {}),
      ...(displayName ? { displayName } : {})
    };
  } catch {
    return {};
  }
}

async function onboardCodeAssistUser(
  fetcher: SubscriptionFetcher,
  cloudCodeBaseUrl: string,
  accessToken: string,
  tierId: string,
  signal?: AbortSignal
): Promise<string | undefined> {
  try {
    const response = await fetcher(
      `${cloudCodeBaseUrl.replace(/\/+$/u, "")}/v1internal:onboardUser`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Authorization: `Bearer ${accessToken}`
        },
        body: JSON.stringify({
          tierId,
          metadata: {
            ideType: "IDE_UNSPECIFIED",
            platform: "PLATFORM_UNSPECIFIED",
            pluginType: "GEMINI"
          }
        }),
        ...(signal ? { signal } : {})
      }
    );
    if (!response.ok) return undefined;
    const data = (await response.json()) as unknown;
    if (!isRecord(data)) return undefined;
    const nested = isRecord(data.response) ? data.response : data;
    return (
      nonEmptyString(nested.cloudaicompanionProject) ??
      (isRecord(nested.cloudaicompanionProject)
        ? nonEmptyString(nested.cloudaicompanionProject.id)
        : undefined)
    );
  } catch {
    return undefined;
  }
}

async function loadCodeAssistMetadata(
  fetcher: SubscriptionFetcher,
  cloudCodeBaseUrl: string,
  accessToken: string,
  signal?: AbortSignal
): Promise<{ projectId?: string; planTier?: string }> {
  try {
    const response = await fetcher(
      `${cloudCodeBaseUrl.replace(/\/+$/u, "")}/v1internal:loadCodeAssist`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Authorization: `Bearer ${accessToken}`
        },
        body: JSON.stringify({
          metadata: {
            ideType: "IDE_UNSPECIFIED",
            platform: "PLATFORM_UNSPECIFIED",
            pluginType: "GEMINI"
          }
        }),
        ...(signal ? { signal } : {})
      }
    );
    if (!response.ok) return {};
    const data = (await response.json()) as unknown;
    if (!isRecord(data)) return {};
    let projectId =
      nonEmptyString(data.cloudaicompanionProject) ??
      (isRecord(data.cloudaicompanionProject)
        ? nonEmptyString(data.cloudaicompanionProject.id)
        : undefined);
    const planTier =
      formatGoogleTier(data.paidTier) ?? formatGoogleTier(data.currentTier);
    if (!projectId && Array.isArray(data.allowedTiers)) {
      const defaultTier = data.allowedTiers.find(
        (item) =>
          isRecord(item) && item.isDefault === true && nonEmptyString(item.id)
      );
      const fallbackTier = data.allowedTiers.find(
        (item) => isRecord(item) && nonEmptyString(item.id)
      );
      const tierId =
        (isRecord(defaultTier) ? nonEmptyString(defaultTier.id) : undefined) ??
        (isRecord(fallbackTier) ? nonEmptyString(fallbackTier.id) : undefined);
      if (tierId) {
        projectId = await onboardCodeAssistUser(
          fetcher,
          cloudCodeBaseUrl,
          accessToken,
          tierId,
          signal
        );
      }
    }
    return {
      ...(projectId ? { projectId } : {}),
      ...(planTier ? { planTier } : {})
    };
  } catch {
    return {};
  }
}

function parseCodeAssistQuotaBuckets(raw: unknown): SubscriptionQuotaBucket[] {
  if (!isRecord(raw) || !Array.isArray(raw.buckets)) return [];
  const buckets: SubscriptionQuotaBucket[] = [];
  for (const item of raw.buckets) {
    if (!isRecord(item)) continue;
    const modelId = nonEmptyString(item.modelId) ?? "gemini";
    const fraction =
      typeof item.remainingFraction === "number" &&
      Number.isFinite(item.remainingFraction)
        ? Math.min(1, Math.max(0, item.remainingFraction))
        : undefined;
    const resetsAt = toIsoExpiry(item.resetTime);
    buckets.push({
      id: modelId.slice(0, 80),
      label: modelId,
      ...(fraction !== undefined ? { remainingPercent: fraction * 100 } : {}),
      ...(resetsAt ? { resetsAt } : {})
    });
  }
  return buckets.slice(0, 20);
}

export function createGoogleGeminiCliAdapter(
  options: GoogleGeminiCliAdapterOptions = {}
): SubscriptionProviderAdapter {
  const ctx = resolveAdapterContext(options);
  const authBaseUrl = options.authBaseUrl ?? GOOGLE_AUTH_URL;
  const tokenUrl = options.tokenUrl ?? GOOGLE_TOKEN_URL;
  const userInfoUrl = options.userInfoUrl ?? GOOGLE_USERINFO_URL;
  const cloudCodeBaseUrl =
    options.cloudCodeBaseUrl ?? CLOUD_CODE_ASSIST_BASE_URL;
  const meta = DEFAULT_SUBSCRIPTION_PROVIDER_METADATA["google-gemini-cli"];

  const readLocalGeminiData = async () => {
    const credsPath = resolveHomeSubpath(
      ctx.homeDir,
      ".gemini",
      "oauth_creds.json"
    );
    const accountsPath = resolveHomeSubpath(
      ctx.homeDir,
      ".gemini",
      "google_accounts.json"
    );
    const [credsRaw, accountsRaw] = await Promise.all([
      readJsonFileReadOnly(credsPath),
      readJsonFileReadOnly(accountsPath)
    ]);
    if (!isRecord(credsRaw)) return undefined;
    const accessToken = nonEmptyString(credsRaw.access_token);
    const refreshToken = nonEmptyString(credsRaw.refresh_token);
    if (!accessToken && !refreshToken) return undefined;

    const idToken = nonEmptyString(credsRaw.id_token);
    const jwtPayload = decodeJwtPayload(idToken);
    const accountsEmail = isRecord(accountsRaw)
      ? nonEmptyString(accountsRaw.active)
      : undefined;
    const email = accountsEmail ?? nonEmptyString(jwtPayload?.email);
    const displayName =
      nonEmptyString(jwtPayload?.name) ?? email ?? "Gemini CLI 账号";
    const expiresAt = toIsoExpiry(credsRaw.expiry_date, ctx.now());
    const clientId = nonEmptyString(credsRaw.client_id);
    const clientSecret = nonEmptyString(credsRaw.client_secret);

    return {
      credsPath,
      accessToken: accessToken ?? "",
      ...(refreshToken ? { refreshToken } : {}),
      ...(idToken ? { idToken } : {}),
      ...(expiresAt ? { expiresAt } : {}),
      ...(email ? { email } : {}),
      displayName,
      ...(clientId ? { clientId } : {}),
      ...(clientSecret ? { clientSecret } : {})
    };
  };

  return {
    id: "google-gemini-cli",
    meta,

    async startAuth(authCtx: AuthFlowContext): Promise<AuthFlowHandle> {
      const client = resolveGeminiOAuthClient(options, ctx.env);
      if (!client) {
        throw new SubscriptionError(
          "subscriptions.oauth_client_not_configured",
          "此版本暂未启用 Google Gemini CLI 浏览器登录，可通过「导入本机」接入已有账号。"
        );
      }

      const pkce = generatePkcePair();
      const state = generateOAuthState();
      const loopback = await ctx.startLoopback({
        state,
        callbackPath: "/oauth2callback",
        signal: authCtx.signal
      });

      const authUrl = new URL(authBaseUrl);
      authUrl.searchParams.set("client_id", client.clientId);
      authUrl.searchParams.set("redirect_uri", loopback.redirectUri);
      authUrl.searchParams.set("response_type", "code");
      authUrl.searchParams.set("scope", GOOGLE_SCOPES);
      authUrl.searchParams.set("code_challenge", pkce.codeChallenge);
      authUrl.searchParams.set(
        "code_challenge_method",
        pkce.codeChallengeMethod
      );
      authUrl.searchParams.set("state", state);
      authUrl.searchParams.set("access_type", "offline");
      authUrl.searchParams.set("prompt", "select_account consent");

      const verificationUri = authUrl.toString();
      await authCtx.openExternalUrl(verificationUri);

      const completion = (async (): Promise<ImportedAccountResult> => {
        const callback = await loopback.waitForCallback;
        const body = new URLSearchParams({
          client_id: client.clientId,
          code: callback.code,
          code_verifier: pkce.codeVerifier,
          grant_type: "authorization_code",
          redirect_uri: loopback.redirectUri
        });
        if (client.clientSecret) {
          body.set("client_secret", client.clientSecret);
        }
        const tokenData = await exchangeGoogleLoginCode(
          authCtx,
          ctx.fetcher,
          tokenUrl,
          body
        );
        const profileSignal = AbortSignal.any([
          authCtx.signal,
          AbortSignal.timeout(5_000)
        ]);
        const accessToken = tokenData.access_token as string;
        const refreshToken = nonEmptyString(tokenData.refresh_token);
        const idToken = nonEmptyString(tokenData.id_token);
        const expiresAt = toIsoExpiry(tokenData.expires_in, ctx.now());

        const [userInfo, codeAssist] = await Promise.all([
          fetchGoogleUserInfo(
            ctx.fetcher,
            userInfoUrl,
            accessToken,
            profileSignal
          ),
          loadCodeAssistMetadata(
            ctx.fetcher,
            cloudCodeBaseUrl,
            accessToken,
            profileSignal
          )
        ]);

        const email =
          userInfo.email ?? nonEmptyString(decodeJwtPayload(idToken)?.email);
        const extra: Record<string, string> = {
          ...(codeAssist.projectId ? { projectId: codeAssist.projectId } : {}),
          oauthClientId: client.clientId,
          ...(client.clientSecret
            ? { oauthClientSecret: client.clientSecret }
            : {})
        };

        return {
          displayName: userInfo.displayName ?? email ?? "Google 账号",
          ...(email ? { email } : {}),
          ...(codeAssist.planTier ? { planTier: codeAssist.planTier } : {}),
          source: "oauth",
          secret: {
            accessToken,
            ...(refreshToken ? { refreshToken } : {}),
            ...(idToken ? { idToken } : {}),
            ...(expiresAt ? { expiresAt } : {}),
            ...(Object.keys(extra).length > 0 ? { extra } : {})
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
      const local = await readLocalGeminiData();
      if (!local) return [];
      return [
        {
          candidateId: GEMINI_CLI_CANDIDATE_ID,
          provider: "google-gemini-cli",
          displayName: local.displayName,
          ...(local.email ? { email: local.email } : {}),
          sourceLabel: "Gemini CLI 本地配置",
          sourcePathHint: maskPathHint(local.credsPath, ctx.homeDir)
        }
      ];
    },

    async importLocalCandidate(
      candidateId: string
    ): Promise<ImportedAccountResult> {
      if (candidateId !== GEMINI_CLI_CANDIDATE_ID) {
        throw new SubscriptionError(
          "subscriptions.candidate_not_found",
          "未找到指定的 Gemini CLI 本机凭证。"
        );
      }
      const local = await readLocalGeminiData();
      if (!local) {
        throw new SubscriptionError(
          "subscriptions.candidate_not_found",
          "未在本机找到 ~/.gemini/oauth_creds.json 凭证文件。"
        );
      }
      let accessToken = local.accessToken;
      let expiresAt = local.expiresAt;
      const tokenExpired =
        !accessToken ||
        (expiresAt !== undefined &&
          Number.isFinite(Date.parse(expiresAt)) &&
          Date.parse(expiresAt) <= ctx.now() + 60_000);
      let didRefresh = false;
      const runImportRefresh = async (): Promise<void> => {
        if (!local.refreshToken || didRefresh) return;
        didRefresh = true;
        const refreshed = await this.refreshSecret(
          {
            id: "import_probe",
            provider: "google-gemini-cli",
            displayName: local.displayName,
            source: "local_import",
            isPrimary: true,
            enabled: true,
            status: "active",
            consecutiveRateLimits: 0,
            quotaBuckets: [],
            createdAt: new Date(ctx.now()).toISOString()
          },
          {
            accessToken: "pending-refresh",
            refreshToken: local.refreshToken,
            extra: {
              ...(local.clientId ? { oauthClientId: local.clientId } : {}),
              ...(local.clientSecret
                ? { oauthClientSecret: local.clientSecret }
                : {})
            }
          }
        );
        accessToken = refreshed.accessToken;
        expiresAt = refreshed.expiresAt;
      };
      if (tokenExpired && local.refreshToken) {
        await runImportRefresh();
      }

      let [userInfo, codeAssist] = accessToken
        ? await Promise.all([
            fetchGoogleUserInfo(ctx.fetcher, userInfoUrl, accessToken),
            loadCodeAssistMetadata(ctx.fetcher, cloudCodeBaseUrl, accessToken)
          ])
        : [{}, {}];

      if (!codeAssist.projectId && local.refreshToken && !didRefresh) {
        try {
          await runImportRefresh();
          if (accessToken) {
            [userInfo, codeAssist] = await Promise.all([
              fetchGoogleUserInfo(ctx.fetcher, userInfoUrl, accessToken),
              loadCodeAssistMetadata(ctx.fetcher, cloudCodeBaseUrl, accessToken)
            ]);
          }
        } catch {
          // Keep originally imported token if proactive refresh fails.
        }
      }

      const extra: Record<string, string> = {
        ...(codeAssist.projectId ? { projectId: codeAssist.projectId } : {}),
        ...(local.clientId ? { oauthClientId: local.clientId } : {}),
        ...(local.clientSecret ? { oauthClientSecret: local.clientSecret } : {})
      };

      return {
        displayName: userInfo.displayName ?? local.email ?? local.displayName,
        ...((userInfo.email ?? local.email)
          ? { email: userInfo.email ?? local.email }
          : {}),
        ...(codeAssist.planTier ? { planTier: codeAssist.planTier } : {}),
        source: "local_import",
        secret: {
          accessToken,
          ...(local.refreshToken ? { refreshToken: local.refreshToken } : {}),
          ...(local.idToken ? { idToken: local.idToken } : {}),
          ...(expiresAt ? { expiresAt } : {}),
          ...(Object.keys(extra).length > 0 ? { extra } : {})
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
          "当前 Google Gemini CLI 账号缺少刷新令牌，请重新登录。"
        );
      }
      const client = resolveGeminiOAuthClient(options, ctx.env, secret.extra);
      if (!client) {
        throw new SubscriptionError(
          "subscriptions.secret_refresh_failed",
          "未配置 Google Gemini CLI OAuth 客户端参数，无法刷新令牌。"
        );
      }
      const body = new URLSearchParams({
        client_id: client.clientId,
        refresh_token: secret.refreshToken,
        grant_type: "refresh_token"
      });
      if (client.clientSecret) {
        body.set("client_secret", client.clientSecret);
      }
      const response = await ctx.fetcher(tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
        ...(signal ? { signal } : {})
      });
      if (!response.ok) {
        throwHttpSubscriptionError(response.status, "Google Gemini CLI");
      }
      const data = (await response.json()) as unknown;
      if (!isRecord(data) || !nonEmptyString(data.access_token)) {
        throw new SubscriptionError(
          "subscriptions.secret_refresh_failed",
          "Google 刷新令牌响应缺少访问令牌。"
        );
      }
      const nextAccessToken = data.access_token as string;
      const nextExpiresAt =
        toIsoExpiry(data.expires_in, ctx.now()) ?? secret.expiresAt;
      const nextRefreshToken =
        nonEmptyString(data.refresh_token) ?? secret.refreshToken;
      const nextIdToken = nonEmptyString(data.id_token);
      let nextExtra = secret.extra;
      if (!secret.extra?.projectId) {
        const metaResult = await loadCodeAssistMetadata(
          ctx.fetcher,
          cloudCodeBaseUrl,
          nextAccessToken,
          signal
        );
        if (metaResult.projectId) {
          nextExtra = {
            ...(secret.extra ?? {}),
            projectId: metaResult.projectId
          };
        }
      }
      return {
        ...secret,
        accessToken: nextAccessToken,
        ...(nextRefreshToken ? { refreshToken: nextRefreshToken } : {}),
        ...(nextIdToken ? { idToken: nextIdToken } : {}),
        ...(nextExpiresAt ? { expiresAt: nextExpiresAt } : {}),
        ...(nextExtra ? { extra: nextExtra } : {})
      };
    },

    async fetchQuota(
      _account: StoredAccountRecord,
      secret: StoredAccountSecret,
      signal?: AbortSignal
    ): Promise<QuotaFetchResult> {
      const loadMeta = await loadCodeAssistMetadata(
        ctx.fetcher,
        cloudCodeBaseUrl,
        secret.accessToken,
        signal
      );
      const projectId = loadMeta.projectId ?? secret.extra?.projectId;
      const response = await ctx.fetcher(
        `${cloudCodeBaseUrl.replace(/\/+$/u, "")}/v1internal:retrieveUserQuota`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            Authorization: `Bearer ${secret.accessToken}`
          },
          body: JSON.stringify(projectId ? { project: projectId } : {}),
          ...(signal ? { signal } : {})
        }
      );
      if (!response.ok) {
        throwHttpSubscriptionError(response.status, "Google Gemini CLI");
      }
      const quotaRaw = (await response.json()) as unknown;
      const quotaBuckets = parseCodeAssistQuotaBuckets(quotaRaw);
      const allExhausted =
        quotaBuckets.length > 0 &&
        quotaBuckets.every(
          (bucket) =>
            bucket.remainingPercent !== undefined &&
            bucket.remainingPercent <= 0
        );
      const earliestReset = quotaBuckets
        .map((bucket) => bucket.resetsAt)
        .filter((value): value is string => Boolean(value))
        .sort()[0];

      return {
        ...(loadMeta.planTier ? { planTier: loadMeta.planTier } : {}),
        quotaBuckets,
        status: allExhausted ? "quota_exhausted" : "active",
        ...(allExhausted && earliestReset
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
        return [...GEMINI_CLI_BASELINE_MODELS];
      }
      const root = cloudCodeBaseUrl.replace(/\/+$/u, "");
      const byBaseline = new Map(
        GEMINI_CLI_BASELINE_MODELS.map((item) => [item.modelId, item])
      );
      const discovered = new Map<string, SubscriptionModelDefinition>();
      let projectId = secret?.extra?.projectId;
      if (!projectId) {
        const metaResult = await loadCodeAssistMetadata(
          ctx.fetcher,
          cloudCodeBaseUrl,
          token,
          signal
        );
        projectId = metaResult.projectId;
      }

      const registerRemoteModel = (
        modelId: string,
        displayName?: string,
        contextWindow?: number,
        maxTokens?: number
      ) => {
        const cleanId = modelId.trim();
        if (!cleanId || /embedding|imagen|veo|tts|whisper/iu.test(cleanId)) {
          return;
        }
        const id = `sub:google-gemini-cli:${cleanId.toLowerCase()}`;
        if (id.length > 120 || discovered.has(id)) return;
        const baseline = byBaseline.get(cleanId);
        const isFlash = /flash/iu.test(cleanId);
        discovered.set(id, {
          ...(baseline ?? {
            id,
            provider: "google-gemini-cli",
            modelId: cleanId,
            label: displayName ?? cleanId,
            api: "google-cloud-code-assist",
            baseUrl: cloudCodeBaseUrl,
            reasoning: true,
            defaultThinkingLevel: isFlash ? "low" : "medium",
            thinkingLevelOptions: ["minimal", "low", "medium", "high"],
            contextWindow: contextWindow ?? 1_048_576,
            maxTokens: maxTokens ?? 65_536,
            recommended: false
          }),
          ...(displayName && !baseline ? { label: displayName } : {}),
          ...(contextWindow ? { contextWindow } : {}),
          ...(maxTokens ? { maxTokens } : {}),
          baseUrl: cloudCodeBaseUrl
        });
      };

      // 1. Try v1internal:fetchAvailableModels (rich model catalog when supported)
      try {
        const availRes = await ctx.fetcher(
          `${root}/v1internal:fetchAvailableModels`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
              Authorization: `Bearer ${token}`
            },
            body: JSON.stringify(projectId ? { project: projectId } : {}),
            ...(signal ? { signal } : {})
          }
        );
        if (availRes.status === 401)
          throwHttpSubscriptionError(401, "Google Gemini CLI");
        if (availRes.ok) {
          const raw = (await availRes.json()) as unknown;
          if (isRecord(raw) && isRecord(raw.models)) {
            for (const [modelId, info] of Object.entries(raw.models)) {
              if (!isRecord(info)) continue;
              const ctxWin =
                typeof info.maxInputTokens === "number" &&
                info.maxInputTokens >= 1_024
                  ? info.maxInputTokens
                  : typeof info.contextWindow === "number" &&
                      info.contextWindow >= 1_024
                    ? info.contextWindow
                    : typeof info.maxTokens === "number" &&
                        info.maxTokens >= 1_024
                      ? info.maxTokens
                      : undefined;
              const maxOut =
                typeof info.maxOutputTokens === "number" &&
                info.maxOutputTokens >= 1
                  ? info.maxOutputTokens
                  : undefined;
              registerRemoteModel(
                modelId,
                nonEmptyString(info.displayName),
                ctxWin,
                maxOut
              );
            }
          }
        }
      } catch (error) {
        if (error instanceof SubscriptionError || signal?.aborted) throw error;
        // Older Code Assist deployments only expose quota buckets.
      }

      // Some deployments expose model IDs only in the quota response.
      if (discovered.size === 0) {
        try {
          const quotaRes = await ctx.fetcher(
            `${root}/v1internal:retrieveUserQuota`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Accept: "application/json",
                Authorization: `Bearer ${token}`
              },
              body: JSON.stringify(projectId ? { project: projectId } : {}),
              ...(signal ? { signal } : {})
            }
          );
          if (!quotaRes.ok)
            throwHttpSubscriptionError(quotaRes.status, "Google Gemini CLI");
          const quotaRaw = (await quotaRes.json()) as unknown;
          if (isRecord(quotaRaw) && Array.isArray(quotaRaw.buckets)) {
            for (const bucket of quotaRaw.buckets) {
              if (!isRecord(bucket)) continue;
              const modelId = nonEmptyString(bucket.modelId);
              if (modelId) registerRemoteModel(modelId);
            }
          }
        } catch (error) {
          if (error instanceof SubscriptionError || signal?.aborted)
            throw error;
        }
      }

      if (discovered.size === 0) {
        throw new SubscriptionError(
          "subscriptions.models_unavailable",
          "未能获取账号的模型目录。"
        );
      }
      const result = [...discovered.values()];
      if (!result.some((m) => m.recommended)) {
        result[0] = { ...result[0]!, recommended: true };
      }
      return result;
    },

    toRuntimeCredential(account, secret) {
      return {
        provider: "google-gemini-cli",
        accountId: account.id,
        apiKey: secret.accessToken,
        baseUrl: cloudCodeBaseUrl,
        ...(secret.expiresAt ? { expiresAt: secret.expiresAt } : {}),
        ...(secret.extra?.projectId
          ? { metadata: { projectId: secret.extra.projectId } }
          : {})
      };
    }
  };
}
