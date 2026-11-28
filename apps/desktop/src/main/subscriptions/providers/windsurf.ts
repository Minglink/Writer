import type { SubscriptionQuotaBucket } from "@writer/contracts";
import { DEFAULT_SUBSCRIPTION_PROVIDER_METADATA } from "../registry";
import {
  SubscriptionError,
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
  throwHttpSubscriptionError,
  toIsoExpiry,
  type ProviderEnvironmentOptions
} from "./shared";

const WINDSURF_API_BASE_URL = "https://server.codeium.com";
const WINDSURF_REGISTER_BASE_URL = "https://register.windsurf.com";
const WINDSURF_DEVIN_AUTH_BASE_URL = "https://auth.windsurf.com";
const WINDSURF_IDE_VERSION = "1.9.0";
const WINDSURF_SQLITE_KEYS = [
  "windsurfAuthStatus",
  "codeium.windsurf",
  "codeium.apiKey"
] as const;

export interface WindsurfAdapterOptions extends ProviderEnvironmentOptions {
  apiBaseUrl?: string;
  authBaseUrl?: string;
  devinAuthBaseUrl?: string;
}

export const WINDSURF_BASELINE_MODELS: readonly SubscriptionModelDefinition[] =
  [
    {
      id: "sub:windsurf:swe-2.1",
      provider: "windsurf",
      modelId: "swe-2.1",
      label: "SWE-2.1 (Windsurf)",
      description: "Windsurf 订阅主力高速推理与创作模型",
      api: "windsurf-connect",
      baseUrl: WINDSURF_API_BASE_URL,
      reasoning: true,
      defaultThinkingLevel: "medium",
      thinkingLevelOptions: ["low", "medium", "high", "xhigh", "max"],
      recommended: true
    },
    {
      id: "sub:windsurf:claude-sonnet-5.5",
      provider: "windsurf",
      modelId: "claude-sonnet-5.5",
      label: "Claude Sonnet 5.5 (Windsurf)",
      api: "windsurf-connect",
      baseUrl: WINDSURF_API_BASE_URL,
      reasoning: true,
      defaultThinkingLevel: "medium",
      thinkingLevelOptions: ["low", "medium", "high"],
      contextWindow: 1_000_000,
      maxTokens: 128_000,
      recommended: false
    },
    {
      id: "sub:windsurf:claude-opus-5.5",
      provider: "windsurf",
      modelId: "claude-opus-5.5",
      label: "Claude Opus 5.5 (Windsurf)",
      api: "windsurf-connect",
      baseUrl: WINDSURF_API_BASE_URL,
      reasoning: true,
      defaultThinkingLevel: "high",
      thinkingLevelOptions: ["low", "medium", "high"],
      contextWindow: 1_000_000,
      maxTokens: 128_000,
      recommended: false
    },
    {
      id: "sub:windsurf:claude-fable-5.2",
      provider: "windsurf",
      modelId: "claude-fable-5.2",
      label: "Claude Fable 5.2 (Windsurf)",
      api: "windsurf-connect",
      baseUrl: WINDSURF_API_BASE_URL,
      reasoning: true,
      defaultThinkingLevel: "medium",
      thinkingLevelOptions: ["low", "medium", "high"],
      recommended: false
    },
    {
      id: "sub:windsurf:gemini-4-neon",
      provider: "windsurf",
      modelId: "gemini-4-neon",
      label: "Gemini 4 Neon (Windsurf)",
      api: "windsurf-connect",
      baseUrl: WINDSURF_API_BASE_URL,
      reasoning: true,
      defaultThinkingLevel: "medium",
      thinkingLevelOptions: ["low", "medium", "high"],
      contextWindow: 1_048_576,
      maxTokens: 65_536,
      recommended: false
    }
  ];

interface DiscoveredWindsurfCandidate {
  candidateId: string;
  displayName: string;
  email?: string;
  planTier?: string;
  sourceLabel: string;
  sourcePathHint: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string;
  apiServerUrl?: string;
}

function formatWindsurfPlanTier(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const lower = raw.trim().toLowerCase();
  if (lower.includes("ultimate")) return "Pro Ultimate";
  if (lower.includes("enterprise")) return "Enterprise";
  if (lower.includes("team")) return "Teams";
  if (lower.includes("pro")) return "Pro";
  if (lower.includes("free") || lower.includes("trial")) return "Free";
  return raw.trim();
}

function parseWindsurfAuthBlob(raw: unknown): {
  accessToken?: string;
  refreshToken?: string;
  email?: string;
  displayName?: string;
  planTier?: string;
  expiresAt?: string;
  apiServerUrl?: string;
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
    nonEmptyString(obj.apiKey) ??
    nonEmptyString(obj.api_key) ??
    nonEmptyString(obj.accessToken) ??
    nonEmptyString(obj.access_token) ??
    nonEmptyString(obj.token);
  const refreshToken =
    nonEmptyString(obj.refreshToken) ?? nonEmptyString(obj.refresh_token);
  const claims = decodeJwtPayload(accessToken);
  const email = nonEmptyString(obj.email) ?? nonEmptyString(claims?.email);
  const displayName =
    nonEmptyString(obj.name) ?? nonEmptyString(obj.displayName) ?? email;
  const planTier = formatWindsurfPlanTier(
    nonEmptyString(obj.planName) ?? nonEmptyString(obj.plan)
  );
  const expiresAt = toIsoExpiry(obj.expiresAt ?? obj.expires_at ?? claims?.exp);
  const apiServerUrl =
    nonEmptyString(obj.apiServerUrl) ??
    nonEmptyString(obj.api_server_url) ??
    nonEmptyString(obj.endpoint);
  return {
    ...(accessToken ? { accessToken } : {}),
    ...(refreshToken ? { refreshToken } : {}),
    ...(email ? { email } : {}),
    ...(displayName ? { displayName } : {}),
    ...(planTier ? { planTier } : {}),
    ...(expiresAt ? { expiresAt } : {}),
    ...(apiServerUrl ? { apiServerUrl } : {})
  };
}

/**
 * Windsurf `availablePromptCredits` / `availableFlowCredits` represent remaining
 * credits (not total), so total limit is `available + used` (aligned with
 * cockpit-tools windsurf_oauth.rs). When only monthly total + used are present,
 * remaining is `max(0, monthlyTotal - used)`.
 */
function parseCreditBucket(
  id: string,
  label: string,
  remainingRaw: unknown,
  monthlyTotalRaw: unknown,
  usedRaw: unknown,
  resetsAt: string | undefined
): SubscriptionQuotaBucket | undefined {
  const remainingField =
    typeof remainingRaw === "number" && Number.isFinite(remainingRaw)
      ? Math.max(0, remainingRaw)
      : undefined;
  const monthlyTotal =
    typeof monthlyTotalRaw === "number" &&
    Number.isFinite(monthlyTotalRaw) &&
    monthlyTotalRaw > 0
      ? monthlyTotalRaw
      : undefined;
  const used =
    typeof usedRaw === "number" && Number.isFinite(usedRaw)
      ? Math.max(0, usedRaw)
      : undefined;
  if (
    remainingField === undefined &&
    monthlyTotal === undefined &&
    used === undefined
  ) {
    return undefined;
  }
  const inferredTotal =
    remainingField !== undefined && used !== undefined
      ? remainingField + used
      : undefined;
  const limit =
    inferredTotal !== undefined && inferredTotal > 0
      ? inferredTotal
      : monthlyTotal;
  const remaining =
    remainingField ??
    (limit !== undefined && used !== undefined
      ? Math.max(0, limit - used)
      : undefined);
  const remainingPercent =
    remaining !== undefined && limit !== undefined && limit > 0
      ? Math.min(100, (remaining / limit) * 100)
      : undefined;
  return {
    id,
    label,
    ...(remainingPercent !== undefined
      ? { remainingPercent }
      : remaining !== undefined
        ? { remaining }
        : {}),
    ...(used !== undefined ? { used } : {}),
    ...(limit !== undefined && limit > 0 ? { limit } : {}),
    unit: "credits",
    ...(resetsAt ? { resetsAt } : {})
  };
}

export function createWindsurfAdapter(
  options: WindsurfAdapterOptions = {}
): SubscriptionProviderAdapter {
  const ctx = resolveAdapterContext(options);
  const apiBaseUrl = (options.apiBaseUrl ?? WINDSURF_API_BASE_URL).replace(
    /\/+$/u,
    ""
  );
  const authBaseUrl = (
    options.authBaseUrl ?? WINDSURF_REGISTER_BASE_URL
  ).replace(/\/+$/u, "");
  const devinAuthBaseUrl = (
    options.devinAuthBaseUrl ?? WINDSURF_DEVIN_AUTH_BASE_URL
  ).replace(/\/+$/u, "");
  const meta = DEFAULT_SUBSCRIPTION_PROVIDER_METADATA.windsurf;

  const scanWindsurfLocalSources = async (): Promise<
    DiscoveredWindsurfCandidate[]
  > => {
    const sqlitePaths: string[] = [];
    if (ctx.env.WINDSURF_USER_DATA_DIR) {
      sqlitePaths.push(
        resolveHomeSubpath(
          ctx.env.WINDSURF_USER_DATA_DIR,
          "User",
          "globalStorage",
          "state.vscdb"
        ),
        resolveHomeSubpath(
          ctx.env.WINDSURF_USER_DATA_DIR,
          "globalStorage",
          "state.vscdb"
        )
      );
    }
    if (ctx.env.APPDATA) {
      sqlitePaths.push(
        resolveHomeSubpath(
          ctx.env.APPDATA,
          "Windsurf",
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
        "Windsurf",
        "User",
        "globalStorage",
        "state.vscdb"
      ),
      resolveHomeSubpath(
        ctx.homeDir,
        ".config",
        "Windsurf",
        "User",
        "globalStorage",
        "state.vscdb"
      )
    );

    const found: DiscoveredWindsurfCandidate[] = [];
    const seen = new Set<string>();

    for (let i = 0; i < sqlitePaths.length; i += 1) {
      const dbPath = sqlitePaths[i]!;
      const items = await readSqliteItemsReadOnly(dbPath, WINDSURF_SQLITE_KEYS);
      if (!items) continue;
      const rawValue =
        items.windsurfAuthStatus ??
        items["codeium.windsurf"] ??
        items["codeium.apiKey"];
      if (!rawValue) continue;
      const parsed = parseWindsurfAuthBlob(rawValue);
      if (!parsed.accessToken && !parsed.refreshToken) continue;

      const displayName = parsed.displayName ?? parsed.email ?? "Windsurf 账号";
      const dedupeKey = `${parsed.email ?? displayName}:${(parsed.accessToken ?? parsed.refreshToken ?? "").slice(-6)}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      found.push({
        candidateId: `windsurf:sqlite:${i}`,
        displayName,
        ...(parsed.email ? { email: parsed.email } : {}),
        ...(parsed.planTier ? { planTier: parsed.planTier } : {}),
        sourceLabel: "Windsurf 本地状态库（只读）",
        sourcePathHint: maskPathHint(dbPath, ctx.homeDir),
        accessToken: parsed.accessToken ?? "pending-refresh",
        ...(parsed.refreshToken ? { refreshToken: parsed.refreshToken } : {}),
        ...(parsed.expiresAt ? { expiresAt: parsed.expiresAt } : {}),
        ...(parsed.apiServerUrl ? { apiServerUrl: parsed.apiServerUrl } : {})
      });
    }

    const jsonPaths = [
      resolveHomeSubpath(ctx.homeDir, ".codeium", "windsurf", "auth.json"),
      resolveHomeSubpath(ctx.homeDir, ".codeium", "config.json"),
      resolveHomeSubpath(ctx.homeDir, ".windsurf", "auth.json")
    ];
    for (let i = 0; i < jsonPaths.length; i += 1) {
      const filePath = jsonPaths[i]!;
      const raw = await readJsonFileReadOnly(filePath);
      if (!raw) continue;
      const parsed = parseWindsurfAuthBlob(raw);
      if (!parsed.accessToken && !parsed.refreshToken) continue;
      const displayName = parsed.displayName ?? parsed.email ?? "Windsurf 账号";
      const dedupeKey = `${parsed.email ?? displayName}:${(parsed.accessToken ?? parsed.refreshToken ?? "").slice(-6)}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      found.push({
        candidateId: `windsurf:json:${i}`,
        displayName,
        ...(parsed.email ? { email: parsed.email } : {}),
        ...(parsed.planTier ? { planTier: parsed.planTier } : {}),
        sourceLabel: "Windsurf 本地配置",
        sourcePathHint: maskPathHint(filePath, ctx.homeDir),
        accessToken: parsed.accessToken ?? "pending-refresh",
        ...(parsed.refreshToken ? { refreshToken: parsed.refreshToken } : {}),
        ...(parsed.expiresAt ? { expiresAt: parsed.expiresAt } : {}),
        ...(parsed.apiServerUrl ? { apiServerUrl: parsed.apiServerUrl } : {})
      });
    }

    return found;
  };

  return {
    id: "windsurf",
    meta,

    async scanLocalCandidates(): Promise<LocalCredentialCandidate[]> {
      const candidates = await scanWindsurfLocalSources();
      return candidates.map((item) => ({
        candidateId: item.candidateId,
        provider: "windsurf",
        displayName: item.displayName,
        ...(item.email ? { email: item.email } : {}),
        sourceLabel: item.sourceLabel,
        sourcePathHint: item.sourcePathHint
      }));
    },

    async importLocalCandidate(
      candidateId: string
    ): Promise<ImportedAccountResult> {
      const candidates = await scanWindsurfLocalSources();
      const target = candidates.find(
        (item) => item.candidateId === candidateId
      );
      if (!target) {
        throw new SubscriptionError(
          "subscriptions.candidate_not_found",
          "未在本机找到指定的 Windsurf 凭证。"
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
          ...(target.apiServerUrl
            ? { extra: { endpoint: target.apiServerUrl } }
            : {})
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
          "请输入有效的 Windsurf API Key 或凭证 JSON。"
        );
      }
      if (input.browserToken) {
        const response = await ctx.fetcher(
          "https://api.codeium.com/register_user/",
          {
            method: "POST",
            redirect: "error",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json"
            },
            body: JSON.stringify({ firebase_id_token: raw })
          }
        );
        if (!response.ok && ![400, 401, 403].includes(response.status)) {
          throwHttpSubscriptionError(response.status, "Windsurf");
        }
        const data: unknown = response.ok ? await response.json() : undefined;
        const apiKey = isRecord(data)
          ? nonEmptyString(data.api_key)
          : undefined;
        if (!apiKey)
          throw new SubscriptionError(
            "subscriptions.invalid_manual_token",
            "Windsurf 授权码无效或已过期，请重新登录。"
          );
        const email =
          nonEmptyString(decodeJwtPayload(raw)?.email) ??
          nonEmptyString(input.email);
        return {
          displayName: email ?? "Windsurf",
          ...(email ? { email } : {}),
          source: "manual_token",
          secret: { accessToken: apiKey }
        };
      }
      const parsed = parseWindsurfAuthBlob(raw);
      if (!parsed.accessToken) {
        throw new SubscriptionError(
          "subscriptions.invalid_manual_token",
          "未能从输入中提取有效的 Windsurf 访问令牌。"
        );
      }
      const refreshToken =
        nonEmptyString(input.refreshToken) ?? parsed.refreshToken;
      const email = nonEmptyString(input.email) ?? parsed.email;
      const displayName =
        nonEmptyString(input.displayName) ??
        parsed.displayName ??
        email ??
        "Windsurf 手动导入账号";
      return {
        displayName,
        ...(email ? { email } : {}),
        ...(parsed.planTier ? { planTier: parsed.planTier } : {}),
        source: "manual_token",
        secret: {
          accessToken: parsed.accessToken,
          ...(refreshToken ? { refreshToken } : {}),
          ...(parsed.expiresAt ? { expiresAt: parsed.expiresAt } : {}),
          ...(parsed.apiServerUrl
            ? { extra: { endpoint: parsed.apiServerUrl } }
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
          "当前 Windsurf 账号缺少刷新令牌且凭证已过期，请重新扫描本机或手动导入。"
        );
      }

      // 2026-04+ Devin Auth chain (auth1_ token -> GetOneTimeAuthToken -> RegisterUser)
      // or Firebase ID token -> RegisterUser (aligned with cockpit-tools windsurf_oauth.rs).
      let registerPayload: Record<string, unknown>;
      if (secret.refreshToken.startsWith("auth1_")) {
        const oneTimeResp = await ctx.fetcher(
          `${devinAuthBaseUrl}/api/windsurf/one-time-auth-token`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
              Authorization: `Bearer ${secret.refreshToken}`
            },
            body: JSON.stringify({}),
            ...(signal ? { signal } : {})
          }
        );
        if (!oneTimeResp.ok) {
          throwHttpSubscriptionError(oneTimeResp.status, "Windsurf");
        }
        const oneTimeData = (await oneTimeResp.json()) as unknown;
        const oneTimeToken = isRecord(oneTimeData)
          ? (nonEmptyString(oneTimeData.oneTimeAuthToken) ??
            nonEmptyString(oneTimeData.token))
          : undefined;
        if (!oneTimeToken) {
          throw new SubscriptionError(
            "subscriptions.secret_refresh_failed",
            "Windsurf Devin 认证未返回一次性授权令牌。"
          );
        }
        registerPayload = { firebase_id_token: oneTimeToken };
      } else {
        registerPayload = { firebase_id_token: secret.refreshToken };
      }

      const response = await ctx.fetcher(
        `${authBaseUrl}/exa.seat_management_pb.SeatManagementService/RegisterUser`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json"
          },
          body: JSON.stringify(registerPayload),
          ...(signal ? { signal } : {})
        }
      );
      if (!response.ok) {
        throwHttpSubscriptionError(response.status, "Windsurf");
      }
      const data = (await response.json()) as unknown;
      if (!isRecord(data)) {
        throw new SubscriptionError(
          "subscriptions.secret_refresh_failed",
          "Windsurf 刷新令牌响应格式无效。"
        );
      }
      const accessToken =
        nonEmptyString(data.apiKey) ??
        nonEmptyString(data.api_key) ??
        nonEmptyString(data.accessToken) ??
        nonEmptyString(data.access_token);
      if (!accessToken) {
        throw new SubscriptionError(
          "subscriptions.secret_refresh_failed",
          "Windsurf 刷新令牌响应缺少访问令牌。"
        );
      }
      const refreshToken =
        nonEmptyString(data.refreshToken) ??
        nonEmptyString(data.refresh_token) ??
        secret.refreshToken;
      const discoveredEndpoint =
        nonEmptyString(data.apiServerUrl) ??
        nonEmptyString(data.api_server_url) ??
        secret.extra?.endpoint;
      const expiresAt =
        toIsoExpiry(
          data.expiresIn ?? data.expires_in ?? data.expiresAt,
          ctx.now()
        ) ?? secret.expiresAt;
      return {
        ...secret,
        accessToken,
        refreshToken,
        ...(expiresAt ? { expiresAt } : {}),
        ...(discoveredEndpoint
          ? { extra: { ...(secret.extra ?? {}), endpoint: discoveredEndpoint } }
          : {})
      };
    },

    async fetchQuota(
      account: StoredAccountRecord,
      secret: StoredAccountSecret,
      signal?: AbortSignal
    ): Promise<QuotaFetchResult> {
      const targetEndpoint = (secret.extra?.endpoint ?? apiBaseUrl).replace(
        /\/+$/u,
        ""
      );
      // Align with cockpit-tools windsurf_oauth.rs: GetUserStatus + full IDE metadata.
      const response = await ctx.fetcher(
        `${targetEndpoint}/exa.seat_management_pb.SeatManagementService/GetUserStatus`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            Authorization: `Bearer ${secret.accessToken}`
          },
          body: JSON.stringify({
            metadata: {
              ideName: "windsurf",
              ideVersion: WINDSURF_IDE_VERSION,
              extensionName: "windsurf",
              extensionVersion: WINDSURF_IDE_VERSION,
              apiKey: secret.accessToken
            }
          }),
          ...(signal ? { signal } : {})
        }
      );
      if (!response.ok) {
        throwHttpSubscriptionError(response.status, "Windsurf");
      }
      const data = (await response.json()) as unknown;
      if (!isRecord(data)) {
        return { quotaBuckets: [] };
      }
      const userStatus = isRecord(data.userStatus) ? data.userStatus : data;
      const planStatus = isRecord(userStatus.planStatus)
        ? userStatus.planStatus
        : isRecord(data.planStatus)
          ? data.planStatus
          : userStatus;
      const planInfo = isRecord(planStatus.planInfo)
        ? planStatus.planInfo
        : undefined;
      const planTier =
        formatWindsurfPlanTier(
          nonEmptyString(planInfo?.planName) ??
            nonEmptyString(planStatus.planName)
        ) ?? account.planTier;
      const resetsAt = toIsoExpiry(
        planStatus.planEnd ?? planStatus.resetDate,
        ctx.now()
      );

      const buckets: SubscriptionQuotaBucket[] = [];
      const promptBucket = parseCreditBucket(
        "windsurf-prompt-credits",
        "Prompt Credits",
        planStatus.availablePromptCredits,
        planInfo?.monthlyPromptCredits,
        planStatus.usedPromptCredits,
        resetsAt
      );
      if (promptBucket) buckets.push(promptBucket);

      const flowBucket = parseCreditBucket(
        "windsurf-flow-credits",
        "Flow Credits",
        planStatus.availableFlowCredits,
        planInfo?.monthlyFlowCredits,
        planStatus.usedFlowCredits,
        resetsAt
      );
      if (flowBucket) buckets.push(flowBucket);

      const exhausted =
        buckets.length > 0 &&
        buckets.every((b) => (b.remainingPercent ?? b.remaining) === 0);

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
      const targetEndpoint = (secret?.extra?.endpoint ?? apiBaseUrl).replace(
        /\/+$/u,
        ""
      );
      const token = secret?.accessToken?.trim();
      if (!token || token === "pending-refresh") {
        return WINDSURF_BASELINE_MODELS.map((item) => ({
          ...item,
          baseUrl: targetEndpoint
        }));
      }
      try {
        const response = await ctx.fetcher(
          `${targetEndpoint}/exa.seat_management_pb.SeatManagementService/GetUserStatus`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
              Authorization: `Bearer ${token}`
            },
            body: JSON.stringify({
              metadata: {
                ideName: "windsurf",
                ideVersion: WINDSURF_IDE_VERSION,
                extensionName: "windsurf",
                extensionVersion: WINDSURF_IDE_VERSION,
                apiKey: token
              }
            }),
            ...(signal ? { signal } : {})
          }
        );
        if (!response.ok) {
          return WINDSURF_BASELINE_MODELS.map((item) => ({
            ...item,
            baseUrl: targetEndpoint
          }));
        }
        const raw = (await response.json()) as unknown;
        const userStatus =
          isRecord(raw) && isRecord(raw.userStatus) ? raw.userStatus : raw;
        const cascadeData =
          isRecord(userStatus) && isRecord(userStatus.cascadeModelConfigData)
            ? userStatus.cascadeModelConfigData
            : undefined;
        const list = Array.isArray(cascadeData?.clientModelConfigs)
          ? cascadeData.clientModelConfigs
          : [];
        if (list.length === 0) {
          return WINDSURF_BASELINE_MODELS.map((item) => ({
            ...item,
            baseUrl: targetEndpoint
          }));
        }
        const byBaseline = new Map(
          WINDSURF_BASELINE_MODELS.map((item) => [item.modelId, item])
        );
        const models: SubscriptionModelDefinition[] = [];
        for (const item of list) {
          if (!isRecord(item) || item.disabled === true) continue;
          const modelOrAlias = isRecord(item.modelOrAlias)
            ? item.modelOrAlias
            : undefined;
          const modelId =
            nonEmptyString(modelOrAlias?.model) ??
            nonEmptyString(modelOrAlias?.alias) ??
            nonEmptyString(item.modelUid) ??
            nonEmptyString(item.id);
          if (!modelId) continue;
          const id = `sub:windsurf:${modelId.toLowerCase()}`;
          if (id.length > 120) continue;
          const baseline = byBaseline.get(modelId);
          const reasoning =
            typeof item.supportsReasoning === "boolean"
              ? item.supportsReasoning
              : true;
          models.push({
            ...(baseline ?? {
              id,
              provider: "windsurf",
              modelId,
              label: nonEmptyString(item.label) ?? `${modelId} (Windsurf)`,
              api: "windsurf-connect",
              baseUrl: targetEndpoint,
              reasoning,
              defaultThinkingLevel: reasoning ? "medium" : "off",
              ...(reasoning
                ? { thinkingLevelOptions: ["low", "medium", "high"] as const }
                : {}),
              contextWindow: 200_000,
              maxTokens: 64_000,
              recommended: models.length === 0
            }),
            baseUrl: targetEndpoint
          });
        }
        if (models.length === 0) {
          return WINDSURF_BASELINE_MODELS.map((item) => ({
            ...item,
            baseUrl: targetEndpoint
          }));
        }
        if (!models.some((m) => m.recommended)) {
          models[0] = { ...models[0]!, recommended: true };
        }
        return models;
      } catch {
        return WINDSURF_BASELINE_MODELS.map((item) => ({
          ...item,
          baseUrl: targetEndpoint
        }));
      }
    },

    toRuntimeCredential(account, secret) {
      const targetEndpoint = (secret.extra?.endpoint ?? apiBaseUrl).replace(
        /\/+$/u,
        ""
      );
      return {
        provider: "windsurf",
        accountId: account.id,
        apiKey: secret.accessToken,
        baseUrl: targetEndpoint,
        ...(secret.expiresAt ? { expiresAt: secret.expiresAt } : {}),
        metadata: {
          endpoint: targetEndpoint
        }
      };
    }
  };
}
