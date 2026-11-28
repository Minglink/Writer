import type {
  SubscriptionFailoverReason,
  SubscriptionProviderId
} from "@writer/contracts";
import type { StoredAccountRecord } from "./types";

/** 30s -> 2m -> 5m -> 15m exponential backoff when upstream omits Retry-After. */
export const RATE_LIMIT_BACKOFF_SECONDS = [30, 120, 300, 900] as const;
export const MIN_COOLDOWN_SECONDS = 1;
export const MAX_COOLDOWN_SECONDS = 24 * 60 * 60;
export const DEFAULT_QUOTA_EXHAUSTED_COOLDOWN_SECONDS = 30 * 60;

export interface AccountFailureReport {
  reason: SubscriptionFailoverReason;
  retryAfterSec?: number;
  resetAt?: string;
  message?: string;
}

export interface RecoveryResult {
  accounts: StoredAccountRecord[];
  recoveredIds: string[];
}

export type AccountSelectionResult =
  | {
      ok: true;
      account: StoredAccountRecord;
      accounts: StoredAccountRecord[];
      recoveredIds: string[];
    }
  | {
      ok: false;
      code: "subscriptions.pool_exhausted";
      message: string;
      nextAvailableAt?: string;
      accounts: StoredAccountRecord[];
      recoveredIds: string[];
    };

function clampCooldownSeconds(seconds: number): number {
  if (!Number.isFinite(seconds)) return RATE_LIMIT_BACKOFF_SECONDS[0];
  return Math.min(
    MAX_COOLDOWN_SECONDS,
    Math.max(MIN_COOLDOWN_SECONDS, Math.ceil(seconds))
  );
}

function resolveCooldownUntil(
  nowMs: number,
  fallbackSeconds: number,
  retryAfterSec?: number,
  resetAt?: string
): string {
  if (resetAt) {
    const parsedReset = Date.parse(resetAt);
    if (Number.isFinite(parsedReset) && parsedReset > nowMs) {
      const clampedMs =
        clampCooldownSeconds((parsedReset - nowMs) / 1_000) * 1_000;
      return new Date(nowMs + clampedMs).toISOString();
    }
  }
  if (retryAfterSec !== undefined && Number.isFinite(retryAfterSec)) {
    const clampedMs = clampCooldownSeconds(retryAfterSec) * 1_000;
    return new Date(nowMs + clampedMs).toISOString();
  }
  return new Date(
    nowMs + clampCooldownSeconds(fallbackSeconds) * 1_000
  ).toISOString();
}

export function recoverExpiredAccounts(
  accounts: readonly StoredAccountRecord[],
  nowMs = Date.now()
): RecoveryResult {
  const recoveredIds: string[] = [];
  const nextAccounts = accounts.map((account) => {
    if (
      !account.enabled ||
      (account.status !== "cooldown" && account.status !== "quota_exhausted") ||
      !account.cooldownUntil
    ) {
      return account;
    }
    const untilMs = Date.parse(account.cooldownUntil);
    if (!Number.isFinite(untilMs) || untilMs > nowMs) {
      return account;
    }
    recoveredIds.push(account.id);
    const {
      cooldownUntil: _cooldownUntil,
      statusMessage: _statusMessage,
      ...rest
    } = account;
    return {
      ...rest,
      status: "active" as const
    };
  });
  return { accounts: nextAccounts, recoveredIds };
}

function formatWaitHint(nextAvailableMs: number, nowMs: number): string {
  const remainingSec = Math.max(
    1,
    Math.ceil((nextAvailableMs - nowMs) / 1_000)
  );
  if (remainingSec < 60) {
    return `预计约 ${remainingSec} 秒后可恢复`;
  }
  const minutes = Math.ceil(remainingSec / 60);
  if (minutes < 60) {
    return `预计约 ${minutes} 分钟后可恢复`;
  }
  const hours = Math.ceil(minutes / 60);
  return `预计约 ${hours} 小时后可恢复`;
}

export function selectAccountForProvider(
  accounts: readonly StoredAccountRecord[],
  provider: SubscriptionProviderId,
  options: {
    nowMs?: number;
    excludeAccountIds?: ReadonlySet<string>;
    preferredAccountId?: string;
  } = {}
): AccountSelectionResult {
  const nowMs = options.nowMs ?? Date.now();
  const exclude = options.excludeAccountIds ?? new Set<string>();
  const { accounts: recovered, recoveredIds } = recoverExpiredAccounts(
    accounts,
    nowMs
  );
  const providerAccounts = recovered.filter(
    (account) => account.provider === provider
  );
  const eligible = providerAccounts.filter(
    (account) =>
      account.enabled && account.status === "active" && !exclude.has(account.id)
  );

  if (options.preferredAccountId) {
    const preferred = eligible.find(
      (account) => account.id === options.preferredAccountId
    );
    if (preferred) {
      return {
        ok: true,
        account: preferred,
        accounts: recovered,
        recoveredIds
      };
    }
  }

  const primary = eligible.find((account) => account.isPrimary);
  const chosen = primary ?? eligible[0];
  if (chosen) {
    return {
      ok: true,
      account: chosen,
      accounts: recovered,
      recoveredIds
    };
  }

  const enabledAccounts = providerAccounts.filter((account) => account.enabled);
  if (enabledAccounts.length === 0) {
    return {
      ok: false,
      code: "subscriptions.pool_exhausted",
      message:
        "该平台暂无已启用的订阅账号，请先在订阅模型管理中登录或启用账号。",
      accounts: recovered,
      recoveredIds
    };
  }

  const cooldownTimes = enabledAccounts
    .map((account) =>
      account.cooldownUntil ? Date.parse(account.cooldownUntil) : Number.NaN
    )
    .filter((value) => Number.isFinite(value) && value > nowMs)
    .sort((left, right) => left - right);

  const earliest = cooldownTimes[0];
  if (earliest !== undefined) {
    return {
      ok: false,
      code: "subscriptions.pool_exhausted",
      nextAvailableAt: new Date(earliest).toISOString(),
      message: `该平台全部已启用账号当前均处于限流或配额耗尽状态（${formatWaitHint(earliest, nowMs)}），请稍后重试或添加备用账号。`,
      accounts: recovered,
      recoveredIds
    };
  }

  const hasExpired = enabledAccounts.some(
    (account) => account.status === "expired"
  );
  return {
    ok: false,
    code: "subscriptions.pool_exhausted",
    message: hasExpired
      ? "该平台已启用账号授权均已失效，请在订阅模型管理中重新登录或导入凭证。"
      : "该平台当前没有可用的订阅账号，请稍后重试。",
    accounts: recovered,
    recoveredIds
  };
}

export function applyAccountFailure(
  account: StoredAccountRecord,
  failure: AccountFailureReport,
  nowMs = Date.now()
): StoredAccountRecord {
  if (failure.reason === "unauthorized" || failure.reason === "forbidden") {
    const { cooldownUntil: _cooldownUntil, ...rest } = account;
    return {
      ...rest,
      status: "expired",
      statusMessage: failure.message?.trim() || "登录凭证已失效，请重新授权。"
    };
  }

  if (failure.reason === "quota_exhausted") {
    const cooldownUntil = resolveCooldownUntil(
      nowMs,
      DEFAULT_QUOTA_EXHAUSTED_COOLDOWN_SECONDS,
      failure.retryAfterSec,
      failure.resetAt
    );
    return {
      ...account,
      status: "quota_exhausted",
      cooldownUntil,
      statusMessage: failure.message?.trim() || "当前账号配额已耗尽，等待重置。"
    };
  }

  const backoffIndex = Math.min(
    account.consecutiveRateLimits,
    RATE_LIMIT_BACKOFF_SECONDS.length - 1
  );
  const fallbackSeconds = RATE_LIMIT_BACKOFF_SECONDS[backoffIndex]!;
  const cooldownUntil = resolveCooldownUntil(
    nowMs,
    fallbackSeconds,
    failure.retryAfterSec,
    failure.resetAt
  );
  return {
    ...account,
    status: "cooldown",
    cooldownUntil,
    consecutiveRateLimits: account.consecutiveRateLimits + 1,
    statusMessage: failure.message?.trim() || "触发限流，冷却中。"
  };
}

export function markAccountUsed(
  account: StoredAccountRecord,
  nowMs = Date.now()
): StoredAccountRecord {
  return {
    ...account,
    lastUsedAt: new Date(nowMs).toISOString()
  };
}

export function markAccountSuccess(
  account: StoredAccountRecord,
  nowMs = Date.now()
): StoredAccountRecord {
  const {
    cooldownUntil: _cooldownUntil,
    statusMessage: _statusMessage,
    ...rest
  } = account;
  return {
    ...rest,
    status: account.enabled ? "active" : "disabled",
    consecutiveRateLimits: 0,
    lastUsedAt: new Date(nowMs).toISOString()
  };
}

export function normalizeProviderPrimary(
  accounts: readonly StoredAccountRecord[],
  provider: SubscriptionProviderId,
  desiredPrimaryId?: string
): StoredAccountRecord[] {
  const providerAccounts = accounts.filter(
    (account) => account.provider === provider
  );
  if (providerAccounts.length === 0) return [...accounts];

  let chosenPrimaryId: string | undefined;
  if (
    desiredPrimaryId &&
    providerAccounts.some((account) => account.id === desiredPrimaryId)
  ) {
    chosenPrimaryId = desiredPrimaryId;
  } else {
    const currentEnabledPrimary = providerAccounts.find(
      (account) => account.isPrimary && account.enabled
    );
    if (currentEnabledPrimary) {
      chosenPrimaryId = currentEnabledPrimary.id;
    } else {
      chosenPrimaryId =
        providerAccounts.find((account) => account.enabled)?.id ??
        providerAccounts.find((account) => account.isPrimary)?.id ??
        providerAccounts[0]?.id;
    }
  }

  return accounts.map((account) => {
    if (account.provider !== provider) return account;
    return {
      ...account,
      isPrimary: account.id === chosenPrimaryId
    };
  });
}
