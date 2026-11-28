import type { AgentProviderRuntimeConfig } from "@writer/contracts";
import type { SimpleStreamOptions } from "@earendil-works/pi-ai";
import { isGeminiModelId } from "./gemini-openai";

const WRITING_SAFETY_CATEGORIES = [
  "HARM_CATEGORY_HARASSMENT",
  "HARM_CATEGORY_HATE_SPEECH",
  "HARM_CATEGORY_SEXUALLY_EXPLICIT",
  "HARM_CATEGORY_DANGEROUS_CONTENT"
] as const;

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

const GEMINI_SAFETY_APIS = new Set([
  "google-generative-ai",
  "google-cloud-code-assist",
  "google-antigravity"
]);

/**
 * Set explicit writing defaults for Gemini's configurable filters. Core
 * prohibited-content protections remain enforced by the service. Pi exposes
 * SDK parameters under config while Cloud Code Assist / Antigravity wire
 * envelopes place them under request.
 */
export function applyGeminiWritingSafetySettings(
  config: Pick<
    AgentProviderRuntimeConfig,
    "api" | "modelId" | "requestModelId"
  >,
  options: SimpleStreamOptions
): SimpleStreamOptions {
  if (
    !GEMINI_SAFETY_APIS.has(config.api) ||
    ![config.modelId, config.requestModelId ?? ""].some(isGeminiModelId)
  )
    return options;

  const safetySettings = WRITING_SAFETY_CATEGORIES.map((category) => ({
    category,
    threshold: "BLOCK_NONE"
  }));

  return {
    ...options,
    onPayload: async (payload, model) => {
      const request = record(payload);
      const requestConfig = record(request?.config);
      const wireRequest = record(request?.request);
      const adapted =
        request && requestConfig
          ? {
              ...request,
              config: {
                ...requestConfig,
                safetySettings
              }
            }
          : request && wireRequest
            ? {
                ...request,
                request: {
                  ...wireRequest,
                  safetySettings
                }
              }
            : payload;
      const replacement = await options.onPayload?.(adapted, model);
      return replacement === undefined ? adapted : replacement;
    }
  };
}
