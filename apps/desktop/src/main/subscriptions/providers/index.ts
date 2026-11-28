import { ProviderAdapterRegistry } from "../registry";
import type { SubscriptionProviderAdapter } from "../types";
import type { ProviderEnvironmentOptions } from "./shared";
import { createAnthropicClaudeAdapter } from "./anthropic-claude";
import { createCodeBuddyAdapter } from "./codebuddy";
import { createCursorAdapter } from "./cursor";
import { createGitHubCopilotAdapter } from "./github-copilot";
import { createGoogleAntigravityAdapter } from "./google-antigravity";
import { createGoogleGeminiCliAdapter } from "./google-gemini-cli";
import { googleOAuthClient } from "./google-oauth";
import { createKiroAdapter } from "./kiro";
import { createOpenAICodexAdapter } from "./openai-codex";
import { createWindsurfAdapter } from "./windsurf";

export function createPhaseOneSubscriptionAdapters(
  options: ProviderEnvironmentOptions = {}
): SubscriptionProviderAdapter[] {
  return [
    createGoogleGeminiCliAdapter({
      ...options,
      bundledOAuthClient: googleOAuthClient(
        import.meta.env.MAIN_VITE_WRITER_GOOGLE_GEMINI_CLIENT_ID,
        import.meta.env.MAIN_VITE_WRITER_GOOGLE_GEMINI_CLIENT_SECRET
      )
    }),
    createGoogleAntigravityAdapter(options),
    createOpenAICodexAdapter(options),
    createGitHubCopilotAdapter(options)
  ];
}

export function createPhaseTwoSubscriptionAdapters(
  options: ProviderEnvironmentOptions = {}
): SubscriptionProviderAdapter[] {
  return [createAnthropicClaudeAdapter(options), createKiroAdapter(options)];
}

export function createPhaseThreeASubscriptionAdapters(
  options: ProviderEnvironmentOptions = {}
): SubscriptionProviderAdapter[] {
  return [createCursorAdapter(options), createWindsurfAdapter(options)];
}

export function createPhaseThreeBSubscriptionAdapters(
  options: ProviderEnvironmentOptions = {}
): SubscriptionProviderAdapter[] {
  return [createCodeBuddyAdapter(options)];
}

export function createDefaultSubscriptionRegistry(
  options: ProviderEnvironmentOptions = {}
): ProviderAdapterRegistry {
  return new ProviderAdapterRegistry([
    ...createPhaseOneSubscriptionAdapters(options),
    ...createPhaseTwoSubscriptionAdapters(options),
    ...createPhaseThreeASubscriptionAdapters(options),
    ...createPhaseThreeBSubscriptionAdapters(options)
  ]);
}

export * from "./shared";
export * from "./google-gemini-cli";
export * from "./google-antigravity";
export * from "./openai-codex";
export * from "./github-copilot";
export * from "./anthropic-claude";
export * from "./kiro";
export * from "./cursor";
export * from "./windsurf";
export * from "./codebuddy";
