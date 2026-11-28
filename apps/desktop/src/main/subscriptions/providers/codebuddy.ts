import type { SubscriptionQuotaBucket } from "@writer/contracts";
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

const CODEBUDDY_INTL_BASE_URL = "https://www.codebuddy.ai";
const CODEBUDDY_CN_BASE_URL = "https://www.codebuddy.cn";
const CODEBUDDY_BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36";
const CODEBUDDY_SQLITE_KEYS = [
  "codebuddy.auth",
  "codebuddyAuth/accessToken",
  "tencent.cloudcode.auth"
] as const;

export interface CodeBuddyAdapterOptions extends ProviderEnvironmentOptions {
  apiBaseUrl?: string;
  region?: "intl" | "cn";
  pollIntervalMs?: number;
}

export const CODEBUDDY_BASELINE_MODELS: readonly SubscriptionModelDefinition[] =
  [
    {
      id: "sub:codebuddy:deepseek-v4-pro",
      provider: "codebuddy",
      modelId: "deepseek-v4-pro",
      label: "DeepSeek V4 Pro (CodeBuddy)",
      description: "CodeBuddy 订阅最新主力深度思考与长文写作模型",
      api: "codebuddy-chat",
      baseUrl: CODEBUDDY_INTL_BASE_URL,
      reasoning: true,
      defaultThinkingLevel: "medium",
      thinkingLevelOptions: ["low", "medium", "high"],
      contextWindow: 1_000_000,
      recommended: true
    },
    {
      id: "sub:codebuddy:deepseek-v4-flash",
      provider: "codebuddy",
      modelId: "deepseek-v4-flash",
      label: "DeepSeek V4 Flash (CodeBuddy)",
      api: "codebuddy-chat",
      baseUrl: CODEBUDDY_INTL_BASE_URL,
      reasoning: true,
      defaultThinkingLevel: "medium",
      thinkingLevelOptions: ["low", "medium", "high"],
      contextWindow: 1_000_000,
      recommended: false
    },
    {
      id: "sub:codebuddy:glm-5.3",
      provider: "codebuddy",
      modelId: "glm-5.3",
      label: "GLM-5.3 (CodeBuddy)",
      api: "codebuddy-chat",
      baseUrl: CODEBUDDY_INTL_BASE_URL,
      reasoning: true,
      defaultThinkingLevel: "medium",
      thinkingLevelOptions: ["low", "medium", "high"],
      contextWindow: 1_000_000,
      recommended: false
    },
    {
      id: "sub:codebuddy:glm-5.3-flash",
      provider: "codebuddy",
      modelId: "glm-5.3-flash",
      label: "GLM-5.3 Flash (CodeBuddy)",
      api: "codebuddy-chat",
      baseUrl: CODEBUDDY_INTL_BASE_URL,
      reasoning: true,
      defaultThinkingLevel: "medium",
      thinkingLevelOptions: ["low", "medium", "high"],
      recommended: false
    },
    {
      id: "sub:codebuddy:kimi-k3",
      provider: "codebuddy",
      modelId: "kimi-k3",
      label: "Kimi K3 (CodeBuddy)",
      api: "codebuddy-chat",
      baseUrl: CODEBUDDY_INTL_BASE_URL,
      reasoning: true,
      defaultThinkingLevel: "medium",
      thinkingLevelOptions: ["low", "medium", "high"],
      recommended: false
    }
  ];

interface DiscoveredCodeBuddyCandidate {
  candidateId: string;
  displayName: string;
  email?: string;
  planTier?: string;
  sourceLabel: string;
  sourcePathHint: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string;
  endpoint?: string;
}

function formatCodeBuddyPlanTier(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const lower = raw.trim().toLowerCase();
  if (lower.includes("enterprise")) return "Enterprise";
  if (lower.includes("team")) return "Team";
  if (lower.includes("pro+") || lower.includes("pro_plus")) return "Pro+";
  if (lower.includes("pro")) return "Pro";
  if (lower.includes("free") || lower.includes("trial")) return "Free";
  return raw.trim();
}

function parseCodeBuddyBlob(
  raw: unknown,
  nowMs: number
): {
  accessToken?: string;
  refreshToken?: string;
  email?: string;
  displayName?: string;
  planTier?: string;
  expiresAt?: string;
  endpoint?: string;
} {
  let obj: unknown = raw;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (trimmed.startsWith("{")) {
      try {
        obj = JSON.parse(trimmed) as unknown;
      } catch {
        return { accessToken: trimmed };
      }
    } else if (trimmed) {
      return { accessToken: trimmed };
    }
  }
  if (!isRecord(obj)) return {};
  const accessToken =
    nonEmptyString(obj.accessToken) ??
    nonEmptyString(obj.access_token) ??
    nonEmptyString(obj.token);
  const refreshToken =
    nonEmptyString(obj.refreshToken) ?? nonEmptyString(obj.refresh_token);
  const claims = decodeJwtPayload(accessToken);
  const email = nonEmptyString(obj.email) ?? nonEmptyString(claims?.email);
  const displayName =
    nonEmptyString(obj.nickname) ??
    nonEmptyString(obj.displayName) ??
    nonEmptyString(obj.username) ??
    email;
  const planTier = formatCodeBuddyPlanTier(
    nonEmptyString(obj.planTier) ??
      nonEmptyString(obj.plan_name) ??
      nonEmptyString(obj.tier)
  );
  const expiresAt = toIsoExpiry(
    obj.expiresAt ?? obj.expires_at ?? claims?.exp,
    nowMs
  );
  const endpoint =
    nonEmptyString(obj.endpoint) ?? nonEmptyString(obj.apiBaseUrl);
  return {
    ...(accessToken ? { accessToken } : {}),
    ...(refreshToken ? { refreshToken } : {}),
    ...(email ? { email } : {}),
    ...(displayName ? { displayName } : {}),
    ...(planTier ? { planTier } : {}),
    ...(expiresAt ? { expiresAt } : {}),
    ...(endpoint ? { endpoint } : {})
  };
}

function parseQuotaEntry(
  id: string,
  label: string,
  entry: unknown,
  fallbackReset: string | undefined,
  nowMs: number
): SubscriptionQuotaBucket | undefined {
  if (!isRecord(entry)) return undefined;
  const used =
    typeof entry.used === "number" && Number.isFinite(entry.used)
      ? Math.max(0, entry.used)
      : undefined;
  const limit =
    typeof entry.limit === "number" &&
    Number.isFinite(entry.limit) &&
    entry.limit > 0
      ? entry.limit
      : typeof entry.total === "number" &&
          Number.isFinite(entry.total) &&
          entry.total > 0
        ? entry.total
        : undefined;
  const remainingPercent =
    typeof entry.remaining_percent === "number" &&
    Number.isFinite(entry.remaining_percent)
      ? Math.min(100, Math.max(0, entry.remaining_percent))
      : used !== undefined && limit !== undefined
        ? Math.min(100, Math.max(0, ((limit - used) / limit) * 100))
        : undefined;
  const resetsAt =
    toIsoExpiry(entry.reset_at ?? entry.resets_at ?? entry.expires_at, nowMs) ??
    fallbackReset;
  if (remainingPercent === undefined && used === undefined) return undefined;
  return {
    id,
    label,
    ...(remainingPercent !== undefined ? { remainingPercent } : {}),
    ...(used !== undefined ? { used } : {}),
    ...(limit !== undefined ? { limit } : {}),
    unit: nonEmptyString(entry.unit) ?? "requests",
    ...(resetsAt ? { resetsAt } : {})
  };
}

function parseBillingResourceBuckets(
  data: Record<string, unknown>,
  nowMs: number
): SubscriptionQuotaBucket[] {
  const nested = isRecord(data.data) ? data.data : data;
  const rawList = Array.isArray(nested.PackageList)
    ? nested.PackageList
    : Array.isArray(nested.ResourceList)
      ? nested.ResourceList
      : Array.isArray(nested.packages)
        ? nested.packages
        : Array.isArray(data.data)
          ? data.data
          : [];
  const buckets: SubscriptionQuotaBucket[] = [];
  for (let i = 0; i < rawList.length; i += 1) {
    const item = rawList[i];
    if (!isRecord(item)) continue;
    const total =
      typeof item.Total === "number" && item.Total > 0
        ? item.Total
        : typeof item.total === "number" && item.total > 0
          ? item.total
          : undefined;
    const remain =
      typeof item.Remain === "number" && Number.isFinite(item.Remain)
        ? Math.max(0, item.Remain)
        : typeof item.remain === "number" && Number.isFinite(item.remain)
          ? Math.max(0, item.remain)
          : undefined;
    const used =
      typeof item.Used === "number" && Number.isFinite(item.Used)
        ? Math.max(0, item.Used)
        : typeof item.used === "number" && Number.isFinite(item.used)
          ? Math.max(0, item.used)
          : total !== undefined && remain !== undefined
            ? Math.max(0, total - remain)
            : undefined;
    const remainingPercent =
      total !== undefined && remain !== undefined
        ? Math.min(100, Math.max(0, (remain / total) * 100))
        : total !== undefined && used !== undefined
          ? Math.min(100, Math.max(0, ((total - used) / total) * 100))
          : undefined;
    const resetsAt = toIsoExpiry(
      item.ExpiredTime ?? item.expired_time ?? item.reset_at ?? item.expires_at,
      nowMs
    );
    const label =
      nonEmptyString(item.PackageName) ??
      nonEmptyString(item.ResourceName) ??
      nonEmptyString(item.name) ??
      `资源包 ${i + 1}`;
    if (remainingPercent === undefined && used === undefined) continue;
    buckets.push({
      id: `codebuddy-pkg-${i}`,
      label,
      ...(remainingPercent !== undefined ? { remainingPercent } : {}),
      ...(used !== undefined ? { used } : {}),
      ...(total !== undefined ? { limit: total } : {}),
      unit: nonEmptyString(item.Unit) ?? "credits",
      ...(resetsAt ? { resetsAt } : {})
    });
  }
  return buckets.slice(0, 20);
}

export function createCodeBuddyAdapter(
  options: CodeBuddyAdapterOptions = {}
): SubscriptionProviderAdapter {
  const ctx = resolveAdapterContext(options);
  const defaultDomain =
    options.region === "cn" || ctx.env.CODEBUDDY_REGION?.toLowerCase() === "cn"
      ? CODEBUDDY_CN_BASE_URL
      : CODEBUDDY_INTL_BASE_URL;
  const apiBaseUrl = (options.apiBaseUrl ?? defaultDomain).replace(/\/+$/u, "");
  const pollIntervalMs = options.pollIntervalMs ?? 2_000;
  const meta = DEFAULT_SUBSCRIPTION_PROVIDER_METADATA.codebuddy;

  const scanCodeBuddyLocalSources = async (): Promise<
    DiscoveredCodeBuddyCandidate[]
  > => {
    const jsonPaths: string[] = [];
    if (ctx.env.CODEBUDDY_CONFIG_DIR) {
      jsonPaths.push(
        resolveHomeSubpath(ctx.env.CODEBUDDY_CONFIG_DIR, "auth.json"),
        resolveHomeSubpath(ctx.env.CODEBUDDY_CONFIG_DIR, "credentials.json")
      );
    }
    jsonPaths.push(
      resolveHomeSubpath(ctx.homeDir, ".codebuddy", "auth.json"),
      resolveHomeSubpath(ctx.homeDir, ".codebuddy", "credentials.json"),
      resolveHomeSubpath(ctx.homeDir, ".config", "codebuddy", "auth.json")
    );

    const sqlitePaths: string[] = [];
    if (ctx.env.CODEBUDDY_USER_DATA_DIR) {
      sqlitePaths.push(
        resolveHomeSubpath(
          ctx.env.CODEBUDDY_USER_DATA_DIR,
          "User",
          "globalStorage",
          "state.vscdb"
        )
      );
    }
    if (ctx.env.APPDATA) {
      sqlitePaths.push(
        resolveHomeSubpath(
          ctx.env.APPDATA,
          "CodeBuddy",
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
        "CodeBuddy",
        "User",
        "globalStorage",
        "state.vscdb"
      ),
      resolveHomeSubpath(
        ctx.homeDir,
        ".config",
        "CodeBuddy",
        "User",
        "globalStorage",
        "state.vscdb"
      )
    );

    const found: DiscoveredCodeBuddyCandidate[] = [];
    const seen = new Set<string>();

    for (let i = 0; i < jsonPaths.length; i += 1) {
      const filePath = jsonPaths[i]!;
      const raw = await readJsonFileReadOnly(filePath);
      if (!raw) continue;
      const parsed = parseCodeBuddyBlob(raw, ctx.now());
      if (!parsed.accessToken && !parsed.refreshToken) continue;
      const displayName =
        parsed.displayName ?? parsed.email ?? "CodeBuddy 账号";
      const dedupeKey = `${parsed.email ?? displayName}:${(parsed.accessToken ?? parsed.refreshToken ?? "").slice(-6)}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      found.push({
        candidateId: `codebuddy:json:${i}`,
        displayName,
        ...(parsed.email ? { email: parsed.email } : {}),
        ...(parsed.planTier ? { planTier: parsed.planTier } : {}),
        sourceLabel: "CodeBuddy 本地配置（只读）",
        sourcePathHint: maskPathHint(filePath, ctx.homeDir),
        accessToken: parsed.accessToken ?? "pending-refresh",
        ...(parsed.refreshToken ? { refreshToken: parsed.refreshToken } : {}),
        ...(parsed.expiresAt ? { expiresAt: parsed.expiresAt } : {}),
        ...(parsed.endpoint ? { endpoint: parsed.endpoint } : {})
      });
    }

    for (let i = 0; i < sqlitePaths.length; i += 1) {
      const dbPath = sqlitePaths[i]!;
      const items = await readSqliteItemsReadOnly(
        dbPath,
        CODEBUDDY_SQLITE_KEYS
      );
      if (!items) continue;
      const rawVal =
        items["codebuddy.auth"] ??
        items["tencent.cloudcode.auth"] ??
        items["codebuddyAuth/accessToken"];
      if (!rawVal) continue;
      const parsed = parseCodeBuddyBlob(rawVal, ctx.now());
      if (!parsed.accessToken && !parsed.refreshToken) continue;
      const displayName =
        parsed.displayName ?? parsed.email ?? "CodeBuddy 账号";
      const dedupeKey = `${parsed.email ?? displayName}:${(parsed.accessToken ?? parsed.refreshToken ?? "").slice(-6)}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      found.push({
        candidateId: `codebuddy:sqlite:${i}`,
        displayName,
        ...(parsed.email ? { email: parsed.email } : {}),
        ...(parsed.planTier ? { planTier: parsed.planTier } : {}),
        sourceLabel: "CodeBuddy IDE 本地状态库（只读）",
        sourcePathHint: maskPathHint(dbPath, ctx.homeDir),
        accessToken: parsed.accessToken ?? "pending-refresh",
        ...(parsed.refreshToken ? { refreshToken: parsed.refreshToken } : {}),
        ...(parsed.expiresAt ? { expiresAt: parsed.expiresAt } : {}),
        ...(parsed.endpoint ? { endpoint: parsed.endpoint } : {})
      });
    }

    return found;
  };

  return {
    id: "codebuddy",
    meta,

    async startAuth(authCtx: AuthFlowContext): Promise<AuthFlowHandle> {
      // Align with cockpit-tools codebuddy_oauth.rs: state-polling flow with browser UA.
      const stateResp = await ctx.fetcher(
        `${apiBaseUrl}/v2/plugin/auth/state?platform=ide`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            "X-No-Authorization": "true",
            "User-Agent": CODEBUDDY_BROWSER_USER_AGENT
          },
          body: JSON.stringify({}),
          signal: authCtx.signal
        }
      );
      if (!stateResp.ok) {
        throwHttpSubscriptionError(stateResp.status, "CodeBuddy");
      }
      const statePayload = (await stateResp.json()) as unknown;
      const stateData =
        isRecord(statePayload) && isRecord(statePayload.data)
          ? statePayload.data
          : statePayload;
      const state = isRecord(stateData)
        ? nonEmptyString(stateData.state)
        : undefined;
      if (!state) {
        throw new SubscriptionError(
          "subscriptions.oauth_exchange_failed",
          "CodeBuddy 未返回有效的登录状态码。"
        );
      }
      const verificationUri =
        (isRecord(stateData)
          ? (nonEmptyString(stateData.authUrl) ??
            nonEmptyString(stateData.loginUrl))
          : undefined) ??
        `${apiBaseUrl}/login?state=${encodeURIComponent(state)}`;
      await authCtx.openExternalUrl(verificationUri);

      let cancelled = false;
      const deadlineMs = ctx.now() + 5 * 60 * 1_000;
      const completion = (async (): Promise<ImportedAccountResult> => {
        while (
          !cancelled &&
          !authCtx.signal.aborted &&
          ctx.now() < deadlineMs
        ) {
          await sleepWithAbort(pollIntervalMs, authCtx.signal);
          const tokenResp = await ctx.fetcher(
            `${apiBaseUrl}/v2/plugin/auth/token?state=${encodeURIComponent(state)}`,
            {
              method: "GET",
              headers: {
                Accept: "application/json",
                "X-No-Authorization": "true",
                "User-Agent": CODEBUDDY_BROWSER_USER_AGENT
              },
              signal: authCtx.signal
            }
          );
          if (tokenResp.status === 202 || tokenResp.status === 404) {
            continue;
          }
          if (!tokenResp.ok) {
            throwHttpSubscriptionError(tokenResp.status, "CodeBuddy");
          }
          const raw = (await tokenResp
            .json()
            .catch(() => undefined)) as unknown;
          const tokenBody =
            isRecord(raw) && isRecord(raw.data) ? raw.data : raw;
          const parsed = parseCodeBuddyBlob(tokenBody, ctx.now());
          if (!parsed.accessToken) {
            continue;
          }

          let email = parsed.email;
          let displayName = parsed.displayName;
          let enterpriseId: string | undefined;
          try {
            const acctResp = await ctx.fetcher(
              `${apiBaseUrl}/v2/plugin/login/account?state=${encodeURIComponent(state)}`,
              {
                method: "GET",
                headers: {
                  Accept: "application/json",
                  Authorization: `Bearer ${parsed.accessToken}`,
                  "User-Agent": CODEBUDDY_BROWSER_USER_AGENT
                },
                signal: authCtx.signal
              }
            );
            if (acctResp.ok) {
              const acctRaw = (await acctResp.json()) as unknown;
              const acct =
                isRecord(acctRaw) && isRecord(acctRaw.data)
                  ? acctRaw.data
                  : acctRaw;
              if (isRecord(acct)) {
                email = nonEmptyString(acct.email) ?? email;
                displayName =
                  nonEmptyString(acct.nickname) ??
                  nonEmptyString(acct.username) ??
                  displayName;
                enterpriseId =
                  nonEmptyString(acct.enterpriseId) ??
                  nonEmptyString(acct.enterprise_id);
              }
            }
          } catch {
            // Best-effort account info lookup.
          }

          const expiresAt =
            isRecord(tokenBody) && typeof tokenBody.expires_in === "number"
              ? toIsoExpiry(tokenBody.expires_in, ctx.now())
              : parsed.expiresAt;
          const extra: Record<string, string> = {
            endpoint: parsed.endpoint ?? apiBaseUrl,
            ...(enterpriseId ? { enterpriseId } : {})
          };
          return {
            displayName: displayName ?? email ?? "CodeBuddy 账号",
            ...(email ? { email } : {}),
            ...(parsed.planTier ? { planTier: parsed.planTier } : {}),
            source: "oauth",
            secret: {
              accessToken: parsed.accessToken,
              ...(parsed.refreshToken
                ? { refreshToken: parsed.refreshToken }
                : {}),
              ...(expiresAt ? { expiresAt } : {}),
              extra
            }
          };
        }
        throw new SubscriptionError(
          "subscriptions.auth_timeout",
          "CodeBuddy 浏览器登录超时，请重新发起。"
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

    async importManualToken(
      input: ManualTokenImportInput
    ): Promise<ImportedAccountResult> {
      const raw = input.token.trim();
      if (!raw) {
        throw new SubscriptionError(
          "subscriptions.invalid_manual_token",
          "请输入有效的 CodeBuddy 访问令牌或凭证 JSON。"
        );
      }
      const parsed = parseCodeBuddyBlob(raw, ctx.now());
      if (!parsed.accessToken) {
        throw new SubscriptionError(
          "subscriptions.invalid_manual_token",
          "未能从输入中提取有效的 CodeBuddy 访问令牌。"
        );
      }
      const refreshToken =
        nonEmptyString(input.refreshToken) ?? parsed.refreshToken;
      const email = nonEmptyString(input.email) ?? parsed.email;
      const displayName =
        nonEmptyString(input.displayName) ??
        parsed.displayName ??
        email ??
        "CodeBuddy 手动导入账号";
      return {
        displayName,
        ...(email ? { email } : {}),
        ...(parsed.planTier ? { planTier: parsed.planTier } : {}),
        source: "manual_token",
        secret: {
          accessToken: parsed.accessToken,
          ...(refreshToken ? { refreshToken } : {}),
          ...(parsed.expiresAt ? { expiresAt: parsed.expiresAt } : {}),
          extra: {
            endpoint: parsed.endpoint ?? apiBaseUrl
          }
        }
      };
    },

    async scanLocalCandidates(): Promise<LocalCredentialCandidate[]> {
      const candidates = await scanCodeBuddyLocalSources();
      return candidates.map((item) => ({
        candidateId: item.candidateId,
        provider: "codebuddy",
        displayName: item.displayName,
        ...(item.email ? { email: item.email } : {}),
        sourceLabel: item.sourceLabel,
        sourcePathHint: item.sourcePathHint
      }));
    },

    async importLocalCandidate(
      candidateId: string
    ): Promise<ImportedAccountResult> {
      const candidates = await scanCodeBuddyLocalSources();
      const target = candidates.find(
        (item) => item.candidateId === candidateId
      );
      if (!target) {
        throw new SubscriptionError(
          "subscriptions.candidate_not_found",
          "未在本机找到指定的 CodeBuddy 凭证。"
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
          ...(target.endpoint ? { extra: { endpoint: target.endpoint } } : {})
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
          "当前 CodeBuddy 账号缺少刷新令牌，请重新登录或导入本机凭证。"
        );
      }
      const endpoint = (secret.extra?.endpoint ?? apiBaseUrl).replace(
        /\/+$/u,
        ""
      );
      // Align with cockpit-tools codebuddy_oauth.rs: POST /v2/plugin/auth/token/refresh + X-Refresh-Token.
      const response = await ctx.fetcher(
        `${endpoint}/v2/plugin/auth/token/refresh`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            "X-Refresh-Token": secret.refreshToken,
            ...(secret.accessToken && secret.accessToken !== "pending-refresh"
              ? { Authorization: `Bearer ${secret.accessToken}` }
              : {}),
            "User-Agent": CODEBUDDY_BROWSER_USER_AGENT
          },
          body: JSON.stringify({}),
          ...(signal ? { signal } : {})
        }
      );
      if (!response.ok) {
        throwHttpSubscriptionError(response.status, "CodeBuddy");
      }
      const raw = (await response.json()) as unknown;
      const data = isRecord(raw) && isRecord(raw.data) ? raw.data : raw;
      const parsed = parseCodeBuddyBlob(data, ctx.now());
      if (!parsed.accessToken) {
        throw new SubscriptionError(
          "subscriptions.secret_refresh_failed",
          "CodeBuddy 刷新令牌响应缺少访问令牌。"
        );
      }
      const expiresAt =
        (isRecord(data) && typeof data.expires_in === "number"
          ? toIsoExpiry(data.expires_in, ctx.now())
          : parsed.expiresAt) ?? secret.expiresAt;
      return {
        ...secret,
        accessToken: parsed.accessToken,
        refreshToken: parsed.refreshToken ?? secret.refreshToken,
        ...(expiresAt ? { expiresAt } : {})
      };
    },

    async fetchQuota(
      account: StoredAccountRecord,
      secret: StoredAccountSecret,
      signal?: AbortSignal
    ): Promise<QuotaFetchResult> {
      const endpoint = (secret.extra?.endpoint ?? apiBaseUrl).replace(
        /\/+$/u,
        ""
      );
      const isEnterprise = Boolean(secret.extra?.enterpriseId);
      const quotaUrl = isEnterprise
        ? `${endpoint}/v2/billing/meter/get-enterprise-user-usage`
        : `${endpoint}/v2/billing/meter/get-user-resource`;
      const response = await ctx.fetcher(quotaUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Authorization: `Bearer ${secret.accessToken}`,
          "User-Agent": CODEBUDDY_BROWSER_USER_AGENT
        },
        body: JSON.stringify(
          isEnterprise
            ? { enterpriseId: secret.extra?.enterpriseId }
            : { ProductCode: "p_tcaca", Status: [0, 3] }
        ),
        ...(signal ? { signal } : {})
      });
      if (!response.ok) {
        throwHttpSubscriptionError(response.status, "CodeBuddy");
      }
      const data = (await response.json()) as unknown;
      if (!isRecord(data)) {
        return { quotaBuckets: [] };
      }

      const planTier =
        formatCodeBuddyPlanTier(
          nonEmptyString(data.plan_name) ??
            nonEmptyString(data.tier) ??
            nonEmptyString(data.plan)
        ) ?? account.planTier;
      const defaultReset = toIsoExpiry(
        data.reset_at ?? data.expires_at ?? data.valid_until,
        ctx.now()
      );
      const buckets = parseBillingResourceBuckets(data, ctx.now());
      if (buckets.length === 0) {
        const chatBucket = parseQuotaEntry(
          "codebuddy-chat",
          "对话额度",
          data.chat_quota ?? data.quota ?? data,
          defaultReset,
          ctx.now()
        );
        if (chatBucket) buckets.push(chatBucket);
        const advancedBucket = parseQuotaEntry(
          "codebuddy-advanced",
          "高级模型额度",
          data.advanced_quota ?? data.fast_quota,
          defaultReset,
          ctx.now()
        );
        if (advancedBucket) buckets.push(advancedBucket);
      }

      const primary = buckets[0];
      const exhausted =
        primary !== undefined &&
        primary.remainingPercent !== undefined &&
        primary.remainingPercent <= 0;
      const cooldownUntil = primary?.resetsAt ?? defaultReset;

      return {
        ...(planTier ? { planTier } : {}),
        quotaBuckets: buckets,
        status: exhausted ? "quota_exhausted" : "active",
        ...(exhausted && cooldownUntil ? { cooldownUntil } : {})
      };
    },

    async listModels(
      _account,
      secret,
      signal
    ): Promise<SubscriptionModelDefinition[]> {
      const endpoint = (secret?.extra?.endpoint ?? apiBaseUrl).replace(
        /\/+$/u,
        ""
      );
      const token = secret?.accessToken?.trim();
      if (!token || token === "pending-refresh") {
        return CODEBUDDY_BASELINE_MODELS.map((item) => ({
          ...item,
          baseUrl: endpoint
        }));
      }
      try {
        const headers = {
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
          "User-Agent": CODEBUDDY_BROWSER_USER_AGENT
        };
        let response = await ctx.fetcher(`${endpoint}/v2/models`, {
          method: "GET",
          headers,
          ...(signal ? { signal } : {})
        });
        if (response.status === 404) {
          response = await ctx.fetcher(`${endpoint}/v1/models`, {
            method: "GET",
            headers,
            ...(signal ? { signal } : {})
          });
        }
        if (!response.ok) {
          return CODEBUDDY_BASELINE_MODELS.map((item) => ({
            ...item,
            baseUrl: endpoint
          }));
        }
        const raw = (await response.json()) as unknown;
        const list =
          isRecord(raw) && Array.isArray(raw.data)
            ? raw.data
            : isRecord(raw) && Array.isArray(raw.models)
              ? raw.models
              : [];
        if (list.length === 0) {
          return CODEBUDDY_BASELINE_MODELS.map((item) => ({
            ...item,
            baseUrl: endpoint
          }));
        }
        const byBaseline = new Map(
          CODEBUDDY_BASELINE_MODELS.map((item) => [item.modelId, item])
        );
        const models: SubscriptionModelDefinition[] = [];
        for (const item of list) {
          if (!isRecord(item)) continue;
          const modelId =
            nonEmptyString(item.id) ??
            nonEmptyString(item.model) ??
            nonEmptyString(item.modelId);
          if (!modelId) continue;
          const id = `sub:codebuddy:${modelId.toLowerCase()}`;
          if (id.length > 120) continue;
          const baseline = byBaseline.get(modelId);
          const ctxWindow =
            typeof item.context_window === "number" &&
            item.context_window >= 1_024
              ? item.context_window
              : typeof item.contextWindow === "number" &&
                  item.contextWindow >= 1_024
                ? item.contextWindow
                : typeof item.context_length === "number" &&
                    item.context_length >= 1_024
                  ? item.context_length
                  : undefined;
          const maxOut =
            typeof item.max_output_tokens === "number" &&
            item.max_output_tokens >= 1
              ? item.max_output_tokens
              : typeof item.max_tokens === "number" && item.max_tokens >= 1
                ? item.max_tokens
                : typeof item.maxTokens === "number" && item.maxTokens >= 1
                  ? item.maxTokens
                  : undefined;
          const reasoning =
            typeof item.reasoning === "boolean"
              ? item.reasoning
              : typeof item.supports_reasoning === "boolean"
                ? item.supports_reasoning
                : /r1|t1|thinking|claude|fable|o1|o3|gpt-5|gpt-6|gemini|deepseek-v4|glm-5|kimi-k3|grok/iu.test(
                    modelId
                  );
          models.push({
            ...(baseline ?? {
              id,
              provider: "codebuddy",
              modelId,
              label:
                nonEmptyString(item.name) ??
                nonEmptyString(item.label) ??
                `${modelId} (CodeBuddy)`,
              api: "codebuddy-chat",
              baseUrl: endpoint,
              reasoning,
              defaultThinkingLevel: reasoning ? "medium" : "off",
              ...(reasoning
                ? { thinkingLevelOptions: ["low", "medium", "high"] as const }
                : {}),
              contextWindow: ctxWindow ?? 128_000,
              maxTokens: maxOut ?? 32_768,
              recommended: models.length === 0
            }),
            ...(ctxWindow ? { contextWindow: ctxWindow } : {}),
            ...(maxOut ? { maxTokens: maxOut } : {}),
            baseUrl: endpoint
          });
        }
        if (models.length === 0) {
          return CODEBUDDY_BASELINE_MODELS.map((item) => ({
            ...item,
            baseUrl: endpoint
          }));
        }
        if (!models.some((m) => m.recommended)) {
          models[0] = { ...models[0]!, recommended: true };
        }
        return models;
      } catch {
        return CODEBUDDY_BASELINE_MODELS.map((item) => ({
          ...item,
          baseUrl: endpoint
        }));
      }
    },

    toRuntimeCredential(account, secret) {
      const endpoint = (secret.extra?.endpoint ?? apiBaseUrl).replace(
        /\/+$/u,
        ""
      );
      return {
        provider: "codebuddy",
        accountId: account.id,
        apiKey: secret.accessToken,
        baseUrl: endpoint,
        ...(secret.expiresAt ? { expiresAt: secret.expiresAt } : {}),
        metadata: { endpoint }
      };
    }
  };
}
