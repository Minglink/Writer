import { constants } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import type {
  OAuthLoopbackHandle,
  OAuthLoopbackOptions
} from "../oauth-loopback";
import { startOAuthLoopbackServer } from "../oauth-loopback";
import { SubscriptionError } from "../types";

export type SubscriptionFetcher = (
  input: string,
  init?: RequestInit
) => Promise<Response>;

export type LoopbackStarter = (
  options: OAuthLoopbackOptions
) => Promise<OAuthLoopbackHandle>;

export interface ProviderEnvironmentOptions {
  fetcher?: SubscriptionFetcher;
  homeDir?: string;
  env?: NodeJS.ProcessEnv;
  now?: () => number;
  startLoopback?: LoopbackStarter;
}

export function resolveAdapterContext(
  options: ProviderEnvironmentOptions = {}
) {
  return {
    fetcher: options.fetcher ?? globalThis.fetch,
    homeDir:
      options.homeDir ??
      options.env?.HOME ??
      options.env?.USERPROFILE ??
      homedir(),
    env: options.env ?? process.env,
    now: options.now ?? Date.now,
    startLoopback: options.startLoopback ?? startOAuthLoopbackServer
  };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

export function decodeJwtPayload(
  token: string | undefined
): Record<string, unknown> | undefined {
  if (!token) return undefined;
  const parts = token.split(".");
  if (parts.length !== 3 || !parts[1]) return undefined;
  try {
    const normalized = parts[1].replace(/-/gu, "+").replace(/_/gu, "/");
    const padded = normalized.padEnd(
      normalized.length + ((4 - (normalized.length % 4)) % 4),
      "="
    );
    const decoded = Buffer.from(padded, "base64").toString("utf8");
    const parsed = JSON.parse(decoded) as unknown;
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function toIsoExpiry(
  raw: unknown,
  nowMs = Date.now()
): string | undefined {
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
    // Values smaller than 1e11 represent epoch seconds or relative expires_in seconds.
    const ms =
      raw < 10_000_000 ? nowMs + raw * 1_000 : raw < 1e12 ? raw * 1_000 : raw;
    return new Date(ms).toISOString();
  }
  if (typeof raw === "string" && raw.trim()) {
    const parsed = Date.parse(raw.trim());
    if (Number.isFinite(parsed)) {
      return new Date(parsed).toISOString();
    }
  }
  return undefined;
}

export async function readJsonFileReadOnly(
  filePath: string
): Promise<unknown | undefined> {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw) as unknown;
  } catch (error: unknown) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR" || code === "EACCES") {
      return undefined;
    }
    return undefined;
  }
}

/**
 * Opens an external IDE SQLite state database strictly read-only without
 * mutating the file or blocking a live IDE process. Falls back to immutable
 * URI mode if WAL/shm locks are held by the external IDE.
 */
export async function readSqliteItemsReadOnly(
  filePath: string,
  keys: readonly string[]
): Promise<Record<string, string> | undefined> {
  const rawItems = await readSqliteRawItemsReadOnly(filePath, keys);
  if (!rawItems) return undefined;
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(rawItems)) {
    result[key] =
      typeof value === "string" ? value : Buffer.from(value).toString("utf8");
  }
  return result;
}

/**
 * Opens an external IDE SQLite state database strictly read-only and returns
 * raw string or BLOB (Uint8Array) values without mutating the file or blocking
 * a live IDE process. Falls back to immutable URI mode on WAL/shm locks.
 */
export async function readSqliteRawItemsReadOnly(
  filePath: string,
  keys: readonly string[]
): Promise<Record<string, string | Uint8Array> | undefined> {
  if (keys.length === 0) return undefined;
  try {
    await access(filePath, constants.R_OK);
  } catch {
    return undefined;
  }

  const query = (location: string): Record<string, string | Uint8Array> => {
    const db = new DatabaseSync(location, { readOnly: true, timeout: 250 });
    try {
      const placeholders = keys.map(() => "?").join(", ");
      const rows = db
        .prepare(
          `SELECT key, value FROM ItemTable WHERE key IN (${placeholders})`
        )
        .all(...keys) as Array<{ key?: unknown; value?: unknown }>;
      const result: Record<string, string | Uint8Array> = {};
      for (const row of rows) {
        if (typeof row.key !== "string") continue;
        if (typeof row.value === "string") {
          result[row.key] = row.value;
        } else if (row.value instanceof Uint8Array) {
          result[row.key] = new Uint8Array(row.value);
        }
      }
      return result;
    } finally {
      db.close();
    }
  };

  try {
    return query(filePath);
  } catch {
    try {
      const immutableUri = `${pathToFileURL(filePath).href}?mode=ro&immutable=1`;
      return query(immutableUri);
    } catch {
      return undefined;
    }
  }
}

export function maskPathHint(filePath: string, homeDir: string): string {
  const normalizedHome = homeDir.replace(/\\/gu, "/").replace(/\/+$/u, "");
  const normalizedPath = filePath.replace(/\\/gu, "/");
  if (normalizedHome && normalizedPath.startsWith(`${normalizedHome}/`)) {
    return `~/${normalizedPath.slice(normalizedHome.length + 1)}`;
  }
  return normalizedPath;
}

export function resolveHomeSubpath(
  homeDir: string,
  ...segments: string[]
): string {
  return join(homeDir, ...segments);
}

export function throwHttpSubscriptionError(
  status: number,
  providerLabel: string
): never {
  if (status === 401 || status === 403) {
    throw new SubscriptionError(
      "subscriptions.secret_refresh_failed",
      `${providerLabel} 授权凭证已失效或被撤销，请重新登录。`
    );
  }
  if (status === 429) {
    throw new SubscriptionError(
      "subscriptions.rate_limited",
      `${providerLabel} 请求过于频繁，请稍后重试。`
    );
  }
  throw new SubscriptionError(
    "subscriptions.upstream_error",
    `${providerLabel} 上游接口请求失败（HTTP ${status}）。`
  );
}

export async function sleepWithAbort(
  ms: number,
  signal?: AbortSignal
): Promise<void> {
  if (signal?.aborted) {
    throw new SubscriptionError("subscriptions.auth_cancelled", "授权已取消。");
  }
  await new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(
        new SubscriptionError("subscriptions.auth_cancelled", "授权已取消。")
      );
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
