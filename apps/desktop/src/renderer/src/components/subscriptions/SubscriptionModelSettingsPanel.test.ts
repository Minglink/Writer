import { createSSRApp } from "vue";
import { renderToString } from "vue/server-renderer";
import SubscriptionAccountQuota from "./SubscriptionAccountQuota.vue";
// @vitest-environment writer-renderer
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRenderer, defineComponent, h, nextTick } from "vue";
import type {
  SubscriptionSettingsSnapshot,
  SystemEventEnvelope,
  WriterApi
} from "@writer/contracts/renderer";
import settingsPageSource from "../SettingsPage.vue?raw";
import panelSource from "./SubscriptionModelSettingsPanel.vue?raw";
import { settingsSections } from "../settingsCategories";
import { buildModelSelectOptions } from "../../utils/modelSelectOptions";
import {
  formatContextWindow,
  formatCountdown,
  formatSubscriptionError
} from "./subscriptionLabels";
import { useSubscriptionModelSettings } from "./useSubscriptionModelSettings";

const { toastSuccess, toastWarning, toastError, toastInfo } = vi.hoisted(
  () => ({
    toastSuccess: vi.fn(),
    toastWarning: vi.fn(),
    toastError: vi.fn(),
    toastInfo: vi.fn()
  })
);

vi.mock("../../ui-feedback", () => ({
  uiMessage: {
    success: toastSuccess,
    warning: toastWarning,
    error: toastError,
    info: toastInfo
  }
}));

const noopRenderer = createRenderer<
  Record<string, never>,
  Record<string, never>
>({
  patchProp() {},
  insert() {},
  remove() {},
  createElement: () => ({}),
  createText: () => ({}),
  createComment: () => ({}),
  setText() {},
  setElementText() {},
  parentNode: () => null,
  nextSibling: () => null
});

const unmounts: Array<() => void> = [];

afterEach(() => {
  for (const unmount of unmounts.splice(0)) {
    unmount();
  }
  toastSuccess.mockReset();
  toastWarning.mockReset();
  toastError.mockReset();
  toastInfo.mockReset();
});

function createSnapshot(): SubscriptionSettingsSnapshot {
  return {
    defaultModelId: "sub:google-gemini-cli:gemini-2.5-pro",
    providers: [
      {
        provider: "google-gemini-cli",
        name: "Google Gemini CLI",
        description: "Google Gemini CLI",
        phase: 1,
        implemented: true,
        supportedAuthMethods: ["oauth", "local_import"],
        accounts: [
          {
            id: "acct_gem_1",
            provider: "google-gemini-cli",
            displayName: "primary@example.test",
            email: "primary@example.test",
            planTier: "Pro",
            source: "local_import",
            isPrimary: true,
            enabled: true,
            status: "active",
            quotaBuckets: [
              {
                id: "pro",
                label: "Gemini 2.5 Pro",
                remainingPercent: 82,
                resetsAt: new Date(Date.now() + 3 * 3_600_000).toISOString()
              }
            ],
            createdAt: "2026-11-28T00:00:00.000Z"
          },
          {
            id: "acct_gem_2",
            provider: "google-gemini-cli",
            displayName: "backup@example.test",
            email: "backup@example.test",
            planTier: "Pro",
            source: "oauth",
            isPrimary: false,
            enabled: true,
            status: "cooldown",
            cooldownUntil: new Date(Date.now() + 180_000).toISOString(),
            quotaBuckets: [],
            createdAt: "2026-11-28T00:00:00.000Z"
          }
        ],
        models: [
          {
            id: "sub:google-gemini-cli:gemini-2.5-pro",
            provider: "google-gemini-cli",
            modelId: "gemini-2.5-pro",
            label: "Gemini 2.5 Pro",
            api: "google-cloud-code-assist",
            reasoning: true,
            defaultThinkingLevel: "medium",
            contextWindow: 1_048_576,
            enabled: true,
            recommended: true
          },
          {
            id: "sub:google-gemini-cli:gemini-2.5-flash",
            provider: "google-gemini-cli",
            modelId: "gemini-2.5-flash",
            label: "Gemini 2.5 Flash",
            api: "google-cloud-code-assist",
            reasoning: true,
            defaultThinkingLevel: "low",
            contextWindow: 1_048_576,
            enabled: false,
            recommended: false
          }
        ]
      },
      {
        provider: "google-antigravity",
        name: "Google Antigravity",
        description: "Antigravity",
        phase: 1,
        implemented: true,
        unofficialWarning: "社区适配非官方渠道提示。",
        supportedAuthMethods: ["oauth", "local_import"],
        accounts: [],
        models: []
      },
      {
        provider: "github-copilot",
        name: "GitHub Copilot",
        description: "Copilot",
        phase: 1,
        implemented: true,
        supportedAuthMethods: ["device_flow", "local_import"],
        accounts: [],
        models: []
      },
      {
        provider: "anthropic-claude",
        name: "Claude",
        description: "Claude Pro/Max",
        phase: 2,
        implemented: false,
        supportedAuthMethods: ["oauth"],
        accounts: [],
        models: []
      }
    ]
  };
}

function mountComposable(
  writer: Partial<WriterApi>,
  onModelsChanged = vi.fn()
) {
  let controller!: ReturnType<typeof useSubscriptionModelSettings>;
  const Host = defineComponent({
    setup() {
      controller = useSubscriptionModelSettings({
        api: () => writer as WriterApi,
        onModelsChanged
      });
      return () => h("div");
    }
  });
  const app = noopRenderer.createApp(Host);
  app.mount({});
  unmounts.push(() => app.unmount());
  return { controller, onModelsChanged };
}

async function flushUi(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await nextTick();
}

describe("Subscription model settings UI, composable, and wiring", () => {
  it("starts quota details closed and distinguishes missing, unlimited, small and exhausted balances", async () => {
    const account = createSnapshot().providers[0]!.accounts[0]!;
    const html = await renderToString(
      createSSRApp(SubscriptionAccountQuota, {
        account: {
          ...account,
          quotaBuckets: [
            { id: "missing", label: "Unknown" },
            { id: "unlimited", label: "Unlimited", unlimited: true },
            { id: "small", label: "Small", remainingPercent: 0.001 },
            { id: "high", label: "High", remainingPercent: 99.96136 },
            { id: "almost", label: "Almost", remainingPercent: 99.999255 },
            {
              id: "zero",
              label: "Zero",
              remainingPercent: 0,
              resetsAt: "2026-10-01T00:00:00.000Z"
            }
          ]
        },
        now: Date.parse("2026-11-01T00:00:00.000Z")
      })
    );
    expect(html).toContain("刷新配额");
    expect(html).toMatch(/<details class="sub-model-quota-details">/);
    expect(html.match(/role="progressbar"/g)).toHaveLength(4);
    expect(html).toContain("上游未提供");
    expect(html).toContain("不限量");
    expect(html).toContain("0.001%");
    expect(html).toContain("99.96%");
    expect(html).toContain("99.9993%");
    expect(html).toContain("重置时间已过");
  });

  it("registers subscription-models lazily in SettingsPage, scopes CSS with sub-model- prefix, and groups subscription models cleanly", () => {
    const modelsSection = settingsSections.find(
      (section) => section.id === "models-and-usage"
    );
    expect(
      modelsSection?.categories.some((cat) => cat.id === "subscription-models")
    ).toBe(true);
    expect(settingsPageSource).toContain(
      '() => import("./subscriptions/SubscriptionModelSettingsPanel.vue")'
    );
    expect(settingsPageSource).toContain(
      "activeCategory === 'subscription-models'"
    );
    expect(panelSource).toContain("sub-model-panel");
    expect(panelSource).toContain("sub-model-unofficial-notice");
    expect(panelSource).toContain('src="./subscription-models.css"');

    const options = buildModelSelectOptions([
      {
        id: "sub:google-gemini-cli:gemini-2.5-pro",
        label: "Gemini 2.5 Pro",
        provider: "google-gemini-cli",
        managedBy: "subscription"
      },
      {
        id: "sub:openai-codex:gpt-5.3-codex",
        label: "GPT-5.3 Codex",
        provider: "openai-codex",
        managedBy: "subscription"
      }
    ]);
    expect(options.map((item) => item.group)).toEqual([
      { key: "subscription:google-gemini-cli", label: "Google Gemini CLI" },
      { key: "subscription:openai-codex", label: "OpenAI Codex" }
    ]);

    expect(
      formatSubscriptionError({
        code: "subscriptions.safe_storage_unavailable",
        message: "raw"
      })
    ).toContain("加密存储");
    expect(formatContextWindow(1_048_576)).toBe("1.0M");
    expect(formatContextWindow(272_000)).toBe("272K");
    expect(
      formatCountdown(new Date(Date.now() + 180_000).toISOString(), Date.now())
    ).toBeTruthy();
  });

  it("handles optimistic model toggle with rollback, primary switching, default selection, model test, remove flow, local scan, and Device Flow events", async () => {
    let state = createSnapshot();
    const eventListeners = new Set<(event: SystemEventEnvelope) => void>();
    let failNextModelToggle = false;

    const subscriptionsApi = {
      getState: vi.fn(async () => state),
      startAuth: vi.fn(
        async (input: {
          provider: string;
          method?: "oauth" | "device_flow" | undefined;
        }) => {
          if (input.method === "oauth") {
            return {
              authSessionId: "auth_oauth_1",
              provider: "google-gemini-cli" as const,
              method: "oauth" as const,
              verificationUri: "https://accounts.example.test/oauth?state=demo"
            };
          }
          return {
            authSessionId: "auth_dev_1",
            provider: "github-copilot" as const,
            method: "device_flow" as const,
            userCode: "WXYZ-7890",
            verificationUri: "https://gh.example.test/login/device",
            expiresAt: new Date(Date.now() + 600_000).toISOString()
          };
        }
      ),
      cancelAuth: vi.fn(async () => ({ cancelled: true })),
      scanLocal: vi.fn(async () => ({
        candidates: [
          {
            candidateId: "gemini:local",
            provider: "google-gemini-cli" as const,
            displayName: "local-cli@example.test",
            email: "local-cli@example.test",
            sourceLabel: "Gemini CLI 本地配置",
            sourcePathHint: "~/.gemini/oauth_creds.json",
            alreadyImported: false
          }
        ]
      })),
      importLocal: vi.fn(async () => state),
      importManual: vi.fn(async () => state),
      setPrimaryAccount: vi.fn(async ({ accountId }: { accountId: string }) => {
        state = {
          ...state,
          providers: state.providers.map((p) =>
            p.provider === "google-gemini-cli"
              ? {
                  ...p,
                  accounts: p.accounts.map((a) => ({
                    ...a,
                    isPrimary: a.id === accountId
                  }))
                }
              : p
          )
        };
        return state;
      }),
      setAccountEnabled: vi.fn(async () => state),
      removeAccount: vi.fn(async ({ accountId }: { accountId: string }) => {
        state = {
          ...state,
          providers: state.providers.map((p) =>
            p.provider === "google-gemini-cli"
              ? {
                  ...p,
                  accounts: p.accounts.filter((a) => a.id !== accountId)
                }
              : p
          )
        };
        return state;
      }),
      refreshQuota: vi.fn(async () => state),
      refreshModels: vi.fn(async () => state),
      setModelEnabled: vi.fn(
        async ({ modelId, enabled }: { modelId: string; enabled: boolean }) => {
          if (failNextModelToggle) {
            throw {
              code: "subscriptions.operation_failed",
              message: "模型开关保存失败"
            };
          }
          state = {
            ...state,
            providers: state.providers.map((p) => ({
              ...p,
              models: p.models.map((m) =>
                m.id === modelId ? { ...m, enabled } : m
              )
            }))
          };
          return state;
        }
      ),
      setDefaultModel: vi.fn(async ({ modelId }: { modelId: string }) => {
        state = { ...state, defaultModelId: modelId };
        return state;
      })
    };

    const modelsTest = vi.fn(async () => ({
      modelId: "sub:google-gemini-cli:gemini-2.5-pro",
      ok: true,
      message: "连接成功",
      testedAt: "2026-11-28T00:00:00.000Z",
      contextWindow: 1_048_576,
      maxTokens: 65_536
    }));

    const { controller, onModelsChanged } = mountComposable({
      subscriptions: subscriptionsApi,
      models: { test: modelsTest } as unknown as WriterApi["models"],
      events: {
        subscribe(listener) {
          eventListeners.add(listener);
          return () => eventListeners.delete(listener);
        }
      }
    });

    await flushUi();

    expect(
      controller.implementedProviders.value.map((p) => p.provider)
    ).toEqual(["google-gemini-cli", "google-antigravity", "github-copilot"]);
    expect(controller.upcomingProviders.value.map((p) => p.provider)).toEqual([
      "anthropic-claude"
    ]);
    expect(controller.activeProvider.value?.provider).toBe("google-gemini-cli");

    // Optimistic model toggle updates immediately before IPC resolves, then reconciles.
    const flashModel = controller.activeProvider.value!.models[1]!;
    expect(flashModel.enabled).toBe(false);
    const togglePromise = controller.toggleModel(flashModel, true);
    expect(controller.activeProvider.value!.models[1]!.enabled).toBe(true);
    await togglePromise;
    expect(onModelsChanged).toHaveBeenCalledTimes(1);

    // Failed toggle reverts cleanly and shows toast without leaving stale UI.
    failNextModelToggle = true;
    await controller.toggleModel(
      controller.activeProvider.value!.models[1]!,
      false
    );
    expect(controller.activeProvider.value!.models[1]!.enabled).toBe(true);
    expect(toastError).toHaveBeenCalledWith("模型开关保存失败");
    failNextModelToggle = false;

    // Set primary account.
    await controller.setPrimaryAccount("google-gemini-cli", "acct_gem_2");
    expect(
      controller.activeProvider.value!.accounts.find(
        (a) => a.id === "acct_gem_2"
      )?.isPrimary
    ).toBe(true);

    // Set default model.
    await controller.setDefaultModel(
      controller.activeProvider.value!.models[1]!
    );
    expect(controller.snapshot.value?.defaultModelId).toBe(
      "sub:google-gemini-cli:gemini-2.5-flash"
    );

    // Refresh latest models calls IPC, notifies model selector refresh, and shows toast.
    const modelChangesBeforeRefresh = onModelsChanged.mock.calls.length;
    await controller.refreshModels("google-gemini-cli");
    expect(subscriptionsApi.refreshModels).toHaveBeenCalledWith({
      provider: "google-gemini-cli"
    });
    expect(onModelsChanged.mock.calls.length).toBeGreaterThan(
      modelChangesBeforeRefresh
    );

    // Test model connection passes managedBy: "subscription".
    await controller.testModel(controller.activeProvider.value!.models[0]!);
    expect(modelsTest).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "sub:google-gemini-cli:gemini-2.5-pro",
        managedBy: "subscription"
      })
    );
    expect(toastSuccess).toHaveBeenCalledWith("连接成功");

    // Remove account requires explicit confirmation.
    const backup = controller.activeProvider.value!.accounts[1]!;
    controller.requestRemoveAccount(backup);
    expect(controller.removeConfirmAccount.value?.id).toBe(backup.id);
    expect(subscriptionsApi.removeAccount).not.toHaveBeenCalled();
    await controller.confirmRemoveAccount();
    expect(subscriptionsApi.removeAccount).toHaveBeenCalledWith({
      provider: "google-gemini-cli",
      accountId: backup.id
    });
    expect(controller.removeConfirmAccount.value).toBeNull();

    // Local scan & import.
    await controller.openScanDialog();
    expect(controller.scanDialog.value.candidates).toHaveLength(1);
    await controller.importSelectedCandidates(
      controller.scanDialog.value.candidates
    );
    expect(subscriptionsApi.importLocal).toHaveBeenCalledWith({
      provider: "google-gemini-cli",
      candidateId: "gemini:local"
    });
    expect(controller.scanDialog.value.open).toBe(false);

    // Manual token import dialog flow.
    controller.openManualImportDialog(state.providers[0]!);
    expect(controller.manualImportProvider.value?.provider).toBe(
      "google-gemini-cli"
    );
    await controller.submitManualImport({
      token: "placeholder-manual-token",
      email: "manual@example.test"
    });
    expect(subscriptionsApi.importManual).toHaveBeenCalledWith({
      provider: "google-gemini-cli",
      token: "placeholder-manual-token",
      email: "manual@example.test"
    });
    expect(controller.manualImportProvider.value).toBeNull();

    // OAuth flow preserves verificationUri so users can copy or reopen the login link.
    await controller.startAuth(state.providers[0]!, "oauth");
    expect(subscriptionsApi.startAuth).toHaveBeenCalledWith({
      provider: "google-gemini-cli",
      method: "oauth",
      openBrowser: false
    });
    expect(controller.authSession.value?.verificationUri).toBe(
      "https://accounts.example.test/oauth?state=demo"
    );
    await controller.cancelAuth("auth_oauth_1");
    expect(controller.authSession.value).toBeNull();

    // Device Flow modal opens and closes upon live authProgress + stateChanged.
    const copilot = controller.implementedProviders.value[2]!;
    await controller.startAuth(copilot, "device_flow");
    expect(controller.authSession.value?.userCode).toBe("WXYZ-7890");

    for (const listener of eventListeners) {
      listener({
        protocolVersion: 1,
        id: "evt_auth_1",
        type: "subscriptions.authProgress",
        timestamp: "2026-11-28T00:01:00.000Z",
        context: { correlationId: "evt_auth_1" },
        payload: {
          authSessionId: "auth_dev_1",
          provider: "github-copilot",
          status: "completed",
          accountId: "acct_cop_1"
        }
      });
      listener({
        protocolVersion: 1,
        id: "evt_state_1",
        type: "subscriptions.stateChanged",
        timestamp: "2026-11-28T00:01:01.000Z",
        context: { correlationId: "evt_state_1" },
        payload: {
          reason: "account_added",
          provider: "github-copilot",
          accountId: "acct_cop_1",
          autoDefaultModelId: "sub:github-copilot:gpt-5.3-codex"
        }
      });
    }
    await flushUi();
    expect(controller.authSession.value).toBeNull();
    expect(toastInfo).toHaveBeenCalled();

    // A fast provider can finish before the IPC start reply reaches the renderer.
    const starting = controller.startAuth(copilot, "device_flow");
    for (const listener of eventListeners) {
      listener({
        protocolVersion: 1,
        id: "evt_early",
        type: "subscriptions.authProgress",
        timestamp: "2026-11-28T00:01:01.000Z",
        context: { correlationId: "evt_early" },
        payload: {
          provider: "github-copilot",
          authSessionId: "auth_dev_1",
          status: "failed",
          message: "Fixture expired"
        }
      });
    }
    await starting;
    expect(controller.authSession.value?.status).toBe("failed");
  });
});
