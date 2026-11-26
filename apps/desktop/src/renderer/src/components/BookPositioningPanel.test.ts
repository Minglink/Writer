// @vitest-environment writer-renderer
import { createPinia, setActivePinia } from "pinia";
import { afterEach, expect, it, vi } from "vitest";
import { createRenderer, defineComponent, h, nextTick, ref } from "vue";
import {
  DEFAULT_LONG_CHARACTER_TYPES,
  LONG_BOOK_LINE_FILE_ID,
  LONG_CHARACTER_OVERVIEW_FILE_ID,
  LONG_CHARACTER_OVERVIEW_PATH,
  createCatalogDraftDirectory,
  createDefaultBookPlotStages,
  createDefaultCreativePlotStages,
  createEmptyLongMarkdownFileReference,
  createLongWorkspaceNavigationSnapshot,
  type CatalogIndexSnapshot,
  type LongBookSummary,
  type LongWorkspaceIndexSnapshot,
  type ScriptBook,
  type ShortBook,
  type UpdateBookInput
} from "@writer/contracts/renderer";
import { useExternalControlBridge } from "../extras/external-control/useExternalControlBridge";
import { useCatalogIndexStore } from "../stores/catalogIndexStore";
import { useLongWorkspaceStore } from "../stores/longWorkspaceStore";
import LongStructureDialog from "./LongStructureDialog.vue";
import PlotStructureDialog from "./PlotStructureDialog.vue";
import WritingContextPanel from "./WritingContextPanel.vue";

const { toastSuccess, toastWarning, toastError, toastInfo } = vi.hoisted(
  () => ({
    toastSuccess: vi.fn(),
    toastWarning: vi.fn(),
    toastError: vi.fn(),
    toastInfo: vi.fn()
  })
);

vi.mock("../ui-feedback", () => ({
  uiMessage: {
    success: toastSuccess,
    warning: toastWarning,
    error: toastError,
    info: toastInfo
  }
}));

vi.mock("./PopupSelect.vue", () => ({
  default: defineComponent({ render: () => h("button") })
}));

type EventListenerFn = (event: unknown) => void;

class TestNode {
  parent: TestNode | null = null;
  children: TestNode[] = [];
  props: Record<string, unknown> = {};
  style: Record<string, string> = {};
  listeners = new Map<string, Set<EventListenerFn>>();
  text = "";
  value = "";
  checked = false;
  scrollTop = 0;
  tabIndex = 0;
  isConnected = true;
  focus = vi.fn();

  constructor(readonly tag: string) {}

  addEventListener(type: string, listener: EventListenerFn): void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(listener);
  }

  removeEventListener(type: string, listener: EventListenerFn): void {
    this.listeners.get(type)?.delete(listener);
  }

  dispatch(type: string, extra: Record<string, unknown> = {}): void {
    const event = {
      type,
      target: this,
      currentTarget: this,
      preventDefault() {},
      ...extra
    };
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }

  querySelector(): TestNode | null {
    return null;
  }

  querySelectorAll(): TestNode[] {
    return [];
  }

  contains(): boolean {
    return false;
  }

  getRootNode(): unknown {
    return document;
  }

  textContent(): string {
    if (this.tag === "#comment") return "";
    if (this.tag === "#text") return this.text;
    return this.children.map((child) => child.textContent()).join("");
  }
}

function find(
  parent: TestNode,
  match: (node: TestNode) => boolean
): TestNode | undefined {
  for (const child of parent.children) {
    if (match(child)) return child;
    const nested = find(child, match);
    if (nested) return nested;
  }
  return undefined;
}

function findAll(
  parent: TestNode,
  match: (node: TestNode) => boolean,
  acc: TestNode[] = []
): TestNode[] {
  for (const child of parent.children) {
    if (match(child)) acc.push(child);
    findAll(child, match, acc);
  }
  return acc;
}

function remove(node: TestNode): void {
  if (node.parent) {
    const index = node.parent.children.indexOf(node);
    if (index >= 0) node.parent.children.splice(index, 1);
  }
  node.parent = null;
}

const body = new TestNode("body");
const renderer = createRenderer<TestNode, TestNode>({
  patchProp(node, key, _previous, value) {
    node.props[key] = value;
    if (key === "value" && typeof value === "string") {
      node.value = value;
    }
    if (key === "checked" && typeof value === "boolean") {
      node.checked = value;
    }
  },
  insert(node, parent, anchor) {
    remove(node);
    node.parent = parent;
    const index = anchor
      ? parent.children.indexOf(anchor)
      : parent.children.length;
    parent.children.splice(
      index >= 0 ? index : parent.children.length,
      0,
      node
    );
  },
  remove,
  createElement: (tag) => new TestNode(tag),
  createText: (text) => {
    const node = new TestNode("#text");
    node.text = text;
    return node;
  },
  createComment: () => new TestNode("#comment"),
  setText(node, text) {
    node.text = text;
  },
  setElementText(node, text) {
    node.children = [];
    const textNode = new TestNode("#text");
    textNode.text = text;
    textNode.parent = node;
    node.children.push(textNode);
  },
  parentNode: (node) => node.parent,
  nextSibling: (node) =>
    node.parent?.children[node.parent.children.indexOf(node) + 1] ?? null,
  querySelector: () => body
});

const cleanups: Array<() => void> = [];

class TestDocument {
  activeElement: unknown = body;
  body = body;
  addEventListener = vi.fn();
  removeEventListener = vi.fn();
  querySelector = () => null;
}

class TestShadowRoot {}

function stubBrowserEnvironment(writerApi: Record<string, unknown> = {}): void {
  vi.stubGlobal("Document", TestDocument);
  vi.stubGlobal("ShadowRoot", TestShadowRoot);
  vi.stubGlobal("document", new TestDocument());
  vi.stubGlobal("window", {
    writer: writerApi,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn()
  });
}

function registerTestBridgePorts(writerApi: Record<string, unknown> = {}) {
  const draft = ref("");
  const messages = ref<Array<{ id: string; role: string; text: string }>>([]);
  const open = vi.fn().mockResolvedValue(true);
  const send = vi.fn(async () => {
    messages.value = [
      ...messages.value,
      {
        id: `msg-${messages.value.length + 1}`,
        role: "user",
        text: draft.value
      }
    ];
    draft.value = "";
  });

  const conversation = {
    draft,
    messages,
    selectedModelId: ref("model-1"),
    configuredModels: ref([{ id: "model-1", enabled: true }]),
    isBusy: ref(false),
    hasPendingEditReview: ref(false),
    sessionId: ref("session-1"),
    overrideNextApprovalMode: vi.fn(),
    overrideNextAgentTeamMode: vi.fn()
  };

  const stop = useExternalControlBridge({
    api: () => writerApi as never,
    open,
    conversation: () => conversation as never,
    conversationsRestored: () => Promise.resolve(),
    teamAvailable: () => false,
    sendReady: () => true,
    send,
    longEditorHasUnsavedChanges: () => false
  });
  cleanups.push(stop);

  return { open, send, draft, messages, conversation };
}

function createLongFixture(
  overrides: Partial<
    Pick<LongBookSummary, "id" | "title" | "genre" | "pacingMode" | "tropes">
  > = {}
): {
  index: LongWorkspaceIndexSnapshot;
  summary: LongBookSummary;
} {
  const timestamp = "2026-06-01T00:00:00.000Z";
  const bookId = overrides.id ?? "longbook_1";
  const index: LongWorkspaceIndexSnapshot = {
    schemaVersion: 1,
    bookId,
    updatedAt: timestamp,
    featureSettings: {
      worldbuildingItemLayout: "top-tabs",
      characterAndContinuityItemLayout: "top-tabs",
      plotItemLayout: "top-tabs"
    },
    worldbuilding: [],
    characterTypes: DEFAULT_LONG_CHARACTER_TYPES.map((item) => ({ ...item })),
    characterOverview: createEmptyLongMarkdownFileReference(
      LONG_CHARACTER_OVERVIEW_FILE_ID,
      LONG_CHARACTER_OVERVIEW_PATH,
      timestamp
    ),
    characters: [],
    characterFiles: [],
    bookLine: createEmptyLongMarkdownFileReference(
      LONG_BOOK_LINE_FILE_ID,
      "plot/book-line.md",
      timestamp
    ),
    plot: {
      volumes: [],
      arcs: [],
      chapterCards: [],
      storyEvents: [],
      storyPlots: [],
      eventConnections: [],
      narrativePlacements: [],
      foreshadowing: []
    },
    chapters: [],
    ledger: {
      committedThroughChapterId: null,
      commits: [],
      projection: {
        throughCommitId: null,
        facts: [],
        knowledge: [],
        openLoops: [],
        latestHandoff: null
      }
    }
  };
  const summary: LongBookSummary = {
    schemaVersion: 1,
    kind: "writer.long-book",
    id: bookId,
    title: overrides.title ?? "云海仙途",
    bookType: "long",
    genre: overrides.genre ?? "仙侠",
    ...(overrides.pacingMode !== undefined
      ? { pacingMode: overrides.pacingMode }
      : { pacingMode: "qidian" }),
    ...(overrides.tropes !== undefined
      ? { tropes: [...overrides.tropes] }
      : { tropes: ["凡人流", "自定义古镜"] }),
    status: "editing",
    linkedMaterialIdsByKind: {
      character: [],
      gimmick: [],
      plot: [],
      draft: [],
      other: []
    },
    linkedSkillIdsByKind: {
      general: [],
      plot: [],
      style: [],
      other: []
    },
    createdAt: timestamp,
    updatedAt: timestamp,
    navigation: createLongWorkspaceNavigationSnapshot(index)
  };
  return { index, summary };
}

function createShortBookFixture(
  overrides: Partial<
    Pick<
      ShortBook,
      "id" | "title" | "genre" | "pacingMode" | "tropes" | "projectRevision"
    >
  > = {}
): ShortBook {
  const timestamp = "2026-06-01T00:00:00.000Z";
  const plotStages = createDefaultBookPlotStages({ allEnabled: true });
  return {
    id: overrides.id ?? "short-1",
    title: overrides.title ?? "雾夜回响",
    bookType: "short",
    genre: overrides.genre ?? "追妻",
    ...(overrides.pacingMode !== undefined
      ? { pacingMode: overrides.pacingMode }
      : { pacingMode: "viral_short" }),
    ...(overrides.tropes !== undefined
      ? { tropes: [...overrides.tropes] }
      : { tropes: ["追妻火葬场"] }),
    status: "editing",
    linkedMaterialIdsByKind: {
      character: [],
      gimmick: [],
      plot: [],
      draft: [],
      other: []
    },
    linkedSkillIdsByKind: {
      general: [],
      plot: [],
      style: [],
      other: []
    },
    characterStructure: { format: "text" },
    plotStages,
    documents: [
      {
        id: "character_design",
        title: "人物设计",
        content: "",
        createdAt: timestamp,
        updatedAt: timestamp
      },
      ...plotStages.map((stage) => ({
        id: stage.id,
        title: stage.title,
        content: "",
        createdAt: timestamp,
        updatedAt: timestamp
      }))
    ],
    draft: createCatalogDraftDirectory(timestamp),
    projectRevision: overrides.projectRevision ?? 3,
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

function createScriptBookFixture(
  overrides: Partial<
    Pick<ScriptBook, "id" | "title" | "genre" | "projectRevision">
  > = {}
): ScriptBook {
  const short = createShortBookFixture({
    id: overrides.id ?? "script-1",
    title: overrides.title ?? "暗潮夜航",
    genre: overrides.genre ?? "悬疑",
    projectRevision: overrides.projectRevision ?? 5
  });
  const { pacingMode: _pacing, tropes: _tropes, ...rest } = short;
  return {
    ...rest,
    bookType: "script",
    genre: overrides.genre ?? "悬疑"
  };
}

function toCatalogIndexBook(
  book: ShortBook | ScriptBook
): CatalogIndexSnapshot["books"][number] {
  return {
    ...book,
    documents: book.documents.map((doc) => ({
      ...doc,
      content: "",
      contentBytes: 0,
      contentStamp: "fs-v1:0"
    })),
    draft: {
      ...book.draft,
      sections: book.draft.sections.map((section) => ({
        ...section,
        body: {
          ...section.body,
          content: "",
          contentBytes: 0,
          contentStamp: "fs-v1:0"
        },
        characterState: {
          ...section.characterState,
          content: "",
          contentBytes: 0,
          contentStamp: "fs-v1:0"
        }
      }))
    }
  };
}

function createEmptyCatalogSnapshot(
  books: ReadonlyArray<ShortBook | ScriptBook>
): CatalogIndexSnapshot {
  return {
    schemaVersion: 1,
    revision: 1,
    creativePlotStages: createDefaultCreativePlotStages(),
    books: books.map(toCatalogIndexBook),
    materials: [],
    materialGroups: [],
    skills: [],
    skillGroups: [],
    updatedAt: "2026-06-01T00:00:00.000Z"
  };
}

function buttonByText(text: string, root = body): TestNode {
  const found = find(
    root,
    (node) => node.tag === "button" && node.textContent().trim() === text
  );
  if (!found) {
    throw new Error(`Missing button "${text}"`);
  }
  return found;
}

function radioByValue(name: string, value: string, root = body): TestNode {
  const found = find(
    root,
    (node) =>
      node.tag === "input" &&
      node.props.type === "radio" &&
      node.props.name === name &&
      node.props.value === value
  );
  if (!found) {
    throw new Error(`Missing radio ${name}=${value}`);
  }
  return found;
}

function selectRadio(name: string, value: string, root = body): void {
  const radio = radioByValue(name, value, root);
  radio.checked = true;
  radio.dispatch("change");
}

function setTextareaValue(node: TestNode, value: string): void {
  node.value = value;
  node.dispatch("input");
}

async function flushUi(): Promise<void> {
  await nextTick();
  await nextTick();
}

function invoke(node: TestNode, handlerName: string, payload: unknown = {}) {
  const fn = node.props[handlerName] as
    ((arg: unknown) => Promise<void> | void) | undefined;
  if (!fn) {
    throw new Error(`Missing handler ${handlerName} on <${node.tag}>`);
  }
  return fn(payload);
}

afterEach(async () => {
  while (cleanups.length > 0) {
    cleanups.pop()?.();
  }
  await nextTick();
  body.children = [];
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it("renders long book positioning under settings, saves positioning in place, and hands off smooth transition to agent", async () => {
  const pinia = createPinia();
  setActivePinia(pinia);
  const longStore = useLongWorkspaceStore();
  const { index, summary } = createLongFixture();
  longStore.activateBook(summary.id);
  longStore.publishWorkspace({
    bookId: summary.id,
    workspaceIndex: index,
    summary
  });

  const updatePositioning = vi.fn(async (input) => {
    const nextTimestamp = "2026-06-02T00:00:00.000Z";
    const nextIndex: LongWorkspaceIndexSnapshot = {
      ...index,
      updatedAt: nextTimestamp
    };
    const nextSummary: LongBookSummary = {
      ...summary,
      genre: input.genre,
      ...(input.pacingMode
        ? { pacingMode: input.pacingMode }
        : { pacingMode: undefined }),
      ...(input.tropes?.length
        ? { tropes: [...input.tropes] }
        : { tropes: [] }),
      updatedAt: nextTimestamp,
      navigation: createLongWorkspaceNavigationSnapshot(nextIndex)
    };
    return {
      book: {
        schemaVersion: 1 as const,
        id: nextSummary.id,
        title: nextSummary.title,
        bookType: "long" as const,
        genre: nextSummary.genre,
        ...(nextSummary.pacingMode
          ? { pacingMode: nextSummary.pacingMode }
          : {}),
        ...(nextSummary.tropes?.length ? { tropes: nextSummary.tropes } : {}),
        status: nextSummary.status,
        linkedMaterialIdsByKind: nextSummary.linkedMaterialIdsByKind,
        linkedSkillIdsByKind: nextSummary.linkedSkillIdsByKind,
        createdAt: nextSummary.createdAt,
        updatedAt: nextTimestamp,
        workspaceIndex: nextIndex
      },
      summary: nextSummary
    };
  });

  const writerApi = {
    long: { updatePositioning }
  };
  stubBrowserEnvironment(writerApi);
  const bridge = registerTestBridgePorts(writerApi);

  const onClose = vi.fn();
  const app = renderer.createApp({
    render() {
      return h(LongStructureDialog, {
        open: true,
        bookTitle: summary.title,
        bookId: summary.id,
        snapshot: index,
        agentsMd: "# 现有设定",
        onClose
      });
    }
  });
  app.use(pinia);
  const root = new TestNode("root");
  app.mount(root);
  cleanups.push(() => app.unmount());
  await nextTick();

  const positioningNavButton = buttonByText("网文定位");
  await invoke(positioningNavButton, "onClick");
  await flushUi();
  expect(positioningNavButton.props["aria-current"]).toBe(true);

  expect(radioByValue("bookPositioningChannel", "male").checked).toBe(true);
  expect(radioByValue("bookPositioningGenre", "仙侠").checked).toBe(true);
  expect(body.textContent()).toContain("已选 2/6");
  expect(buttonByText("自定义古镜").props["aria-pressed"]).toBe(true);
  expect(buttonByText("仅保存定位").props.disabled).toBe(true);

  selectRadio("bookPositioningChannel", "female");
  await nextTick();
  expect(body.textContent()).toContain("当前题材：仙侠");
  expect(buttonByText("仅保存定位").props.disabled).toBe(true);
  expect(buttonByText("自定义古镜").props["aria-pressed"]).toBe(true);

  selectRadio("bookPositioningChannel", "male");
  await nextTick();

  selectRadio("bookPositioningGenre", "玄幻脑洞");
  const fanqieCard = find(
    body,
    (node) => node.tag === "button" && node.textContent().includes("番茄快节奏")
  )!;
  await invoke(fanqieCard, "onClick");
  await invoke(buttonByText("系统"), "onClick");
  await nextTick();

  expect(body.textContent()).toContain("已选 3/6");
  expect(buttonByText("仅保存定位").props.disabled).toBe(false);

  await invoke(buttonByText("仅保存定位"), "onClick");
  await nextTick();

  expect(updatePositioning).toHaveBeenCalledExactlyOnceWith({
    bookId: "longbook_1",
    genre: "玄幻脑洞",
    pacingMode: "fanqie",
    tropes: ["凡人流", "自定义古镜", "系统"]
  });
  expect(longStore.activeBookSummary?.genre).toBe("玄幻脑洞");
  expect(longStore.activeBookSummary?.pacingMode).toBe("fanqie");
  expect(longStore.activeBookSummary?.tropes).toEqual([
    "凡人流",
    "自定义古镜",
    "系统"
  ]);
  expect(toastSuccess).toHaveBeenCalledWith("网文定位已保存");
  expect(onClose).not.toHaveBeenCalled();
  expect(buttonByText("仅保存定位").props.disabled).toBe(true);

  selectRadio("bookPositioningGenre", "规则怪谈");
  await invoke(buttonByText("凡人流"), "onClick");
  const noteTextarea = find(
    body,
    (node) =>
      node.tag === "textarea" &&
      String(node.props.placeholder ?? "").includes("秘境副本")
  )!;
  setTextareaValue(noteTextarea, "从下一卷禁区秘境切入怪谈规则");
  await nextTick();

  await invoke(buttonByText("保存并交由智能体平滑过渡"), "onClick");
  await flushUi();

  expect(updatePositioning).toHaveBeenCalledTimes(2);
  expect(updatePositioning).toHaveBeenLastCalledWith({
    bookId: "longbook_1",
    genre: "规则怪谈",
    pacingMode: "fanqie",
    tropes: ["自定义古镜", "系统"]
  });
  expect(onClose).toHaveBeenCalledOnce();
  expect(bridge.open).toHaveBeenCalledWith(
    { kind: "long", id: "longbook_1" },
    { preserveSelection: true }
  );
  expect(bridge.send).toHaveBeenCalledOnce();
  const sentPrompt = bridge.messages.value[0]?.text ?? "";
  expect(sentPrompt).toContain("玄幻脑洞 → 规则怪谈");
  expect(sentPrompt).toContain("移除：-凡人流");
  expect(sentPrompt).toContain("悬疑脑洞与规则怪谈框架");
  expect(sentPrompt).toContain("从下一卷禁区秘境切入怪谈规则");
});

it("renders short book positioning in PlotStructureDialog, enforces 6-trope limit, saves via catalog.updateBook, and refreshes catalogIndexStore", async () => {
  const pinia = createPinia();
  setActivePinia(pinia);
  const catalogStore = useCatalogIndexStore();
  let currentShortBook = createShortBookFixture({
    genre: "追妻",
    pacingMode: "viral_short",
    tropes: ["追妻火葬场", "虐渣打脸", "清醒独立", "大女主", "重生"],
    projectRevision: 7
  });
  catalogStore.applySnapshot(createEmptyCatalogSnapshot([currentShortBook]));

  const updateBook = vi.fn(async (input: UpdateBookInput) => {
    currentShortBook = {
      ...currentShortBook,
      ...(input.genre ? { genre: input.genre } : {}),
      ...(input.pacingMode === null
        ? { pacingMode: undefined }
        : input.pacingMode !== undefined
          ? { pacingMode: input.pacingMode }
          : {}),
      ...(input.tropes !== undefined ? { tropes: [...input.tropes] } : {}),
      projectRevision: (input.baseProjectRevision ?? 0) + 1,
      updatedAt: "2026-06-02T00:00:00.000Z"
    };
    return currentShortBook;
  });
  const indexApi = vi.fn(async () =>
    createEmptyCatalogSnapshot([currentShortBook])
  );

  stubBrowserEnvironment({
    catalog: {
      updateBook,
      index: indexApi
    }
  });
  const bridge = registerTestBridgePorts({
    catalog: {
      updateBook,
      index: indexApi
    }
  });

  const onClose = vi.fn();
  const app = renderer.createApp({
    render() {
      return h(PlotStructureDialog, {
        open: true,
        book: currentShortBook,
        writingContext: "# 短篇约定",
        onClose
      });
    }
  });
  app.use(pinia);
  app.mount(new TestNode("root"));
  cleanups.push(() => app.unmount());
  await nextTick();

  await invoke(buttonByText("网文定位"), "onClick");
  await flushUi();

  expect(radioByValue("bookPositioningChannel", "female").checked).toBe(true);
  expect(body.textContent()).toContain("已选 5/6");

  await invoke(buttonByText("真假千金"), "onClick");
  await nextTick();
  expect(body.textContent()).toContain("已选 6/6");

  await invoke(buttonByText("穿书"), "onClick");
  await nextTick();
  expect(toastWarning).toHaveBeenCalledOnce();
  expect(body.textContent()).toContain("已选 6/6");

  selectRadio("bookPositioningGenre", "真假千金");
  const viralShortCard = find(
    body,
    (node) =>
      node.tag === "button" && node.textContent().includes("盐选/番茄爆款短篇")
  )!;
  await invoke(viralShortCard, "onClick");
  await nextTick();

  await invoke(buttonByText("仅保存定位"), "onClick");
  await nextTick();
  await nextTick();

  expect(updateBook).toHaveBeenCalledExactlyOnceWith({
    bookId: "short-1",
    baseProjectRevision: 7,
    genre: "真假千金",
    pacingMode: null,
    tropes: ["追妻火葬场", "虐渣打脸", "清醒独立", "大女主", "重生", "真假千金"]
  });
  expect(indexApi).toHaveBeenCalledOnce();
  const refreshedBook = catalogStore.snapshot?.books[0] as
    ShortBook | undefined;
  expect(refreshedBook?.genre).toBe("真假千金");
  expect(refreshedBook?.pacingMode).toBeUndefined();
  expect(refreshedBook?.projectRevision).toBe(8);
  expect(toastSuccess).toHaveBeenCalledWith("网文定位已保存");
  expect(onClose).not.toHaveBeenCalled();

  const refinedCard = find(
    body,
    (node) =>
      node.tag === "button" && node.textContent().includes("精品叙事短篇")
  )!;
  await invoke(refinedCard, "onClick");
  await nextTick();
  await invoke(buttonByText("保存并交由智能体平滑过渡"), "onClick");
  await flushUi();
  await nextTick();

  expect(updateBook).toHaveBeenCalledTimes(2);
  expect(updateBook).toHaveBeenLastCalledWith(
    expect.objectContaining({
      bookId: "short-1",
      baseProjectRevision: 8,
      genre: "真假千金",
      pacingMode: "refined_short"
    })
  );
  expect(onClose).toHaveBeenCalledOnce();
  expect(bridge.open).toHaveBeenCalledWith(
    { kind: "short", id: "short-1" },
    { preserveSelection: true }
  );
  expect(bridge.send).toHaveBeenCalledOnce();
  expect(bridge.messages.value[0]?.text).toContain(
    "未指定（默认） → 精品叙事短篇（重质感与余韵）"
  );
});

it("renders script genre tab in PlotStructureDialog without web-novel controls and saves genre via catalog.updateBook", async () => {
  const pinia = createPinia();
  setActivePinia(pinia);
  const catalogStore = useCatalogIndexStore();
  let currentScriptBook = createScriptBookFixture({
    genre: "悬疑",
    projectRevision: 4
  });
  catalogStore.applySnapshot(createEmptyCatalogSnapshot([currentScriptBook]));

  const updateBook = vi.fn(async (input: UpdateBookInput) => {
    currentScriptBook = {
      ...currentScriptBook,
      ...(input.genre ? { genre: input.genre } : {}),
      projectRevision: (input.baseProjectRevision ?? 0) + 1,
      updatedAt: "2026-06-02T00:00:00.000Z"
    };
    return currentScriptBook;
  });
  const indexApi = vi.fn(async () =>
    createEmptyCatalogSnapshot([currentScriptBook])
  );

  stubBrowserEnvironment({
    catalog: {
      updateBook,
      index: indexApi
    }
  });

  const onClose = vi.fn();
  const app = renderer.createApp({
    render() {
      return h(PlotStructureDialog, {
        open: true,
        book: currentScriptBook,
        onClose
      });
    }
  });
  app.use(pinia);
  app.mount(new TestNode("root"));
  cleanups.push(() => app.unmount());
  await nextTick();

  expect(
    find(
      body,
      (node) => node.tag === "button" && node.textContent() === "网文定位"
    )
  ).toBeUndefined();
  await invoke(buttonByText("剧本题材"), "onClick");
  await flushUi();

  expect(
    find(body, (node) => node.props.name === "bookPositioningChannel")
  ).toBeUndefined();
  expect(
    find(
      body,
      (node) =>
        node.tag === "button" &&
        node.textContent().includes("保存并交由智能体平滑过渡")
    )
  ).toBeUndefined();
  expect(findAll(body, (node) => node.tag === "textarea")).toHaveLength(0);

  const saveGenreBtn = buttonByText("保存题材");
  expect(saveGenreBtn.props.disabled).toBe(true);

  selectRadio("bookPositioningGenre", "科幻");
  await nextTick();
  expect(saveGenreBtn.props.disabled).toBe(false);

  await invoke(saveGenreBtn, "onClick");
  await nextTick();
  await nextTick();

  expect(updateBook).toHaveBeenCalledExactlyOnceWith({
    bookId: "script-1",
    baseProjectRevision: 4,
    genre: "科幻"
  });
  expect(toastSuccess).toHaveBeenCalledWith("剧本题材已保存");
  expect(onClose).not.toHaveBeenCalled();
});

it("shows co-creation button in WritingContextPanel for supported workspaces, hides for academic, and flushes draft before handoff", async () => {
  const pinia = createPinia();
  setActivePinia(pinia);
  const writerApi = {};
  stubBrowserEnvironment(writerApi);
  const bridge = registerTestBridgePorts(writerApi);

  const workspaceType = ref<
    "long" | "short" | "script" | "mystery" | "academic"
  >("academic");
  const bookId = ref<string | null>("book-ctx-1");
  const onSave = vi.fn(
    (_content: string, completion: { succeed(): void; fail(): void }) => {
      completion.succeed();
    }
  );
  const onRequestClose = vi.fn();

  const app = renderer.createApp({
    render() {
      return h(WritingContextPanel, {
        content: "初始上下文",
        loading: false,
        pending: false,
        workspaceType: workspaceType.value,
        bookId: bookId.value,
        onSave,
        onRequestClose
      });
    }
  });
  app.use(pinia);
  const root = new TestNode("root");
  app.mount(root);
  cleanups.push(() => app.unmount());
  await nextTick();

  expect(
    find(
      root,
      (node) =>
        node.tag === "button" && node.textContent().trim() === "与智能体共创"
    )
  ).toBeUndefined();

  for (const kind of ["long", "short", "script", "mystery"] as const) {
    workspaceType.value = kind;
    await nextTick();
    expect(buttonByText("与智能体共创", root).props.disabled).toBe(false);
  }

  bookId.value = null;
  await nextTick();
  expect(
    find(
      root,
      (node) =>
        node.tag === "button" && node.textContent().trim() === "与智能体共创"
    )
  ).toBeUndefined();

  bookId.value = "mystery-9";
  onSave.mockImplementationOnce((_content, completion) => {
    completion.fail();
  });
  await nextTick();

  const editor = find(root, (node) => node.tag === "textarea")!;
  setTextareaValue(editor, "新增一条推理公平性红线");
  await nextTick();

  await invoke(buttonByText("与智能体共创", root), "onClick");
  await nextTick();
  expect(onSave).toHaveBeenCalledTimes(1);
  expect(onRequestClose).not.toHaveBeenCalled();
  expect(bridge.open).not.toHaveBeenCalled();

  await invoke(buttonByText("与智能体共创", root), "onClick");
  await nextTick();
  await nextTick();

  expect(onSave).toHaveBeenCalledTimes(2);
  expect(onSave).toHaveBeenLastCalledWith(
    "新增一条推理公平性红线",
    expect.objectContaining({
      succeed: expect.any(Function),
      fail: expect.any(Function)
    })
  );
  expect(onRequestClose).toHaveBeenCalledOnce();
  expect(bridge.open).toHaveBeenCalledWith(
    { kind: "mystery", id: "mystery-9" },
    { preserveSelection: true }
  );
  expect(bridge.send).toHaveBeenCalledOnce();
  expect(bridge.messages.value[0]?.text).toContain("剧本杀作品");
  expect(bridge.messages.value[0]?.text).toContain("AGENTS.md");
});
