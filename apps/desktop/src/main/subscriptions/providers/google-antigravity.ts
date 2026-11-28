import {
  ANTIGRAVITY_HUB_USER_AGENT,
  GOOGLE_ANTIGRAVITY_DEFAULT_BASE_URL as ANTIGRAVITY_DEFAULT_ENDPOINT
} from "@writer/agent-runtime";
import { readdir } from "node:fs/promises";
import {
  ModelContextWindowSchema,
  ModelMaxTokensSchema,
  SUBSCRIPTION_MAX_QUOTA_BUCKETS,
  type SubscriptionQuotaBucket
} from "@writer/contracts";
import { generateOAuthState, generatePkcePair } from "../oauth-loopback";
import { exchangeGoogleLoginCode } from "./google-oauth";
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
  readSqliteRawItemsReadOnly,
  resolveAdapterContext,
  resolveHomeSubpath,
  throwHttpSubscriptionError,
  toIsoExpiry,
  type ProviderEnvironmentOptions,
  type SubscriptionFetcher
} from "./shared";
import type { GoogleOAuthClientConfig } from "./google-gemini-cli";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo";
const ANTIGRAVITY_SCOPES = [
  "https://www.googleapis.com/auth/cloud-platform",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  "https://www.googleapis.com/auth/cclog",
  "https://www.googleapis.com/auth/experimentsandconfigs",
  "https://www.googleapis.com/auth/aicode"
].join(" ");

export interface GoogleAntigravityAdapterOptions extends ProviderEnvironmentOptions {
  oauthClient?: GoogleOAuthClientConfig;
  authBaseUrl?: string;
  tokenUrl?: string;
  userInfoUrl?: string;
  endpointUrl?: string;
}

export const ANTIGRAVITY_BASELINE_MODELS: readonly SubscriptionModelDefinition[] =
  [
    {
      id: "sub:google-antigravity:gemini-4-neon",
      provider: "google-antigravity",
      modelId: "gemini-4-neon",
      label: "Gemini 4 Neon (Antigravity)",
      description: "Antigravity 订阅主力 Gemini 4 平衡旗舰模型",
      api: "google-antigravity",
      baseUrl: ANTIGRAVITY_DEFAULT_ENDPOINT,
      reasoning: true,
      defaultThinkingLevel: "medium",
      thinkingLevelOptions: ["low", "medium", "high", "xhigh"],
      contextWindow: 524_288,
      maxTokens: 65_536,
      recommended: true
    },
    {
      id: "sub:google-antigravity:gemini-4-hydrogen",
      provider: "google-antigravity",
      modelId: "gemini-4-hydrogen",
      label: "Gemini 4 Hydrogen (Antigravity)",
      api: "google-antigravity",
      baseUrl: ANTIGRAVITY_DEFAULT_ENDPOINT,
      reasoning: true,
      defaultThinkingLevel: "medium",
      thinkingLevelOptions: ["low", "medium", "high", "xhigh"],
      recommended: false
    },
    {
      id: "sub:google-antigravity:gemini-4-carbon",
      provider: "google-antigravity",
      modelId: "gemini-4-carbon",
      label: "Gemini 4 Carbon (Antigravity)",
      api: "google-antigravity",
      baseUrl: ANTIGRAVITY_DEFAULT_ENDPOINT,
      reasoning: true,
      defaultThinkingLevel: "high",
      thinkingLevelOptions: ["low", "medium", "high"],
      contextWindow: 1_048_576,
      maxTokens: 65_536,
      recommended: false
    },
    {
      id: "sub:google-antigravity:gemini-4-argon",
      provider: "google-antigravity",
      modelId: "gemini-4-argon",
      label: "Gemini 4 Argon (Antigravity)",
      api: "google-antigravity",
      baseUrl: ANTIGRAVITY_DEFAULT_ENDPOINT,
      reasoning: true,
      defaultThinkingLevel: "high",
      thinkingLevelOptions: ["low", "medium", "high"],
      contextWindow: 1_048_576,
      maxTokens: 65_536,
      recommended: false
    },
    {
      id: "sub:google-antigravity:gemini-3.8-flash",
      provider: "google-antigravity",
      modelId: "gemini-3.8-flash",
      label: "Gemini 3.8 Flash (Antigravity)",
      api: "google-antigravity",
      baseUrl: ANTIGRAVITY_DEFAULT_ENDPOINT,
      reasoning: true,
      defaultThinkingLevel: "medium",
      thinkingLevelOptions: ["minimal", "low", "medium", "high"],
      contextWindow: 1_048_576,
      maxTokens: 65_536,
      recommended: false
    },
    {
      id: "sub:google-antigravity:claude-opus-5-5-thinking",
      provider: "google-antigravity",
      modelId: "claude-opus-5-5-thinking",
      label: "Claude Opus 5.5 Thinking (Antigravity)",
      api: "google-antigravity",
      baseUrl: ANTIGRAVITY_DEFAULT_ENDPOINT,
      reasoning: true,
      defaultThinkingLevel: "high",
      thinkingLevelOptions: ["low", "medium", "high"],
      contextWindow: 1_000_000,
      maxTokens: 128_000,
      recommended: false
    },
    {
      id: "sub:google-antigravity:claude-sonnet-5-5-thinking",
      provider: "google-antigravity",
      modelId: "claude-sonnet-5-5-thinking",
      label: "Claude Sonnet 5.5 Thinking (Antigravity)",
      api: "google-antigravity",
      baseUrl: ANTIGRAVITY_DEFAULT_ENDPOINT,
      reasoning: true,
      defaultThinkingLevel: "medium",
      thinkingLevelOptions: ["low", "medium", "high"],
      contextWindow: 1_000_000,
      maxTokens: 128_000,
      recommended: false
    }
  ];

interface DiscoveredAntigravityAccount {
  candidateId: string;
  displayName: string;
  email?: string;
  planTier?: string;
  sourceLabel: string;
  sourcePathHint: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string;
  projectId?: string;
  clientId?: string;
  clientSecret?: string;
}

function resolveAntigravityOAuthClient(
  options: GoogleAntigravityAdapterOptions,
  env: NodeJS.ProcessEnv,
  extra?: Record<string, string>
): GoogleOAuthClientConfig | undefined {
  if (options.oauthClient?.clientId) return options.oauthClient;
  const configuredId =
    nonEmptyString(env.WRITER_GOOGLE_ANTIGRAVITY_CLIENT_ID) ??
    nonEmptyString(env.ANTIGRAVITY_OAUTH_CLIENT_ID);
  const storedId = nonEmptyString(extra?.oauthClientId);
  const clientId = storedId ?? configuredId;
  if (!clientId) return undefined;
  const clientSecret =
    nonEmptyString(extra?.oauthClientSecret) ??
    (clientId === configuredId
      ? (nonEmptyString(env.WRITER_GOOGLE_ANTIGRAVITY_CLIENT_SECRET) ??
        nonEmptyString(env.ANTIGRAVITY_OAUTH_CLIENT_SECRET))
      : undefined);
  return {
    clientId,
    ...(clientSecret ? { clientSecret } : {})
  };
}

function formatAntigravityTier(rawTier: unknown): string | undefined {
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

async function loadAntigravityCodeAssist(
  fetcher: SubscriptionFetcher,
  endpointUrl: string,
  accessToken: string,
  signal?: AbortSignal
): Promise<{ projectId?: string; planTier?: string }> {
  const root = endpointUrl.replace(/\/+$/u, "");
  try {
    const response = await fetcher(`${root}/v1internal:loadCodeAssist`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
        "User-Agent": ANTIGRAVITY_HUB_USER_AGENT
      },
      body: JSON.stringify({
        metadata: {
          ideType: "ANTIGRAVITY",
          platform: "PLATFORM_UNSPECIFIED",
          pluginType: "GEMINI"
        }
      }),
      ...(signal ? { signal } : {})
    });
    if (!response.ok) return {};
    const data = (await response.json()) as unknown;
    if (!isRecord(data)) return {};
    let projectId =
      nonEmptyString(data.cloudaicompanionProject) ??
      (isRecord(data.cloudaicompanionProject)
        ? nonEmptyString(data.cloudaicompanionProject.id)
        : undefined);
    const planTier =
      formatAntigravityTier(data.paidTier) ??
      formatAntigravityTier(data.currentTier);
    if (!projectId && Array.isArray(data.allowedTiers)) {
      const preferred =
        data.allowedTiers.find(
          (item) =>
            isRecord(item) && item.isDefault === true && nonEmptyString(item.id)
        ) ??
        data.allowedTiers.find(
          (item) => isRecord(item) && nonEmptyString(item.id)
        );
      const tierId = isRecord(preferred)
        ? nonEmptyString(preferred.id)
        : undefined;
      if (tierId) {
        try {
          const onboardRes = await fetcher(`${root}/v1internal:onboardUser`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
              Authorization: `Bearer ${accessToken}`,
              "User-Agent": ANTIGRAVITY_HUB_USER_AGENT
            },
            body: JSON.stringify({
              tierId,
              metadata: {
                ideType: "ANTIGRAVITY",
                platform: "PLATFORM_UNSPECIFIED",
                pluginType: "GEMINI"
              }
            }),
            ...(signal ? { signal } : {})
          });
          if (onboardRes.ok) {
            const onboardData = (await onboardRes.json()) as unknown;
            if (isRecord(onboardData)) {
              const nested = isRecord(onboardData.response)
                ? onboardData.response
                : onboardData;
              projectId =
                nonEmptyString(nested.cloudaicompanionProject) ??
                (isRecord(nested.cloudaicompanionProject)
                  ? nonEmptyString(nested.cloudaicompanionProject.id)
                  : undefined);
            }
          }
        } catch {
          // Best-effort onboarding.
        }
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

function extractAntigravityStateDbCandidate(
  items: Record<string, string | Uint8Array>,
  dbPath: string,
  homeDir: string,
  nowMs: number
): DiscoveredAntigravityAccount | undefined {
  const authStatusRaw = items.antigravityAuthStatus;
  if (typeof authStatusRaw === "string" && authStatusRaw.trim()) {
    try {
      const parsed = JSON.parse(authStatusRaw) as unknown;
      if (isRecord(parsed)) {
        const candidate = parseAntigravityEntry(
          parsed,
          "antigravity:ide:state-db",
          "Antigravity IDE 本地登录态",
          dbPath,
          homeDir,
          nowMs
        );
        if (candidate) return candidate;
      }
    } catch {
      // Fall through to binary protobuf inspection.
    }
  }
  const syncRaw = items["jetskiStateSync.agentManagerInitState"];
  if (!syncRaw) return undefined;
  const rawBuffer =
    typeof syncRaw === "string"
      ? Buffer.from(syncRaw, "base64")
      : Buffer.from(syncRaw);
  const text = rawBuffer.toString("latin1");
  const refreshMatch = /1\/\/[0-9A-Za-z_-]{20,}/u.exec(text);
  const accessMatch = /ya29\.[0-9A-Za-z._-]{20,}/u.exec(text);
  const emailMatch = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/u.exec(
    text
  );
  const refreshToken = refreshMatch?.[0];
  const accessToken = accessMatch?.[0];
  if (!refreshToken && !accessToken) return undefined;
  const email = emailMatch?.[0];
  return {
    candidateId: "antigravity:ide:state-db",
    displayName: email ?? "Antigravity IDE 账号",
    ...(email ? { email } : {}),
    sourceLabel: "Antigravity IDE 本地数据库",
    sourcePathHint: maskPathHint(dbPath, homeDir),
    accessToken: accessToken ?? "",
    ...(refreshToken ? { refreshToken } : {})
  };
}

function parseAntigravityEntry(
  raw: Record<string, unknown>,
  candidateId: string,
  sourceLabel: string,
  filePath: string,
  homeDir: string,
  nowMs: number
): DiscoveredAntigravityAccount | undefined {
  const tokenObj = isRecord(raw.token) ? raw.token : raw;
  const accessToken =
    nonEmptyString(tokenObj.access_token) ??
    nonEmptyString(tokenObj.accessToken);
  const refreshToken =
    nonEmptyString(tokenObj.refresh_token) ??
    nonEmptyString(tokenObj.refreshToken);
  if (!accessToken && !refreshToken) return undefined;

  const idToken =
    nonEmptyString(tokenObj.id_token) ?? nonEmptyString(tokenObj.idToken);
  const jwt = decodeJwtPayload(idToken);
  const email =
    nonEmptyString(raw.email) ??
    nonEmptyString(tokenObj.email) ??
    nonEmptyString(jwt?.email);
  const displayName =
    nonEmptyString(raw.name) ??
    nonEmptyString(raw.displayName) ??
    nonEmptyString(jwt?.name) ??
    email ??
    "Antigravity 账号";
  const expiresAt =
    toIsoExpiry(tokenObj.expiry_timestamp, nowMs) ??
    toIsoExpiry(tokenObj.expiry_date, nowMs) ??
    toIsoExpiry(tokenObj.expires_at, nowMs) ??
    toIsoExpiry(tokenObj.expiresAt, nowMs);
  const projectId =
    nonEmptyString(tokenObj.project_id) ??
    nonEmptyString(tokenObj.projectId) ??
    nonEmptyString(raw.project_id) ??
    nonEmptyString(raw.projectId);
  const planTier =
    nonEmptyString(raw.subscription_tier) ??
    nonEmptyString(raw.plan_tier) ??
    nonEmptyString(raw.tier);
  const clientId =
    nonEmptyString(tokenObj.client_id) ?? nonEmptyString(raw.client_id);
  const clientSecret =
    nonEmptyString(tokenObj.client_secret) ?? nonEmptyString(raw.client_secret);

  return {
    candidateId,
    displayName,
    ...(email ? { email } : {}),
    ...(planTier ? { planTier } : {}),
    sourceLabel,
    sourcePathHint: maskPathHint(filePath, homeDir),
    accessToken: accessToken ?? "",
    ...(refreshToken ? { refreshToken } : {}),
    ...(expiresAt ? { expiresAt } : {}),
    ...(projectId ? { projectId } : {}),
    ...(clientId ? { clientId } : {}),
    ...(clientSecret ? { clientSecret } : {})
  };
}

async function listJsonFilesSafely(dirPath: string): Promise<string[]> {
  try {
    const entries = await readdir(dirPath, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => resolveHomeSubpath(dirPath, entry.name));
  } catch {
    return [];
  }
}

async function fetchAntigravityModelsAndQuota(
  fetcher: SubscriptionFetcher,
  endpointUrl: string,
  accessToken: string,
  projectId?: string,
  signal?: AbortSignal
): Promise<{
  buckets: SubscriptionQuotaBucket[];
  models: SubscriptionModelDefinition[];
}> {
  const response = await fetcher(
    `${endpointUrl.replace(/\/+$/u, "")}/v1internal:fetchAvailableModels`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
        "User-Agent": ANTIGRAVITY_HUB_USER_AGENT
      },
      body: JSON.stringify(projectId ? { project: projectId } : {}),
      ...(signal ? { signal } : {})
    }
  );
  if (!response.ok) {
    throwHttpSubscriptionError(response.status, "Google Antigravity");
  }
  const data = (await response.json()) as unknown;
  if (!isRecord(data) || !isRecord(data.models)) {
    throw new SubscriptionError(
      "subscriptions.models_unavailable",
      "上游未返回模型目录，请稍后重试。"
    );
  }
  const buckets: SubscriptionQuotaBucket[] = [];
  const models: SubscriptionModelDefinition[] = [];
  const menuIds = new Set<string>();
  for (const sort of Array.isArray(data.agentModelSorts)
    ? data.agentModelSorts
    : []) {
    if (!isRecord(sort) || !Array.isArray(sort.groups)) continue;
    for (const group of sort.groups) {
      if (!isRecord(group) || !Array.isArray(group.modelIds)) continue;
      for (const id of group.modelIds) {
        if (
          typeof id === "string" &&
          Object.hasOwn(data.models, id) &&
          isRecord(data.models[id])
        )
          menuIds.add(id);
      }
    }
  }
  const defaultId = nonEmptyString(data.defaultAgentModelId);
  if (
    menuIds.size &&
    defaultId &&
    Object.hasOwn(data.models, defaultId) &&
    isRecord(data.models[defaultId])
  )
    menuIds.add(defaultId);
  const otherUses = new Set([
    ...(Array.isArray(data.imageGenerationModelIds)
      ? data.imageGenerationModelIds
      : []),
    ...(Array.isArray(data.audioTranscriptionModelIds)
      ? data.audioTranscriptionModelIds
      : [])
  ]);
  const ids = menuIds.size
    ? [...menuIds]
    : Object.keys(data.models).filter(
        (id) =>
          !otherUses.has(id) &&
          !/^tab[_-]|[-_](?:image|embedding)(?:[-_]|$)/iu.test(id)
      );
  for (const modelId of ids) {
    const rawInfo = data.models[modelId];
    if (
      !isRecord(rawInfo) ||
      rawInfo.disabled === true ||
      modelId.endsWith("-disabled")
    )
      continue;
    const quota = isRecord(rawInfo.quotaInfo) ? rawInfo.quotaInfo : undefined;
    if (quota) {
      const fraction =
        typeof quota.remainingFraction === "number" &&
        Number.isFinite(quota.remainingFraction)
          ? Math.min(1, Math.max(0, quota.remainingFraction))
          : undefined;
      const resetsAt = toIsoExpiry(quota.resetTime);
      buckets.push({
        id: modelId.slice(0, 80),
        label: nonEmptyString(rawInfo.displayName) ?? modelId,
        ...(fraction !== undefined ? { remainingPercent: fraction * 100 } : {}),
        ...(resetsAt ? { resetsAt } : {})
      });
    }
    const id = `sub:google-antigravity:${modelId.toLowerCase()}`;
    if (id.length <= 120) {
      const baseline = ANTIGRAVITY_BASELINE_MODELS.find(
        (model) => model.modelId === modelId
      );
      const contextWindow = ModelContextWindowSchema.safeParse(
        rawInfo.maxInputTokens ?? rawInfo.contextWindow ?? rawInfo.maxTokens
      );
      const maxTokens = ModelMaxTokensSchema.safeParse(rawInfo.maxOutputTokens);
      const reasoning =
        typeof rawInfo.supportsThinking === "boolean"
          ? rawInfo.supportsThinking
          : (baseline?.reasoning ?? false);
      const tier = reasoning
        ? /-(low|medium|high|xhigh)$/u.exec(modelId)?.[1]
        : undefined;
      models.push({
        ...baseline,
        id,
        provider: "google-antigravity",
        modelId,
        label:
          nonEmptyString(rawInfo.displayName) ?? baseline?.label ?? modelId,
        api: "google-antigravity",
        baseUrl: endpointUrl,
        reasoning,
        defaultThinkingLevel: reasoning
          ? (tier ?? baseline?.defaultThinkingLevel ?? "medium")
          : "off",
        ...(tier ? { thinkingLevelOptions: [tier] } : {}),
        ...(contextWindow.success ? { contextWindow: contextWindow.data } : {}),
        ...(maxTokens.success ? { maxTokens: maxTokens.data } : {}),
        recommended: defaultId
          ? modelId === defaultId
          : (baseline?.recommended ?? false)
      });
    }
  }
  if (models.length && !models.some((model) => model.recommended)) {
    const preferred = models[0]!;
    preferred.recommended = true;
  }
  if (!models.length)
    throw new SubscriptionError(
      "subscriptions.models_unavailable",
      "上游没有返回可用的对话模型。"
    );
  return { buckets, models };
}

export function createGoogleAntigravityAdapter(
  options: GoogleAntigravityAdapterOptions = {}
): SubscriptionProviderAdapter {
  const ctx = resolveAdapterContext(options);
  const authBaseUrl = options.authBaseUrl ?? GOOGLE_AUTH_URL;
  const tokenUrl = options.tokenUrl ?? GOOGLE_TOKEN_URL;
  const userInfoUrl = options.userInfoUrl ?? GOOGLE_USERINFO_URL;
  const endpointUrl = options.endpointUrl ?? ANTIGRAVITY_DEFAULT_ENDPOINT;
  const meta = DEFAULT_SUBSCRIPTION_PROVIDER_METADATA["google-antigravity"];

  const scanDiscovered = async (): Promise<DiscoveredAntigravityAccount[]> => {
    const discovered: DiscoveredAntigravityAccount[] = [];
    const seen = new Set<string>();
    const addCandidate = (
      candidate: DiscoveredAntigravityAccount | undefined
    ) => {
      if (!candidate) return;
      const dedupeKey = candidate.email?.toLowerCase() ?? candidate.candidateId;
      if (seen.has(dedupeKey)) return;
      seen.add(dedupeKey);
      discovered.push(candidate);
    };

    const cockpitDirs = [
      {
        dir: resolveHomeSubpath(ctx.homeDir, ".cockpit_tools"),
        label: "Cockpit-Tools 本地账号"
      },
      {
        dir: resolveHomeSubpath(ctx.homeDir, ".antigravity_cockpit"),
        label: "Antigravity Cockpit 本地账号"
      },
      {
        dir: resolveHomeSubpath(ctx.homeDir, ".antigravity_tools"),
        label: "Antigravity / Cockpit-Tools"
      }
    ];
    for (const { dir: cockpitDir, label: sourceLabel } of cockpitDirs) {
      const cockpitIndexPath = resolveHomeSubpath(cockpitDir, "accounts.json");
      const cockpitIndex = await readJsonFileReadOnly(cockpitIndexPath);
      const indexList = Array.isArray(cockpitIndex)
        ? cockpitIndex
        : isRecord(cockpitIndex) && Array.isArray(cockpitIndex.accounts)
          ? cockpitIndex.accounts
          : [];
      indexList.forEach((entry, index) => {
        if (!isRecord(entry)) return;
        const id = nonEmptyString(entry.id) ?? String(index);
        addCandidate(
          parseAntigravityEntry(
            entry,
            `antigravity:cockpit:${id}`,
            sourceLabel,
            cockpitIndexPath,
            ctx.homeDir,
            ctx.now()
          )
        );
      });

      const perAccountFiles = await listJsonFilesSafely(
        resolveHomeSubpath(cockpitDir, "accounts")
      );
      for (const filePath of perAccountFiles) {
        const raw = await readJsonFileReadOnly(filePath);
        if (!isRecord(raw)) continue;
        const id =
          nonEmptyString(raw.id) ??
          nonEmptyString(raw.email) ??
          filePath.split(/[/\\]/u).pop()!;
        addCandidate(
          parseAntigravityEntry(
            raw,
            `antigravity:file:${id}`,
            sourceLabel,
            filePath,
            ctx.homeDir,
            ctx.now()
          )
        );
      }
    }

    const ideDbPaths = [
      ...(ctx.env.APPDATA
        ? [
            resolveHomeSubpath(
              ctx.env.APPDATA,
              "Antigravity",
              "User",
              "globalStorage",
              "state.vscdb"
            )
          ]
        : []),
      resolveHomeSubpath(
        ctx.homeDir,
        "Library",
        "Application Support",
        "Antigravity",
        "User",
        "globalStorage",
        "state.vscdb"
      ),
      resolveHomeSubpath(
        ctx.homeDir,
        ".config",
        "Antigravity",
        "User",
        "globalStorage",
        "state.vscdb"
      )
    ];
    for (const dbPath of ideDbPaths) {
      const rows = await readSqliteRawItemsReadOnly(dbPath, [
        "antigravityAuthStatus",
        "jetskiStateSync.agentManagerInitState"
      ]);
      if (!rows) continue;
      addCandidate(
        extractAntigravityStateDbCandidate(rows, dbPath, ctx.homeDir, ctx.now())
      );
    }

    const legacyPaths = [
      resolveHomeSubpath(
        ctx.homeDir,
        ".gemini",
        "antigravity",
        "oauth_creds.json"
      ),
      resolveHomeSubpath(
        ctx.homeDir,
        ".config",
        "antigravity",
        "oauth_creds.json"
      )
    ];
    for (const filePath of legacyPaths) {
      const raw = await readJsonFileReadOnly(filePath);
      if (!isRecord(raw)) continue;
      addCandidate(
        parseAntigravityEntry(
          raw,
          "antigravity:local:default",
          "Antigravity 本地凭证",
          filePath,
          ctx.homeDir,
          ctx.now()
        )
      );
    }

    return discovered;
  };

  return {
    id: "google-antigravity",
    quotaIncludesModels: true,
    meta,

    async startAuth(authCtx: AuthFlowContext): Promise<AuthFlowHandle> {
      const client = resolveAntigravityOAuthClient(options, ctx.env);
      if (!client) {
        throw new SubscriptionError(
          "subscriptions.oauth_client_not_configured",
          "未配置 Google Antigravity OAuth 客户端参数。"
        );
      }
      const pkce = generatePkcePair();
      const state = generateOAuthState();
      const loopback = await ctx.startLoopback({
        state,
        callbackPath: "/oauth-callback",
        signal: authCtx.signal
      });

      const authUrl = new URL(authBaseUrl);
      authUrl.searchParams.set("client_id", client.clientId);
      authUrl.searchParams.set("redirect_uri", loopback.redirectUri);
      authUrl.searchParams.set("response_type", "code");
      authUrl.searchParams.set("scope", ANTIGRAVITY_SCOPES);
      authUrl.searchParams.set("code_challenge", pkce.codeChallenge);
      authUrl.searchParams.set(
        "code_challenge_method",
        pkce.codeChallengeMethod
      );
      authUrl.searchParams.set("state", state);
      authUrl.searchParams.set("access_type", "offline");
      authUrl.searchParams.set("prompt", "select_account consent");
      authUrl.searchParams.set("include_granted_scopes", "true");

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
        const expiresAt = toIsoExpiry(tokenData.expires_in, ctx.now());

        let email = nonEmptyString(
          decodeJwtPayload(nonEmptyString(tokenData.id_token))?.email
        );
        let displayName = email ?? "Antigravity 账号";
        try {
          const userResp = await ctx.fetcher(userInfoUrl, {
            headers: {
              Accept: "application/json",
              Authorization: `Bearer ${accessToken}`
            },
            signal: profileSignal
          });
          if (userResp.ok) {
            const info = (await userResp.json()) as unknown;
            if (isRecord(info)) {
              email = nonEmptyString(info.email) ?? email;
              displayName = nonEmptyString(info.name) ?? email ?? displayName;
            }
          }
        } catch {
          // Best-effort profile lookup.
        }

        const codeAssist = await loadAntigravityCodeAssist(
          ctx.fetcher,
          endpointUrl,
          accessToken,
          profileSignal
        );

        return {
          displayName,
          ...(email ? { email } : {}),
          ...(codeAssist.planTier ? { planTier: codeAssist.planTier } : {}),
          source: "oauth",
          secret: {
            accessToken,
            ...(refreshToken ? { refreshToken } : {}),
            ...(expiresAt ? { expiresAt } : {}),
            extra: {
              endpoint: endpointUrl,
              ...(codeAssist.projectId
                ? { projectId: codeAssist.projectId }
                : {}),
              oauthClientId: client.clientId,
              ...(client.clientSecret
                ? { oauthClientSecret: client.clientSecret }
                : {})
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
    },

    async scanLocalCandidates(): Promise<LocalCredentialCandidate[]> {
      const items = await scanDiscovered();
      return items.map((item) => ({
        candidateId: item.candidateId,
        provider: "google-antigravity",
        displayName: item.displayName,
        ...(item.email ? { email: item.email } : {}),
        sourceLabel: item.sourceLabel,
        sourcePathHint: item.sourcePathHint
      }));
    },

    async importLocalCandidate(
      candidateId: string
    ): Promise<ImportedAccountResult> {
      const items = await scanDiscovered();
      const target = items.find((item) => item.candidateId === candidateId);
      if (!target) {
        throw new SubscriptionError(
          "subscriptions.candidate_not_found",
          "未在本机找到指定的 Antigravity / Cockpit-Tools 凭证。"
        );
      }
      const extra: Record<string, string> = {
        endpoint: endpointUrl,
        ...(target.projectId ? { projectId: target.projectId } : {}),
        ...(target.clientId ? { oauthClientId: target.clientId } : {}),
        ...(target.clientSecret
          ? { oauthClientSecret: target.clientSecret }
          : {})
      };
      return {
        displayName: target.displayName,
        ...(target.email ? { email: target.email } : {}),
        ...(target.planTier ? { planTier: target.planTier } : {}),
        source: "local_import",
        secret: {
          accessToken: target.accessToken || "pending-refresh",
          ...(target.refreshToken ? { refreshToken: target.refreshToken } : {}),
          ...(target.expiresAt ? { expiresAt: target.expiresAt } : {}),
          extra
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
          "当前 Antigravity 账号缺少刷新令牌，请重新导入或登录。"
        );
      }
      const client = resolveAntigravityOAuthClient(
        options,
        ctx.env,
        secret.extra
      );
      if (!client) {
        throw new SubscriptionError(
          "subscriptions.secret_refresh_failed",
          "未配置 Google Antigravity OAuth 客户端参数，无法刷新令牌。"
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
        throwHttpSubscriptionError(response.status, "Google Antigravity");
      }
      const data = (await response.json()) as unknown;
      if (!isRecord(data) || !nonEmptyString(data.access_token)) {
        throw new SubscriptionError(
          "subscriptions.secret_refresh_failed",
          "Antigravity 刷新令牌响应缺少访问令牌。"
        );
      }
      const nextAccessToken = data.access_token as string;
      const nextExpiresAt =
        toIsoExpiry(data.expires_in, ctx.now()) ?? secret.expiresAt;
      let nextExtra = secret.extra;
      if (!secret.extra?.projectId) {
        const targetEndpoint = secret.extra?.endpoint ?? endpointUrl;
        const metaResult = await loadAntigravityCodeAssist(
          ctx.fetcher,
          targetEndpoint,
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
        refreshToken: nonEmptyString(data.refresh_token) ?? secret.refreshToken,
        ...(nextExpiresAt ? { expiresAt: nextExpiresAt } : {}),
        ...(nextExtra ? { extra: nextExtra } : {})
      };
    },

    async fetchQuota(
      _account: StoredAccountRecord,
      secret: StoredAccountSecret,
      signal?: AbortSignal
    ): Promise<QuotaFetchResult> {
      const targetEndpoint = secret.extra?.endpoint ?? endpointUrl;
      const loadMeta = !secret.extra?.projectId
        ? await loadAntigravityCodeAssist(
            ctx.fetcher,
            targetEndpoint,
            secret.accessToken,
            signal
          )
        : {};
      const projectId = secret.extra?.projectId ?? loadMeta.projectId;
      const { buckets, models } = await fetchAntigravityModelsAndQuota(
        ctx.fetcher,
        targetEndpoint,
        secret.accessToken,
        projectId,
        signal
      );
      const allExhausted =
        models.length > 0 &&
        buckets.length === models.length &&
        buckets.every(
          (bucket) =>
            bucket.remainingPercent !== undefined &&
            bucket.remainingPercent <= 0
        );
      const earliestReset = buckets
        .map((bucket) => bucket.resetsAt)
        .filter((value): value is string => Boolean(value))
        .sort()[0];
      return {
        ...(loadMeta.planTier ? { planTier: loadMeta.planTier } : {}),
        models,
        quotaBuckets: buckets.slice(0, SUBSCRIPTION_MAX_QUOTA_BUCKETS),
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
        return [...ANTIGRAVITY_BASELINE_MODELS];
      }
      const targetEndpoint = secret?.extra?.endpoint ?? endpointUrl;
      let projectId = secret?.extra?.projectId;
      if (!projectId) {
        const metaResult = await loadAntigravityCodeAssist(
          ctx.fetcher,
          targetEndpoint,
          token,
          signal
        );
        projectId = metaResult.projectId;
      }
      const { models } = await fetchAntigravityModelsAndQuota(
        ctx.fetcher,
        targetEndpoint,
        token,
        projectId,
        signal
      );
      return models;
    },

    toRuntimeCredential(account, secret) {
      const metadata: Record<string, string> = {};
      if (secret.extra?.projectId) {
        metadata.projectId = secret.extra.projectId;
      }
      metadata.endpoint = secret.extra?.endpoint ?? endpointUrl;
      return {
        provider: "google-antigravity",
        accountId: account.id,
        apiKey: secret.accessToken,
        baseUrl: metadata.endpoint,
        ...(secret.expiresAt ? { expiresAt: secret.expiresAt } : {}),
        metadata
      };
    }
  };
}
