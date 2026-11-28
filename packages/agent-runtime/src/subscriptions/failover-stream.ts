import type { StreamFn } from "@earendil-works/pi-agent-core";
import {
  createAssistantMessageEventStream,
  type Api,
  type AssistantMessage,
  type AssistantMessageEvent,
  type Context,
  type Model,
  type SimpleStreamOptions
} from "@earendil-works/pi-ai";
import type {
  AgentProviderRuntimeConfig,
  SubscriptionFailoverReason,
  SubscriptionProviderId
} from "@writer/contracts";
import type { SubscriptionCredentialBridge } from "./types";

const PROACTIVE_REFRESH_BUFFER_MS = 60_000;
const DEFAULT_MAX_FAILOVERS = 3;

export interface ClassifiedSubscriptionFailure {
  reason: SubscriptionFailoverReason;
  retryAfterSec?: number;
  resetAt?: string;
  message: string;
}

type ProviderStreamFn = (
  model: Model<Api>,
  context: Context,
  options?: SimpleStreamOptions
) => ReturnType<StreamFn>;

function isAssistantOutputEvent(event: AssistantMessageEvent): boolean {
  return (
    event.type === "text_start" ||
    event.type === "text_delta" ||
    event.type === "text_end" ||
    event.type === "thinking_start" ||
    event.type === "thinking_delta" ||
    event.type === "thinking_end" ||
    event.type === "toolcall_start" ||
    event.type === "toolcall_delta" ||
    event.type === "toolcall_end" ||
    event.type === "done"
  );
}

function extractRetryAfterSec(text: string): number | undefined {
  const retryAfterMatch =
    /retry[- ]after[:=\s]+(\d+(?:\.\d+)?)\s*(ms|s|sec|seconds?)?/iu.exec(text);
  if (retryAfterMatch) {
    const value = Number(retryAfterMatch[1]);
    if (Number.isFinite(value) && value >= 0) {
      return retryAfterMatch[2]?.toLowerCase() === "ms"
        ? Math.ceil(value / 1_000)
        : Math.ceil(value);
    }
  }
  const minutesMatch = /try again in ~?(\d+)\s*min/iu.exec(text);
  if (minutesMatch) {
    const minutes = Number(minutesMatch[1]);
    if (Number.isFinite(minutes) && minutes > 0) {
      return minutes * 60;
    }
  }
  return undefined;
}

function extractResetAt(text: string): string | undefined {
  const isoMatch = /\b(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)\b/u.exec(
    text
  );
  if (isoMatch && Number.isFinite(Date.parse(isoMatch[1]!))) {
    return isoMatch[1];
  }
  return undefined;
}

function extractErrorDetails(source: unknown): {
  status?: number;
  message: string;
  retryAfterSec?: number;
} {
  if (typeof source === "string") {
    const retryAfterSec = extractRetryAfterSec(source);
    return {
      message: source,
      ...(retryAfterSec !== undefined ? { retryAfterSec } : {})
    };
  }
  if (source instanceof Error) {
    const withStatus = source as Error & {
      status?: number;
      statusCode?: number;
      headers?: Headers | Record<string, string>;
    };
    const status =
      typeof withStatus.status === "number"
        ? withStatus.status
        : typeof withStatus.statusCode === "number"
          ? withStatus.statusCode
          : undefined;
    let headerRetrySec: number | undefined;
    const headers = withStatus.headers;
    if (headers && typeof (headers as Headers).get === "function") {
      const raw = (headers as Headers).get("retry-after");
      if (raw && /^\d+$/u.test(raw.trim())) {
        headerRetrySec = Number(raw.trim());
      }
    } else if (headers && typeof headers === "object") {
      const raw =
        (headers as Record<string, string>)["retry-after"] ??
        (headers as Record<string, string>)["Retry-After"];
      if (raw && /^\d+$/u.test(raw.trim())) {
        headerRetrySec = Number(raw.trim());
      }
    }
    const retryAfterSec =
      headerRetrySec ?? extractRetryAfterSec(source.message);
    return {
      ...(status !== undefined ? { status } : {}),
      message: source.message,
      ...(retryAfterSec !== undefined ? { retryAfterSec } : {})
    };
  }
  if (source && typeof source === "object") {
    const record = source as Record<string, unknown>;
    const message =
      typeof record.errorMessage === "string"
        ? record.errorMessage
        : typeof record.message === "string"
          ? record.message
          : String(source);
    const status =
      typeof record.status === "number"
        ? record.status
        : typeof record.statusCode === "number"
          ? record.statusCode
          : undefined;
    const retryAfterSec = extractRetryAfterSec(message);
    return {
      ...(status !== undefined ? { status } : {}),
      message,
      ...(retryAfterSec !== undefined ? { retryAfterSec } : {})
    };
  }
  return { message: String(source) };
}

export function classifySubscriptionFailure(
  source: unknown
): ClassifiedSubscriptionFailure | undefined {
  const { status, message, retryAfterSec } = extractErrorDetails(source);
  const lower = message.toLowerCase();
  const resetAt = extractResetAt(message);
  const base = {
    message: message.slice(0, 300),
    ...(retryAfterSec !== undefined ? { retryAfterSec } : {}),
    ...(resetAt !== undefined ? { resetAt } : {})
  };

  if (
    status === 401 ||
    /\b401\b/u.test(message) ||
    lower.includes("unauthorized") ||
    lower.includes("unauthenticated") ||
    lower.includes("invalid_token") ||
    lower.includes("token expired")
  ) {
    return { ...base, reason: "unauthorized" };
  }

  if (
    status === 403 ||
    /\b403\b/u.test(message) ||
    lower.includes("forbidden") ||
    lower.includes("permission_denied")
  ) {
    return { ...base, reason: "forbidden" };
  }

  if (
    lower.includes("quota exceeded") ||
    lower.includes("insufficient_quota") ||
    lower.includes("servicequotaexceeded") ||
    lower.includes("daily limit") ||
    lower.includes("monthly limit") ||
    lower.includes("credit limit") ||
    lower.includes("out of prompt credits") ||
    lower.includes("out of flow credits") ||
    lower.includes("fast requests exhausted") ||
    lower.includes("premium requests exhausted") ||
    lower.includes("usage limit") ||
    lower.includes("gousagelimiterror") ||
    lower.includes("freeusagelimiterror") ||
    lower.includes("配额已耗尽")
  ) {
    return { ...base, reason: "quota_exhausted" };
  }

  if (
    status === 429 ||
    /\b429\b/u.test(message) ||
    lower.includes("too many requests") ||
    lower.includes("throttlingexception") ||
    lower.includes("rate limit") ||
    lower.includes("rate_limit") ||
    lower.includes("resource_exhausted")
  ) {
    return { ...base, reason: "rate_limited" };
  }

  return undefined;
}

function createFailoverErrorMessage(
  model: Model<Api>,
  error: unknown,
  aborted: boolean
): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text: "" }],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
    },
    stopReason: aborted ? "aborted" : "error",
    errorMessage: aborted
      ? "模型请求已中止。"
      : error instanceof Error
        ? error.message
        : String(error),
    timestamp: Date.now()
  };
}

interface ActiveCredentialState {
  provider: SubscriptionProviderId;
  accountId: string;
  apiKey: string;
  baseUrl?: string;
  expiresAt?: string;
  extraHeaders?: Record<string, string>;
  metadata?: Record<string, string>;
}

function isExpiringSoon(expiresAt: string | undefined, nowMs: number): boolean {
  if (!expiresAt) return false;
  const parsed = Date.parse(expiresAt);
  if (!Number.isFinite(parsed)) return false;
  return parsed - nowMs <= PROACTIVE_REFRESH_BUFFER_MS;
}

const SUBSCRIPTION_INTERNAL_HEADER_KEYS = new Set([
  "x-writer-subscription-project-id",
  "x-writer-subscription-profile-arn"
]);

function stripKeys<T>(
  source: Record<string, T> | undefined,
  keysToStrip: ReadonlySet<string>
): Record<string, T> {
  if (!source) return {};
  const result: Record<string, T> = {};
  for (const [key, value] of Object.entries(source)) {
    if (!keysToStrip.has(key)) {
      result[key] = value;
    }
  }
  return result;
}

export interface SubscriptionFailoverOptions {
  config: AgentProviderRuntimeConfig;
  bridge: SubscriptionCredentialBridge;
  streamFn: ProviderStreamFn;
  now?: () => number;
  maxFailovers?: number;
}

export function withSubscriptionFailover({
  config,
  bridge,
  streamFn,
  now = Date.now,
  maxFailovers = DEFAULT_MAX_FAILOVERS
}: SubscriptionFailoverOptions): ProviderStreamFn {
  const initialAuth = config.subscriptionAuth;
  if (!initialAuth) {
    return streamFn;
  }

  const fallbackBaseUrl = config.baseUrl || undefined;
  const managedHeaderKeys = new Set<string>(SUBSCRIPTION_INTERNAL_HEADER_KEYS);
  if (initialAuth.extraHeaders) {
    for (const key of Object.keys(initialAuth.extraHeaders)) {
      managedHeaderKeys.add(key);
    }
  }

  let credential: ActiveCredentialState = {
    provider: initialAuth.provider,
    accountId: initialAuth.accountId,
    apiKey: config.apiKey,
    ...(fallbackBaseUrl ? { baseUrl: fallbackBaseUrl } : {}),
    ...(initialAuth.expiresAt ? { expiresAt: initialAuth.expiresAt } : {}),
    ...(initialAuth.extraHeaders
      ? { extraHeaders: { ...initialAuth.extraHeaders } }
      : {}),
    ...(initialAuth.metadata ? { metadata: { ...initialAuth.metadata } } : {})
  };

  const applyAcquired = (
    next: Awaited<ReturnType<SubscriptionCredentialBridge["acquireCredential"]>>
  ): void => {
    if (next.extraHeaders) {
      for (const key of Object.keys(next.extraHeaders)) {
        managedHeaderKeys.add(key);
      }
    }
    const nextBaseUrl = next.baseUrl || fallbackBaseUrl;
    credential = {
      provider: next.provider,
      accountId: next.accountId,
      apiKey: next.apiKey,
      ...(nextBaseUrl ? { baseUrl: nextBaseUrl } : {}),
      ...(next.expiresAt ? { expiresAt: next.expiresAt } : {}),
      ...(next.extraHeaders ? { extraHeaders: { ...next.extraHeaders } } : {}),
      ...(next.metadata ? { metadata: { ...next.metadata } } : {})
    };
  };

  return (requestModel, context, options) => {
    const forwarded = createAssistantMessageEventStream();

    void (async () => {
      let sawStart = false;
      let emittedOutput = false;
      let terminalSeen = false;
      let failoverAttempts = 0;

      const emitError = (targetModel: Model<Api>, error: unknown): void => {
        if (terminalSeen) return;
        const aborted = options?.signal?.aborted === true;
        terminalSeen = true;
        forwarded.push({
          type: "error",
          reason: aborted ? "aborted" : "error",
          error: createFailoverErrorMessage(targetModel, error, aborted)
        });
      };

      const buildAttemptRequest = (): {
        model: Model<Api>;
        options: SimpleStreamOptions;
      } => {
        const cleanedModelHeaders = stripKeys(
          requestModel.headers,
          managedHeaderKeys
        );
        const nextModelHeaders = {
          ...cleanedModelHeaders,
          ...(credential.extraHeaders ?? {})
        };
        const { headers: _prevHeaders, ...baseRequestModel } = requestModel;
        const nextModel = {
          ...baseRequestModel,
          ...(credential.baseUrl ? { baseUrl: credential.baseUrl } : {}),
          ...(Object.keys(nextModelHeaders).length > 0
            ? { headers: nextModelHeaders }
            : {})
        } as Model<Api>;
        const metadataHeaders: Record<string, string> = {};
        if (credential.metadata?.projectId) {
          metadataHeaders["x-writer-subscription-project-id"] =
            credential.metadata.projectId;
        }
        if (credential.metadata?.profileArn) {
          metadataHeaders["x-writer-subscription-profile-arn"] =
            credential.metadata.profileArn;
        }
        const cleanedOptionHeaders = stripKeys(
          options?.headers,
          managedHeaderKeys
        );
        const nextOptionHeaders = {
          ...cleanedOptionHeaders,
          ...(credential.extraHeaders ?? {}),
          ...metadataHeaders
        };
        const { headers: _prevOptionHeaders, ...baseOptions } = options ?? {};
        const nextOptions: SimpleStreamOptions = {
          ...baseOptions,
          apiKey: credential.apiKey,
          ...(Object.keys(nextOptionHeaders).length > 0
            ? { headers: nextOptionHeaders }
            : {})
        };
        return { model: nextModel, options: nextOptions };
      };

      try {
        if (
          !credential.apiKey ||
          credential.apiKey === "pending-refresh" ||
          isExpiringSoon(credential.expiresAt, now())
        ) {
          const refreshed = await bridge.acquireCredential({
            provider: credential.provider,
            modelId: config.id,
            accountId: credential.accountId
          });
          applyAcquired(refreshed);
        }
      } catch (error: unknown) {
        emitError(requestModel, error);
        return;
      }

      while (!terminalSeen) {
        const attempt = buildAttemptRequest();
        let failoverReason: ClassifiedSubscriptionFailure | undefined;
        let terminalErrorEvent:
          Extract<AssistantMessageEvent, { type: "error" }> | undefined;

        try {
          const source = await streamFn(
            attempt.model,
            context,
            attempt.options
          );
          for await (const event of source) {
            if (event.type === "start") {
              if (sawStart) continue;
              sawStart = true;
              forwarded.push(event);
              continue;
            }
            if (event.type === "error") {
              const classified = classifySubscriptionFailure(event.error);
              if (
                classified &&
                !emittedOutput &&
                !options?.signal?.aborted &&
                failoverAttempts < maxFailovers
              ) {
                failoverReason = classified;
                break;
              }
              if (classified && emittedOutput && !options?.signal?.aborted) {
                // Output has already streamed to the user: never replay/concatenate.
                // Report status in background so the next request switches accounts.
                void bridge
                  .reportAndFailover({
                    provider: credential.provider,
                    modelId: config.id,
                    failedAccountId: credential.accountId,
                    reason: classified.reason,
                    ...(classified.retryAfterSec !== undefined
                      ? { retryAfterSec: classified.retryAfterSec }
                      : {}),
                    ...(classified.resetAt !== undefined
                      ? { resetAt: classified.resetAt }
                      : {}),
                    message: classified.message
                  })
                  .catch(() => undefined);
              }
              terminalErrorEvent = event;
              break;
            }
            if (isAssistantOutputEvent(event)) {
              emittedOutput = true;
            }
            if (event.type === "done") {
              terminalSeen = true;
            }
            forwarded.push(event);
          }
        } catch (error: unknown) {
          const classified = classifySubscriptionFailure(error);
          if (
            classified &&
            !emittedOutput &&
            !options?.signal?.aborted &&
            failoverAttempts < maxFailovers
          ) {
            failoverReason = classified;
          } else {
            if (classified && emittedOutput && !options?.signal?.aborted) {
              void bridge
                .reportAndFailover({
                  provider: credential.provider,
                  modelId: config.id,
                  failedAccountId: credential.accountId,
                  reason: classified.reason,
                  ...(classified.retryAfterSec !== undefined
                    ? { retryAfterSec: classified.retryAfterSec }
                    : {}),
                  ...(classified.resetAt !== undefined
                    ? { resetAt: classified.resetAt }
                    : {}),
                  message: classified.message
                })
                .catch(() => undefined);
            }
            emitError(attempt.model, error);
            return;
          }
        }

        if (failoverReason) {
          failoverAttempts += 1;
          try {
            const nextCredential = await bridge.reportAndFailover({
              provider: credential.provider,
              modelId: config.id,
              failedAccountId: credential.accountId,
              reason: failoverReason.reason,
              ...(failoverReason.retryAfterSec !== undefined
                ? { retryAfterSec: failoverReason.retryAfterSec }
                : {}),
              ...(failoverReason.resetAt !== undefined
                ? { resetAt: failoverReason.resetAt }
                : {}),
              message: failoverReason.message
            });
            applyAcquired(nextCredential);
            continue;
          } catch (failoverError: unknown) {
            emitError(attempt.model, failoverError);
            return;
          }
        }

        if (terminalErrorEvent) {
          terminalSeen = true;
          forwarded.push(terminalErrorEvent);
          return;
        }

        if (!terminalSeen) {
          emitError(
            attempt.model,
            "Model stream ended without a terminal event."
          );
          return;
        }
      }
    })();

    return forwarded;
  };
}
