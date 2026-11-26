import { createPinia, setActivePinia } from "pinia";
import { computed, ref } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultGeneralSettings } from "@writer/contracts/renderer";
import type { AgentConversationController } from "../composables/useAgentConversation";
import {
  activeWorkspaceControlPorts,
  useExternalControlBridge,
  type ExternalControlBridgePorts
} from "../extras/external-control/useExternalControlBridge";
import { locale } from "../i18n";
import { useLayoutStore } from "../stores/layoutStore";
import { useSettingsStore } from "../stores/settingsStore";
import { dismissUiMessage, uiMessage, uiMessageItems } from "../ui-feedback";
import {
  buildPositioningTransitionPrompt,
  buildWritingContextCoCreationPrompt,
  handoffWritingContextToAgent
} from "./writingContextCoCreationHandoff";
import { writingContextCoCreationT } from "./writingContextCoCreationMessages";

const disposers: Array<() => void> = [];

beforeEach(() => {
  setActivePinia(createPinia());
  locale.value = "zh-CN";
});

afterEach(() => {
  while (disposers.length > 0) {
    disposers.pop()?.();
  }
  for (const item of [...uiMessageItems.value]) {
    dismissUiMessage(item.id);
  }
  vi.restoreAllMocks();
  locale.value = "zh-CN";
});

function createHandoffHarness(options?: {
  openResult?: boolean;
  selectedModelId?: string;
  modelEnabled?: boolean;
  busy?: boolean;
  pendingReview?: boolean;
  sendAppendsMessage?: boolean;
}) {
  const messages = ref<Array<Record<string, unknown>>>([]);
  const draft = ref("");
  const selectedModelId = ref(options?.selectedModelId ?? "model-1");
  const configuredModels = ref([
    {
      id: "model-1",
      enabled: options?.modelEnabled ?? true
    }
  ]);
  const busy = ref(options?.busy ?? false);
  const pendingReview = ref(options?.pendingReview ?? false);

  const conversation = {
    messages,
    draft,
    selectedModelId,
    configuredModels,
    isBusy: computed(() => busy.value),
    hasPendingEditReview: computed(() => pendingReview.value)
  } as unknown as AgentConversationController;

  const open = vi.fn<ExternalControlBridgePorts["open"]>(
    async () => options?.openResult ?? true
  );
  const send = vi.fn(async () => {
    if (options?.sendAppendsMessage !== false) {
      const sent = draft.value;
      draft.value = "";
      messages.value.push(
        { id: "u-1", role: "user", content: sent },
        { id: "a-1", role: "assistant", content: "收到" }
      );
    }
  });

  const dispose = useExternalControlBridge({
    api: () => ({}) as never,
    open,
    conversation: () => conversation,
    conversationsRestored: async () => undefined,
    teamAvailable: () => false,
    sendReady: () => true,
    send,
    longEditorHasUnsavedChanges: () => false
  });
  disposers.push(dispose);

  return {
    open,
    send,
    draft,
    messages,
    busy,
    pendingReview,
    selectedModelId,
    dispose
  };
}

describe("writingContextCoCreationHandoff", () => {
  it("builds localized co-creation prompts for workspaces in zh-CN and en-US", () => {
    locale.value = "zh-CN";
    const zhPrompt = buildWritingContextCoCreationPrompt("script");
    expect(zhPrompt).toContain("这部剧本");
    expect(zhPrompt).toContain("AGENTS.md");
    expect(zhPrompt).toContain("Diff");

    locale.value = "en-US";
    const enPrompt = buildWritingContextCoCreationPrompt("mystery");
    expect(enPrompt).toContain("this mystery game");
    expect(enPrompt).toContain("AGENTS.md");
    expect(enPrompt).toContain("Diff proposal card");
  });

  it("builds positioning transition prompts in zh-CN with framework preset, trope diffs, note, and non-destructive rules", () => {
    locale.value = "zh-CN";
    const prompt = buildPositioningTransitionPrompt({
      bookType: "long",
      before: {
        genre: "都市",
        pacingMode: "fanqie",
        tropes: ["系统", "杀伐果断"]
      },
      after: {
        genre: "玄幻",
        pacingMode: "qidian",
        tropes: ["凡人流", "杀伐果断", "智商在线"]
      },
      transitionNote: "  从现代卷自然飞升灵界，保留主角底线。  "
    });

    expect(prompt).toContain("都市 → 玄幻");
    expect(prompt).toContain(
      "番茄快节奏（免费算法流） → 起点长线精品（付费订阅流）"
    );
    expect(prompt).toContain("+凡人流、+智商在线");
    expect(prompt).toContain("-系统");
    expect(prompt).toContain("保留：杀伐果断");
    expect(prompt).toContain("玄幻仙侠升级换图框架");
    expect(prompt).toContain("核心规则与金手指");
    expect(prompt).toContain("从现代卷自然飞升灵界，保留主角底线。");
    expect(prompt).toContain(
      "既往已写正文、已有角色档案与已落盘世界观内容严禁改动"
    );
    expect(prompt).toContain("Diff 审阅卡片");
  });

  it("builds positioning transition prompts in en-US and omits blank transition notes", () => {
    locale.value = "en-US";
    const prompt = buildPositioningTransitionPrompt({
      bookType: "short",
      before: {
        genre: "悬疑",
        pacingMode: null,
        tropes: ["规则怪谈"]
      },
      after: {
        genre: "悬疑",
        pacingMode: "viral_short",
        tropes: []
      },
      transitionNote: "   "
    });

    expect(prompt).toContain("Mystery (unchanged)");
    expect(prompt).toContain(
      "Unset (Default) → High-Hook Twist Short (Viral Short)"
    );
    expect(prompt).toContain("Added: None");
    expect(prompt).toContain("Removed: -规则怪谈");
    expect(prompt).toContain("Retained: None");
    expect(prompt).not.toContain("[Author Transition & Tuning Note]");
    expect(prompt).not.toContain("Target Genre Framework Preset");
    expect(prompt).toContain(
      "Do NOT modify any already-written manuscript chapters/sections"
    );
    expect(prompt).toContain("Diff review card");
  });

  it("opens with preserveSelection, uncollapses right pane in editor-agent layout, and auto-sends when idle with an active model", async () => {
    const harness = createHandoffHarness();
    const layoutStore = useLayoutStore();
    const settingsStore = useSettingsStore();
    layoutStore.showSettings();
    layoutStore.setPaneCollapsed("right", true);
    settingsStore.markLoaded("general", {
      ...createDefaultGeneralSettings(),
      workspacePaneLayout: "editor-agent"
    });

    const result = await handoffWritingContextToAgent({
      bookId: "long_1",
      workspaceType: "long",
      prompt: "请协助过渡定位"
    });

    expect(result).toBe("sent");
    expect(harness.open).toHaveBeenCalledWith(
      { kind: "long", id: "long_1" },
      { preserveSelection: true }
    );
    expect(layoutStore.currentView).toBe("workspace");
    expect(layoutStore.rightCollapsed).toBe(false);
    expect(harness.send).toHaveBeenCalledOnce();
    expect(harness.messages.value[0]).toMatchObject({
      role: "user",
      content: "请协助过渡定位"
    });
  });

  it("leaves right pane collapsed state untouched in agent-editor layout", async () => {
    createHandoffHarness();
    const layoutStore = useLayoutStore();
    const settingsStore = useSettingsStore();
    layoutStore.setPaneCollapsed("right", true);
    settingsStore.markLoaded("general", {
      ...createDefaultGeneralSettings(),
      workspacePaneLayout: "agent-editor"
    });

    const result = await handoffWritingContextToAgent({
      bookId: "short_1",
      workspaceType: "short"
    });

    expect(result).toBe("sent");
    expect(layoutStore.rightCollapsed).toBe(true);
  });

  it.each([
    ["no model is selected", { selectedModelId: "" }],
    ["the selected model is disabled", { modelEnabled: false }],
    ["the conversation is busy", { busy: true }],
    ["a pending edit review blocks sending", { pendingReview: true }]
  ] as const)(
    "prefills the draft and notifies when %s",
    async (_reason, overrides) => {
      const infoSpy = vi.spyOn(uiMessage, "info");
      const harness = createHandoffHarness(overrides);

      const result = await handoffWritingContextToAgent({
        bookId: "short_1",
        workspaceType: "short",
        prompt: "与智能体共创上下文"
      });

      expect(result).toBe("prefilled");
      expect(harness.send).not.toHaveBeenCalled();
      expect(harness.draft.value).toBe("与智能体共创上下文");
      expect(infoSpy).toHaveBeenCalledWith(
        writingContextCoCreationT("handoffDraftPrefilled")
      );
    }
  );

  it("returns unavailable and warns without mutating layout when bridge is absent or open fails", async () => {
    const warnSpy = vi.spyOn(uiMessage, "warning");
    const layoutStore = useLayoutStore();
    const settingsStore = useSettingsStore();
    layoutStore.showSettings();
    layoutStore.setPaneCollapsed("right", true);
    settingsStore.markLoaded("general", {
      ...createDefaultGeneralSettings(),
      workspacePaneLayout: "editor-agent"
    });

    expect(activeWorkspaceControlPorts).toBeNull();
    await expect(
      handoffWritingContextToAgent({
        bookId: "long_missing",
        workspaceType: "long"
      })
    ).resolves.toBe("unavailable");
    expect(layoutStore.currentView).toBe("settings");
    expect(layoutStore.rightCollapsed).toBe(true);
    expect(warnSpy).toHaveBeenCalledWith(
      writingContextCoCreationT("handoffWorkspaceUnavailable")
    );

    warnSpy.mockClear();
    const harness = createHandoffHarness({ openResult: false });
    await expect(
      handoffWritingContextToAgent({
        bookId: "long_missing",
        workspaceType: "long"
      })
    ).resolves.toBe("unavailable");
    expect(layoutStore.currentView).toBe("settings");
    expect(layoutStore.rightCollapsed).toBe(true);
    expect(warnSpy).toHaveBeenCalledWith(
      writingContextCoCreationT("handoffWorkspaceUnavailable")
    );

    harness.dispose();
    expect(activeWorkspaceControlPorts).toBeNull();
  });
});
