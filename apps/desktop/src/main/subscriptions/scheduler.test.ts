import { describe, expect, it } from "vitest";
import {
  DEFAULT_QUOTA_EXHAUSTED_COOLDOWN_SECONDS,
  MAX_COOLDOWN_SECONDS,
  RATE_LIMIT_BACKOFF_SECONDS,
  applyAccountFailure,
  markAccountSuccess,
  normalizeProviderPrimary,
  selectAccountForProvider
} from "./scheduler";
import type { StoredAccountRecord } from "./types";

const BASE_TIME = Date.parse("2026-11-27T12:00:00.000Z");

function account(
  id: string,
  overrides: Partial<StoredAccountRecord> = {}
): StoredAccountRecord {
  return {
    id,
    provider: "google-gemini-cli",
    displayName: `${id}@example.test`,
    email: `${id}@example.test`,
    source: "oauth",
    isPrimary: false,
    enabled: true,
    status: "active",
    consecutiveRateLimits: 0,
    quotaBuckets: [],
    createdAt: "2026-11-27T10:00:00.000Z",
    ...overrides
  };
}

describe("subscription account scheduler", () => {
  it("always prefers the active primary account to preserve prompt cache", () => {
    const accounts = [
      account("backup_1", { isPrimary: false }),
      account("primary_1", { isPrimary: true }),
      account("backup_2", { isPrimary: false })
    ];
    const selected = selectAccountForProvider(accounts, "google-gemini-cli", {
      nowMs: BASE_TIME
    });
    expect(selected.ok).toBe(true);
    if (selected.ok) {
      expect(selected.account.id).toBe("primary_1");
    }
  });

  it("cools down on 429 with exponential backoff, fails over to backup, and auto-recovers primary", () => {
    let primary = account("primary_1", { isPrimary: true });
    const backup = account("backup_1", { isPrimary: false });

    // 1st 429 without Retry-After -> 30s cooldown
    primary = applyAccountFailure(
      primary,
      { reason: "rate_limited" },
      BASE_TIME
    );
    expect(primary.status).toBe("cooldown");
    expect(primary.consecutiveRateLimits).toBe(1);
    expect(primary.cooldownUntil).toBe(
      new Date(BASE_TIME + RATE_LIMIT_BACKOFF_SECONDS[0] * 1_000).toISOString()
    );

    // During cooldown, backup is chosen.
    const duringCooldown = selectAccountForProvider(
      [primary, backup],
      "google-gemini-cli",
      { nowMs: BASE_TIME + 10_000 }
    );
    expect(duringCooldown.ok).toBe(true);
    if (duringCooldown.ok) {
      expect(duringCooldown.account.id).toBe("backup_1");
      expect(duringCooldown.recoveredIds).toEqual([]);
    }

    // After cooldown expires, primary auto-recovers and regains priority!
    const afterCooldown = selectAccountForProvider(
      [primary, backup],
      "google-gemini-cli",
      { nowMs: BASE_TIME + 30_000 }
    );
    expect(afterCooldown.ok).toBe(true);
    if (afterCooldown.ok) {
      expect(afterCooldown.account.id).toBe("primary_1");
      expect(afterCooldown.account.status).toBe("active");
      expect(afterCooldown.recoveredIds).toEqual(["primary_1"]);
    }

    // Subsequent consecutive 429s step through 120s -> 300s -> 900s -> capped 900s.
    const second = applyAccountFailure(
      primary,
      { reason: "rate_limited" },
      BASE_TIME
    );
    expect(second.cooldownUntil).toBe(
      new Date(BASE_TIME + RATE_LIMIT_BACKOFF_SECONDS[1] * 1_000).toISOString()
    );
    const third = applyAccountFailure(
      second,
      { reason: "rate_limited" },
      BASE_TIME
    );
    expect(third.cooldownUntil).toBe(
      new Date(BASE_TIME + RATE_LIMIT_BACKOFF_SECONDS[2] * 1_000).toISOString()
    );
    const fourth = applyAccountFailure(
      third,
      { reason: "rate_limited" },
      BASE_TIME
    );
    expect(fourth.cooldownUntil).toBe(
      new Date(BASE_TIME + RATE_LIMIT_BACKOFF_SECONDS[3] * 1_000).toISOString()
    );

    // Success resets consecutive rate limit counter.
    const recoveredSuccess = markAccountSuccess(fourth, BASE_TIME + 60_000);
    expect(recoveredSuccess.consecutiveRateLimits).toBe(0);
    expect(recoveredSuccess.status).toBe("active");
    expect(recoveredSuccess.lastUsedAt).toBe(
      new Date(BASE_TIME + 60_000).toISOString()
    );
  });

  it("honors Retry-After / resetAt with upper-bound clamping and handles quota_exhausted & 401 expired", () => {
    const base = account("acct_1", { isPrimary: true });

    const withRetryAfter = applyAccountFailure(
      base,
      { reason: "rate_limited", retryAfterSec: 75 },
      BASE_TIME
    );
    expect(withRetryAfter.cooldownUntil).toBe(
      new Date(BASE_TIME + 75_000).toISOString()
    );

    const clamped = applyAccountFailure(
      base,
      { reason: "rate_limited", retryAfterSec: 999_999 },
      BASE_TIME
    );
    expect(clamped.cooldownUntil).toBe(
      new Date(BASE_TIME + MAX_COOLDOWN_SECONDS * 1_000).toISOString()
    );

    const quotaDefault = applyAccountFailure(
      base,
      { reason: "quota_exhausted" },
      BASE_TIME
    );
    expect(quotaDefault.status).toBe("quota_exhausted");
    expect(quotaDefault.cooldownUntil).toBe(
      new Date(
        BASE_TIME + DEFAULT_QUOTA_EXHAUSTED_COOLDOWN_SECONDS * 1_000
      ).toISOString()
    );

    const expired = applyAccountFailure(
      base,
      { reason: "unauthorized" },
      BASE_TIME
    );
    expect(expired.status).toBe("expired");
    expect(expired.cooldownUntil).toBeUndefined();
  });

  it("returns subscriptions.pool_exhausted with earliest recovery timestamp when all accounts are unavailable", () => {
    const a1 = applyAccountFailure(
      account("acct_1", { isPrimary: true }),
      { reason: "rate_limited", retryAfterSec: 120 },
      BASE_TIME
    );
    const a2 = applyAccountFailure(
      account("acct_2"),
      { reason: "rate_limited", retryAfterSec: 45 },
      BASE_TIME
    );

    const result = selectAccountForProvider([a1, a2], "google-gemini-cli", {
      nowMs: BASE_TIME
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("subscriptions.pool_exhausted");
      expect(result.nextAvailableAt).toBe(
        new Date(BASE_TIME + 45_000).toISOString()
      );
    }
  });

  it("promotes the next enabled account to primary when the previous primary is disabled", () => {
    const accounts = [
      account("a1", { isPrimary: true, enabled: false, status: "disabled" }),
      account("a2", { isPrimary: false, enabled: true }),
      account("a3", { isPrimary: false, enabled: true })
    ];
    const normalized = normalizeProviderPrimary(accounts, "google-gemini-cli");
    expect(normalized.find((a) => a.id === "a1")?.isPrimary).toBe(false);
    expect(normalized.find((a) => a.id === "a2")?.isPrimary).toBe(true);
    expect(normalized.find((a) => a.id === "a3")?.isPrimary).toBe(false);
  });
});
