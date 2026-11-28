import {
  SUBSCRIPTION_PROVIDER_IDS,
  type SubscriptionProviderId
} from "@writer/contracts";
import {
  SubscriptionError,
  type SubscriptionProviderAdapter,
  type SubscriptionProviderMeta
} from "./types";

export const DEFAULT_SUBSCRIPTION_PROVIDER_METADATA: Record<
  SubscriptionProviderId,
  SubscriptionProviderMeta
> = {
  "google-gemini-cli": {
    name: "Google Gemini CLI",
    description:
      "通过 Google 账号 OAuth 或本机 Gemini CLI 凭证接入 Gemini 模型。",
    phase: 1,
    supportedAuthMethods: ["oauth", "local_import"]
  },
  "google-antigravity": {
    name: "Google Antigravity",
    description:
      "通过本机 Antigravity / Cockpit-Tools 凭证或 OAuth 接入订阅配额模型。",
    phase: 1,
    unofficialWarning:
      "当前平台通过社区适配协议接入，仅在本机只读使用凭证；如上游接口调整可能导致短暂不可用。",
    supportedAuthMethods: ["oauth", "local_import"]
  },
  "openai-codex": {
    name: "OpenAI Codex (ChatGPT)",
    description:
      "通过 ChatGPT 订阅账号 OAuth 或本机 Codex CLI 凭证接入 GPT 模型。",
    phase: 1,
    supportedAuthMethods: ["oauth", "local_import"]
  },
  "github-copilot": {
    name: "GitHub Copilot",
    description: "通过 GitHub Device Flow 或本机 Copilot 凭证接入已订阅模型。",
    phase: 1,
    supportedAuthMethods: ["device_flow", "local_import"]
  },
  "anthropic-claude": {
    name: "Claude 订阅 (Pro / Max)",
    description:
      "通过 Claude 订阅 OAuth 或本机 Claude Code 凭证接入 Claude 模型。",
    phase: 2,
    supportedAuthMethods: ["oauth", "local_import"]
  },
  kiro: {
    name: "Kiro (AWS)",
    description: "通过 AWS Builder ID 或本机 Kiro 凭证接入订阅模型。",
    phase: 2,
    supportedAuthMethods: ["device_flow", "oauth", "local_import"]
  },
  cursor: {
    name: "Cursor",
    description:
      "通过原生授权、本机只读导入或手动粘贴凭证接入 Cursor 账号与配额。",
    phase: 3,
    unofficialWarning:
      "当前平台登录与配额监控对齐 Cockpit-Tools；直连对话协议属社区实验适配，受 Cursor 上游变更影响可能不可用。",
    supportedAuthMethods: ["oauth", "local_import", "manual_token"]
  },
  windsurf: {
    name: "Windsurf",
    description: "通过本机只读导入或手动粘贴凭证接入 Windsurf 账号与配额。",
    phase: 3,
    unofficialWarning:
      "当前平台凭证刷新与配额监控对齐 Cockpit-Tools；直连对话协议属社区实验适配，受 Windsurf 上游变更影响可能不可用。",
    supportedAuthMethods: ["local_import", "manual_token"]
  },
  codebuddy: {
    name: "CodeBuddy",
    description:
      "通过浏览器授权、本机只读导入或手动凭证接入 CodeBuddy 账号与配额。",
    phase: 3,
    unofficialWarning:
      "当前平台登录、刷新与配额监控对齐 Cockpit-Tools；直连对话协议属社区实验适配，受上游接口变更影响可能不可用。",
    supportedAuthMethods: ["oauth", "local_import", "manual_token"]
  }
};

export interface ProviderRegistryEntry {
  provider: SubscriptionProviderId;
  meta: SubscriptionProviderMeta;
  implemented: boolean;
  adapter?: SubscriptionProviderAdapter;
}

export class ProviderAdapterRegistry {
  private readonly adapters = new Map<
    SubscriptionProviderId,
    SubscriptionProviderAdapter
  >();

  constructor(adapters: readonly SubscriptionProviderAdapter[] = []) {
    for (const adapter of adapters) {
      this.register(adapter);
    }
  }

  register(adapter: SubscriptionProviderAdapter): void {
    this.adapters.set(adapter.id, adapter);
  }

  unregister(provider: SubscriptionProviderId): boolean {
    return this.adapters.delete(provider);
  }

  get(
    provider: SubscriptionProviderId
  ): SubscriptionProviderAdapter | undefined {
    return this.adapters.get(provider);
  }

  require(provider: SubscriptionProviderId): SubscriptionProviderAdapter {
    const adapter = this.adapters.get(provider);
    if (!adapter) {
      const name = DEFAULT_SUBSCRIPTION_PROVIDER_METADATA[provider].name;
      throw new SubscriptionError(
        "subscriptions.provider_not_implemented",
        `${name} 平台暂未启用适配器。`
      );
    }
    return adapter;
  }

  has(provider: SubscriptionProviderId): boolean {
    return this.adapters.has(provider);
  }

  listAdapters(): SubscriptionProviderAdapter[] {
    return SUBSCRIPTION_PROVIDER_IDS.flatMap((provider) => {
      const adapter = this.adapters.get(provider);
      return adapter ? [adapter] : [];
    });
  }

  listEntries(): ProviderRegistryEntry[] {
    return SUBSCRIPTION_PROVIDER_IDS.map((provider) => {
      const adapter = this.adapters.get(provider);
      return {
        provider,
        meta: adapter?.meta ?? DEFAULT_SUBSCRIPTION_PROVIDER_METADATA[provider],
        implemented: Boolean(adapter),
        ...(adapter ? { adapter } : {})
      };
    });
  }
}
