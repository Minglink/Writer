import { randomUUID } from "node:crypto";
import type { SubscriptionQuotaBucket } from "@writer/contracts";
import { generatePkcePair } from "../oauth-loopback";
import { DEFAULT_SUBSCRIPTION_PROVIDER_METADATA } from "../registry";
import {
  SubscriptionError,
  type AuthFlowContext,
  type AuthFlowHandle,
  type ImportedAccountResult,
  type LocalCredentialCandidate,
  type ManualTokenImportInput,
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
  readSqliteItemsReadOnly,
  resolveAdapterContext,
  resolveHomeSubpath,
  sleepWithAbort,
  throwHttpSubscriptionError,
  toIsoExpiry,
  type ProviderEnvironmentOptions
} from "./shared";

const CURSOR_API_BASE_URL = "https://api2.cursor.sh";
const CURSOR_WEB_BASE_URL = "https://cursor.com";
const CURSOR_AUTH_BASE_URL = "https://api2.cursor.sh";
const CURSOR_CLIENT_ID = "KbZUR41cY7W6zRSdpSUJ7I7mLYBKOCmB";
const CURSOR_SQLITE_KEYS = [
  "cursorAuth/accessToken",
  "cursorAuth/refreshToken",
  "cursorAuth/cachedEmail",
  "cursorAuth/stripeMembershipType",
  "cursorAuth/stripeSubscriptionStatus"
] as const;

export interface CursorAdapterOptions extends ProviderEnvironmentOptions {
  apiBaseUrl?: string;
  webBaseUrl?: string;
  authBaseUrl?: string;
  clientId?: string;
}

export const CURSOR_BASELINE_MODELS: readonly SubscriptionModelDefinition[] = [
  {
    id: "sub:cursor:composer-2.5",
    provider: "cursor",
    modelId: "composer-2.5",
    label: "Composer 2.5 (Cursor)",
    description: "Cursor 原生主力推理与多步创作模型",
    api: "cursor-connect",
    baseUrl: CURSOR_API_BASE_URL,
    reasoning: true,
    defaultThinkingLevel: "medium",
    thinkingLevelOptions: ["low", "medium", "high"],
    contextWindow: 256_000,
    maxTokens: 64_000,
    recommended: true
  },
  {
    id: "sub:cursor:grok-4.7",
    provider: "cursor",
    modelId: "grok-4.7",
    label: "Grok 4.7 (Cursor)",
    api: "cursor-connect",
    baseUrl: CURSOR_API_BASE_URL,
    reasoning: true,
    defaultThinkingLevel: "high",
    thinkingLevelOptions: ["low", "medium", "high", "xhigh"],
    contextWindow: 256_000,
    recommended: false
  },
  {
    id: "sub:cursor:claude-sonnet-5.5",
    provider: "cursor",
    modelId: "claude-sonnet-5.5",
    label: "Claude Sonnet 5.5 (Cursor)",
    api: "cursor-connect",
    baseUrl: CURSOR_API_BASE_URL,
    reasoning: true,
    defaultThinkingLevel: "medium",
    thinkingLevelOptions: ["low", "medium", "high"],
    contextWindow: 1_000_000,
    maxTokens: 128_000,
    recommended: false
  },
  {
    id: "sub:cursor:claude-opus-5.5",
    provider: "cursor",
    modelId: "claude-opus-5.5",
    label: "Claude Opus 5.5 (Cursor)",
    api: "cursor-connect",
    baseUrl: CURSOR_API_BASE_URL,
    reasoning: true,
    defaultThinkingLevel: "high",
    thinkingLevelOptions: ["low", "medium", "high"],
    contextWindow: 1_000_000,
    maxTokens: 128_000,
    recommended: false
  },
  {
    id: "sub:cursor:gemini-4-neon",
    provider: "cursor",
    modelId: "gemini-4-neon",
    label: "Gemini 4 Neon (Cursor)",
    api: "cursor-connect",
    baseUrl: CURSOR_API_BASE_URL,
    reasoning: true,
    defaultThinkingLevel: "medium",
    thinkingLevelOptions: ["low", "medium", "high"],
    contextWindow: 1_048_576,
    maxTokens: 65_536,
    recommended: false
  }
];

interface DiscoveredCursorCandidate {
  candidateId: string;
  displayName: string;
  email?: string;
  planTier?: string;
  sourceLabel: string;
  sourcePathHint: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string;
  userId?: string;
}

function formatCursorPlanTier(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const lower = raw.trim().toLowerCase();
  if (lower === "ultra") return "Ultra";
  if (lower === "pro_plus" || lower === "pro+") return "Pro+";
  if (lower === "pro") return "Pro";
  if (lower === "business") return "Business";
  if (lower === "enterprise") return "Enterprise";
  if (lower === "free" || lower === "free_trial") return "Free";
  return raw.trim();
}

function extractCursorClaims(accessToken: string): {
  userId?: string;
  email?: string;
  expiresAt?: string;
} {
  const payload = decodeJwtPayload(accessToken);
  const rawSub = nonEmptyString(payload?.sub);
  const userId = rawSub
    ? rawSub.includes("|")
      ? rawSub.split("|").pop()
      : rawSub
    : undefined;
  const email = nonEmptyString(payload?.email);
  const expiresAt = toIsoExpiry(payload?.exp);
  return {
    ...(userId ? { userId } : {}),
    ...(email ? { email } : {}),
    ...(expiresAt ? { expiresAt } : {})
  };
}

function nextMonthlyResetIso(
  startOfMonthRaw: unknown,
  nowMs: number
): string | undefined {
  const startIso = toIsoExpiry(startOfMonthRaw, nowMs);
  if (!startIso) return undefined;
  const date = new Date(startIso);
  date.setUTCMonth(date.getUTCMonth() + 1);
  return date.toISOString();
}

function parseManualCursorInput(input: ManualTokenImportInput): {
  accessToken: string;
  refreshToken?: string;
  email?: string;
  displayName?: string;
  userId?: string;
  sessionCookie?: string;
} {
  const raw = input.token.trim();
  if (!raw) {
    throw new SubscriptionError(
      "subscriptions.invalid_manual_token",
      "请输入有效的 Cursor 访问令牌或会话凭证。"
    );
  }
  if (raw.startsWith("{")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      throw new SubscriptionError(
        "subscriptions.invalid_manual_token",
        "粘贴的 Cursor 凭证 JSON 格式无效，请检查后重试。"
      );
    }
    if (!isRecord(parsed)) {
      throw new SubscriptionError(
        "subscriptions.invalid_manual_token",
        "粘贴的 Cursor 凭证 JSON 必须为对象格式。"
      );
    }
    const accessToken =
      nonEmptyString(parsed.accessToken) ??
      nonEmptyString(parsed.access_token) ??
      nonEmptyString(parsed.token);
    if (!accessToken) {
      throw new SubscriptionError(
        "subscriptions.invalid_manual_token",
        "粘贴的 Cursor 凭证 JSON 缺少 accessToken 字段。"
      );
    }
    const refreshToken =
      nonEmptyString(input.refreshToken) ??
      nonEmptyString(parsed.refreshToken) ??
      nonEmptyString(parsed.refresh_token);
    const email = nonEmptyString(input.email) ?? nonEmptyString(parsed.email);
    const displayName =
      nonEmptyString(input.displayName) ?? nonEmptyString(parsed.displayName);
    return {
      accessToken,
      ...(refreshToken ? { refreshToken } : {}),
      ...(email ? { email } : {}),
      ...(displayName ? { displayName } : {})
    };
  }

  // Handle WorkosCursorSessionToken format: `user_xxx%3A%3A<jwt>` or `user_xxx::<jwt>`
  const decodedCookie = raw.includes("%3A%3A") ? decodeURIComponent(raw) : raw;
  const sepIndex = decodedCookie.indexOf("::");
  if (sepIndex > 0) {
    const userId = decodedCookie.slice(0, sepIndex).trim();
    const jwt = decodedCookie.slice(sepIndex + 2).trim();
    if (!jwt) {
      throw new SubscriptionError(
        "subscriptions.invalid_manual_token",
        "WorkosCursorSessionToken 格式不完整，缺少 JWT 令牌部分。"
      );
    }
    return {
      accessToken: jwt,
      ...(nonEmptyString(input.refreshToken)
        ? { refreshToken: input.refreshToken!.trim() }
        : {}),
      ...(userId ? { userId } : {}),
      sessionCookie: raw,
      ...(nonEmptyString(input.email) ? { email: input.email!.trim() } : {}),
      ...(nonEmptyString(input.displayName)
        ? { displayName: input.displayName!.trim() }
        : {})
    };
  }

  return {
    accessToken: raw,
    ...(nonEmptyString(input.refreshToken)
      ? { refreshToken: input.refreshToken!.trim() }
      : {}),
    ...(nonEmptyString(input.email) ? { email: input.email!.trim() } : {}),
    ...(nonEmptyString(input.displayName)
      ? { displayName: input.displayName!.trim() }
      : {})
  };
}

export function createCursorAdapter(
  options: CursorAdapterOptions = {}
): SubscriptionProviderAdapter {
  const ctx = resolveAdapterContext(options);
  const apiBaseUrl = (options.apiBaseUrl ?? CURSOR_API_BASE_URL).replace(
    /\/+$/u,
    ""
  );
  const webBaseUrl = (options.webBaseUrl ?? CURSOR_WEB_BASE_URL).replace(
    /\/+$/u,
    ""
  );
  const authBaseUrl = (options.authBaseUrl ?? CURSOR_AUTH_BASE_URL).replace(
    /\/+$/u,
    ""
  );
  const clientId = options.clientId ?? CURSOR_CLIENT_ID;
  const meta = DEFAULT_SUBSCRIPTION_PROVIDER_METADATA.cursor;

  const scanCursorLocalSources = async (): Promise<
    DiscoveredCursorCandidate[]
  > => {
    const sqlitePaths: string[] = [];
    if (ctx.env.CURSOR_USER_DATA_DIR) {
      sqlitePaths.push(
        resolveHomeSubpath(
          ctx.env.CURSOR_USER_DATA_DIR,
          "User",
          "globalStorage",
          "state.vscdb"
        ),
        resolveHomeSubpath(
          ctx.env.CURSOR_USER_DATA_DIR,
          "globalStorage",
          "state.vscdb"
        )
      );
    }
    if (ctx.env.APPDATA) {
      sqlitePaths.push(
        resolveHomeSubpath(
          ctx.env.APPDATA,
          "Cursor",
          "User",
          "globalStorage",
          "state.vscdb"
        )
      );
    }
    sqlitePaths.push(
      resolveHomeSubpath(
        ctx.homeDir,
        "Library",
        "Application Support",
        "Cursor",
        "User",
        "globalStorage",
        "state.vscdb"
      ),
      resolveHomeSubpath(
        ctx.homeDir,
        ".config",
        "Cursor",
        "User",
        "globalStorage",
        "state.vscdb"
      )
    );

    const found: DiscoveredCursorCandidate[] = [];
    const seen = new Set<string>();

    for (let i = 0; i < sqlitePaths.length; i += 1) {
      const dbPath = sqlitePaths[i]!;
      const items = await readSqliteItemsReadOnly(dbPath, CURSOR_SQLITE_KEYS);
      if (!items) continue;
      const accessToken = nonEmptyString(items["cursorAuth/accessToken"]);
      const refreshToken = nonEmptyString(items["cursorAuth/refreshToken"]);
      if (!accessToken && !refreshToken) continue;

      const claims = accessToken ? extractCursorClaims(accessToken) : {};
      const email =
        nonEmptyString(items["cursorAuth/cachedEmail"]) ?? claims.email;
      const planTier = formatCursorPlanTier(
        nonEmptyString(items["cursorAuth/stripeMembershipType"])
      );
      const displayName = email ?? "Cursor 账号";
      const dedupeKey = `${email ?? displayName}:${(accessToken ?? refreshToken ?? "").slice(-6)}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      found.push({
        candidateId: `cursor:sqlite:${i}`,
        displayName,
        ...(email ? { email } : {}),
        ...(planTier ? { planTier } : {}),
        sourceLabel: "Cursor 本地状态库（只读）",
        sourcePathHint: maskPathHint(dbPath, ctx.homeDir),
        accessToken: accessToken ?? "pending-refresh",
        ...(refreshToken ? { refreshToken } : {}),
        ...(claims.expiresAt ? { expiresAt: claims.expiresAt } : {}),
        ...(claims.userId ? { userId: claims.userId } : {})
      });
    }

    const jsonFallbackPath = resolveHomeSubpath(
      ctx.homeDir,
      ".cursor",
      "auth.json"
    );
    const jsonRaw = await readJsonFileReadOnly(jsonFallbackPath);
    if (isRecord(jsonRaw)) {
      const accessToken =
        nonEmptyString(jsonRaw.accessToken) ??
        nonEmptyString(jsonRaw.access_token);
      const refreshToken =
        nonEmptyString(jsonRaw.refreshToken) ??
        nonEmptyString(jsonRaw.refresh_token);
      if (accessToken || refreshToken) {
        const claims = accessToken ? extractCursorClaims(accessToken) : {};
        const email = nonEmptyString(jsonRaw.email) ?? claims.email;
        const displayName = email ?? "Cursor 账号";
        const dedupeKey = `${email ?? displayName}:${(accessToken ?? refreshToken ?? "").slice(-6)}`;
        if (!seen.has(dedupeKey)) {
          seen.add(dedupeKey);
          found.push({
            candidateId: "cursor:json:0",
            displayName,
            ...(email ? { email } : {}),
            ...(formatCursorPlanTier(nonEmptyString(jsonRaw.membershipType))
              ? {
                  planTier: formatCursorPlanTier(
                    nonEmptyString(jsonRaw.membershipType)
                  )!
                }
              : {}),
            sourceLabel: "Cursor 本地配置",
            sourcePathHint: maskPathHint(jsonFallbackPath, ctx.homeDir),
            accessToken: accessToken ?? "pending-refresh",
            ...(refreshToken ? { refreshToken } : {}),
            ...(claims.expiresAt ? { expiresAt: claims.expiresAt } : {}),
            ...(claims.userId ? { userId: claims.userId } : {})
          });
        }
      }
    }

    return found;
  };

  return {
    id: "cursor",
    meta,

    async startAuth(authCtx: AuthFlowContext): Promise<AuthFlowHandle> {
      const pkce = generatePkcePair();
      const uuid = randomUUID();
      const loginUrl = new URL(`${webBaseUrl}/loginDeepControl`);
      loginUrl.searchParams.set("challenge", pkce.codeChallenge);
      loginUrl.searchParams.set("uuid", uuid);
      loginUrl.searchParams.set("mode", "login");
      const verificationUri = loginUrl.toString();
      await authCtx.openExternalUrl(verificationUri);

      let cancelled = false;
      const deadlineMs = ctx.now() + 5 * 60 * 1_000;
      const completion = (async (): Promise<ImportedAccountResult> => {
        while (
          !cancelled &&
          !authCtx.signal.aborted &&
          ctx.now() < deadlineMs
        ) {
          await sleepWithAbort(2_000, authCtx.signal);
          const pollUrl = new URL(`${apiBaseUrl}/auth/poll`);
          pollUrl.searchParams.set("uuid", uuid);
          pollUrl.searchParams.set("verifier", pkce.codeVerifier);
          const pollResp = await ctx.fetcher(pollUrl.toString(), {
            method: "GET",
            headers: { Accept: "application/json" },
            signal: authCtx.signal
          });
          if (pollResp.status === 404 || pollResp.status === 202) {
            continue;
          }
          if (!pollResp.ok) {
            throwHttpSubscriptionError(pollResp.status, "Cursor");
          }
          const data = (await pollResp
            .json()
            .catch(() => undefined)) as unknown;
          if (!isRecord(data)) continue;
          const accessToken =
            nonEmptyString(data.accessToken) ??
            nonEmptyString(data.access_token);
          if (!accessToken) continue;
          const refreshToken =
            nonEmptyString(data.refreshToken) ??
            nonEmptyString(data.refresh_token);
          const claims = extractCursorClaims(accessToken);
          const email = nonEmptyString(data.email) ?? claims.email;
          const userId = claims.userId;
          return {
            displayName: email ?? "Cursor 账号",
            ...(email ? { email } : {}),
            source: "oauth",
            secret: {
              accessToken,
              ...(refreshToken ? { refreshToken } : {}),
              ...(claims.expiresAt ? { expiresAt: claims.expiresAt } : {}),
              ...(userId ? { extra: { userId } } : {})
            }
          };
        }
        throw new SubscriptionError(
          "subscriptions.auth_timeout",
          "Cursor 浏览器授权超时，请重新发起。"
        );
      })();

      return {
        method: "oauth",
        verificationUri,
        completion,
        cancel: () => {
          cancelled = true;
        }
      };
    },

    async scanLocalCandidates(): Promise<LocalCredentialCandidate[]> {
      const candidates = await scanCursorLocalSources();
      return candidates.map((item) => ({
        candidateId: item.candidateId,
        provider: "cursor",
        displayName: item.displayName,
        ...(item.email ? { email: item.email } : {}),
        sourceLabel: item.sourceLabel,
        sourcePathHint: item.sourcePathHint
      }));
    },

    async importLocalCandidate(
      candidateId: string
    ): Promise<ImportedAccountResult> {
      const candidates = await scanCursorLocalSources();
      const target = candidates.find(
        (item) => item.candidateId === candidateId
      );
      if (!target) {
        throw new SubscriptionError(
          "subscriptions.candidate_not_found",
          "未在本机找到指定的 Cursor 状态凭证。"
        );
      }
      return {
        displayName: target.displayName,
        ...(target.email ? { email: target.email } : {}),
        ...(target.planTier ? { planTier: target.planTier } : {}),
        source: "local_import",
        secret: {
          accessToken: target.accessToken,
          ...(target.refreshToken ? { refreshToken: target.refreshToken } : {}),
          ...(target.expiresAt ? { expiresAt: target.expiresAt } : {}),
          extra: {
            ...(target.userId ? { userId: target.userId } : {})
          }
        }
      };
    },

    async importManualToken(
      input: ManualTokenImportInput
    ): Promise<ImportedAccountResult> {
      const parsed = parseManualCursorInput(input);
      const claims = extractCursorClaims(parsed.accessToken);
      const email = parsed.email ?? claims.email;
      const userId = parsed.userId ?? claims.userId;
      const displayName = parsed.displayName ?? email ?? "Cursor 手动导入账号";
      return {
        displayName,
        ...(email ? { email } : {}),
        source: "manual_token",
        secret: {
          accessToken: parsed.accessToken,
          ...(parsed.refreshToken ? { refreshToken: parsed.refreshToken } : {}),
          ...(claims.expiresAt ? { expiresAt: claims.expiresAt } : {}),
          extra: {
            ...(userId ? { userId } : {}),
            ...(parsed.sessionCookie
              ? { sessionCookie: parsed.sessionCookie }
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
        const expMs = secret.expiresAt ? Date.parse(secret.expiresAt) : NaN;
        if (
          nonEmptyString(secret.accessToken) &&
          secret.accessToken !== "pending-refresh" &&
          (!Number.isFinite(expMs) || expMs > ctx.now())
        ) {
          return secret;
        }
        throw new SubscriptionError(
          "subscriptions.secret_refresh_failed",
          "当前 Cursor 账号未包含刷新令牌且访问令牌已过期，请重新扫描本机或手动导入。"
        );
      }
      const response = await ctx.fetcher(`${authBaseUrl}/oauth/token`, {
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
        throwHttpSubscriptionError(response.status, "Cursor");
      }
      const data = (await response.json()) as unknown;
      if (isRecord(data) && data.shouldLogout === true) {
        throw new SubscriptionError(
          "subscriptions.secret_refresh_failed",
          "Cursor 会话已登出或失效，请重新登录或导入本机凭证。"
        );
      }
      if (!isRecord(data) || !nonEmptyString(data.access_token)) {
        throw new SubscriptionError(
          "subscriptions.secret_refresh_failed",
          "Cursor 刷新令牌响应缺少访问令牌。"
        );
      }
      const accessToken = data.access_token as string;
      const refreshToken =
        nonEmptyString(data.refresh_token) ?? secret.refreshToken;
      const claims = extractCursorClaims(accessToken);
      const expiresAt =
        toIsoExpiry(data.expires_in, ctx.now()) ??
        claims.expiresAt ??
        secret.expiresAt;
      const userId = claims.userId ?? secret.extra?.userId;
      return {
        ...secret,
        accessToken,
        refreshToken,
        ...(expiresAt ? { expiresAt } : {}),
        extra: {
          ...(secret.extra ?? {}),
          ...(userId ? { userId } : {})
        }
      };
    },

    async fetchQuota(
      account: StoredAccountRecord,
      secret: StoredAccountSecret,
      signal?: AbortSignal
    ): Promise<QuotaFetchResult> {
      const claims = extractCursorClaims(secret.accessToken);
      const userId = secret.extra?.userId ?? claims.userId;
      const headers: Record<string, string> = {
        Accept: "application/json",
        Authorization: `Bearer ${secret.accessToken}`
      };
      if (secret.extra?.sessionCookie) {
        headers.Cookie = `WorkosCursorSessionToken=${secret.extra.sessionCookie}`;
      } else if (userId) {
        headers.Cookie = `WorkosCursorSessionToken=${encodeURIComponent(`${userId}::${secret.accessToken}`)}`;
      }
      // Align with cockpit-tools cursor_account.rs: prefer /api/usage-summary, fall back to legacy /api/usage on 404.
      let response = await ctx.fetcher(`${webBaseUrl}/api/usage-summary`, {
        method: "GET",
        headers,
        ...(signal ? { signal } : {})
      });
      if (response.status === 404) {
        const legacyUrl = new URL(`${webBaseUrl}/api/usage`);
        if (userId) {
          legacyUrl.searchParams.set("user", userId);
        }
        response = await ctx.fetcher(legacyUrl.toString(), {
          method: "GET",
          headers,
          ...(signal ? { signal } : {})
        });
      }
      if (!response.ok) {
        throwHttpSubscriptionError(response.status, "Cursor");
      }
      const data = (await response.json()) as unknown;
      if (!isRecord(data)) {
        return { quotaBuckets: [] };
      }

      const resetsAt =
        toIsoExpiry(data.billingCycleEnd, ctx.now()) ??
        nextMonthlyResetIso(
          data.startOfMonth ?? data.billingCycleStart,
          ctx.now()
        );
      const buckets: SubscriptionQuotaBucket[] = [];

      const fastEntry = isRecord(data["gpt-4"]) ? data["gpt-4"] : undefined;
      if (fastEntry) {
        const used =
          typeof fastEntry.numRequests === "number" &&
          Number.isFinite(fastEntry.numRequests)
            ? Math.max(0, fastEntry.numRequests)
            : undefined;
        const limit =
          typeof fastEntry.maxRequestUsage === "number" &&
          Number.isFinite(fastEntry.maxRequestUsage) &&
          fastEntry.maxRequestUsage > 0
            ? fastEntry.maxRequestUsage
            : undefined;
        if (used !== undefined && limit !== undefined) {
          const remainingPercent = Math.min(
            100,
            Math.max(0, ((limit - used) / limit) * 100)
          );
          buckets.push({
            id: "cursor-fast-premium",
            label: "Fast / Premium 请求",
            remainingPercent,
            used,
            limit,
            unit: "requests",
            ...(resetsAt ? { resetsAt } : {})
          });
        }
      }

      const individualPlan =
        isRecord(data.individualUsage) && isRecord(data.individualUsage.plan)
          ? data.individualUsage.plan
          : undefined;
      if (individualPlan && buckets.length === 0) {
        const used =
          typeof individualPlan.used === "number"
            ? Math.max(0, individualPlan.used)
            : undefined;
        const limit =
          typeof individualPlan.limit === "number" && individualPlan.limit > 0
            ? individualPlan.limit
            : undefined;
        const usedPct =
          typeof individualPlan.totalPercentUsed === "number"
            ? individualPlan.totalPercentUsed
            : used !== undefined && limit !== undefined
              ? (used / limit) * 100
              : undefined;
        if (usedPct !== undefined) {
          buckets.push({
            id: "cursor-plan-quota",
            label: "Fast / Premium 套餐额度",
            remainingPercent: Math.min(100, Math.max(0, 100 - usedPct)),
            ...(used !== undefined ? { used } : {}),
            ...(limit !== undefined ? { limit } : {}),
            unit: "requests",
            ...(resetsAt ? { resetsAt } : {})
          });
        }
      }

      const planTier =
        formatCursorPlanTier(
          nonEmptyString(data.membershipType) ?? nonEmptyString(data.plan)
        ) ?? account.planTier;
      const primary = buckets[0];
      const exhausted =
        primary !== undefined &&
        primary.remainingPercent !== undefined &&
        primary.remainingPercent <= 0;

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
      const token = secret?.accessToken?.trim();
      if (!token || token === "pending-refresh") {
        return CURSOR_BASELINE_MODELS.map((item) => ({
          ...item,
          baseUrl: apiBaseUrl
        }));
      }
      try {
        const response = await ctx.fetcher(
          `${apiBaseUrl}/aiserver.v1.AiService/AvailableModels`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
              "Connect-Protocol-Version": "1",
              Authorization: `Bearer ${token}`
            },
            body: JSON.stringify({}),
            ...(signal ? { signal } : {})
          }
        );
        if (!response.ok) {
          return CURSOR_BASELINE_MODELS.map((item) => ({
            ...item,
            baseUrl: apiBaseUrl
          }));
        }
        const raw = (await response.json()) as unknown;
        const list =
          isRecord(raw) && Array.isArray(raw.models)
            ? raw.models
            : isRecord(raw) && Array.isArray(raw.data)
              ? raw.data
              : [];
        if (list.length === 0) {
          return CURSOR_BASELINE_MODELS.map((item) => ({
            ...item,
            baseUrl: apiBaseUrl
          }));
        }
        const byBaseline = new Map(
          CURSOR_BASELINE_MODELS.map((item) => [item.modelId, item])
        );
        const models: SubscriptionModelDefinition[] = [];
        for (const item of list) {
          if (!isRecord(item)) continue;
          const modelId = nonEmptyString(item.name) ?? nonEmptyString(item.id);
          if (!modelId) continue;
          const id = `sub:cursor:${modelId.toLowerCase()}`;
          if (id.length > 120) continue;
          const baseline = byBaseline.get(modelId);
          const reasoning =
            typeof item.supportsThinking === "boolean"
              ? item.supportsThinking
              : true;
          const ctxWindow =
            typeof item.maxTokenLength === "number" &&
            item.maxTokenLength >= 1_024
              ? item.maxTokenLength
              : undefined;
          models.push({
            ...(baseline ?? {
              id,
              provider: "cursor",
              modelId,
              label:
                nonEmptyString(item.clientDisplayName) ??
                nonEmptyString(item.displayName) ??
                `${modelId} (Cursor)`,
              api: "cursor-connect",
              baseUrl: apiBaseUrl,
              reasoning,
              defaultThinkingLevel: reasoning ? "medium" : "off",
              ...(reasoning
                ? { thinkingLevelOptions: ["low", "medium", "high"] as const }
                : {}),
              contextWindow: ctxWindow ?? 200_000,
              maxTokens: 64_000,
              recommended: models.length === 0
            }),
            ...(ctxWindow ? { contextWindow: ctxWindow } : {}),
            baseUrl: apiBaseUrl
          });
        }
        if (models.length === 0) {
          return CURSOR_BASELINE_MODELS.map((item) => ({
            ...item,
            baseUrl: apiBaseUrl
          }));
        }
        if (!models.some((m) => m.recommended)) {
          models[0] = { ...models[0]!, recommended: true };
        }
        return models;
      } catch {
        return CURSOR_BASELINE_MODELS.map((item) => ({
          ...item,
          baseUrl: apiBaseUrl
        }));
      }
    },

    toRuntimeCredential(account, secret) {
      return {
        provider: "cursor",
        accountId: account.id,
        apiKey: secret.accessToken,
        baseUrl: apiBaseUrl,
        ...(secret.expiresAt ? { expiresAt: secret.expiresAt } : {}),
        metadata: {
          endpoint: apiBaseUrl
        }
      };
    }
  };
}
