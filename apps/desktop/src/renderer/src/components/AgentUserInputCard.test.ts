// @vitest-environment writer-renderer
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRenderer, defineComponent, h, nextTick } from "vue";
import type {
  AgentUserInputAnswer,
  AgentUserInputRequestedPayload
} from "@writer/contracts/renderer";
import AgentUserInputCard from "./AgentUserInputCard.vue";

vi.mock("./AppIcon.vue", () => ({
  default: defineComponent({ render: () => h("i") })
}));

vi.mock("./AgentTeamPromptReview.vue", () => ({
  default: defineComponent({ render: () => h("div") })
}));

vi.stubGlobal("window", {
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  innerWidth: 1280,
  innerHeight: 800
});
vi.stubGlobal("HTMLTextAreaElement", class {});

class TestNode {
  parent: TestNode | null = null;
  children: TestNode[] = [];
  props: Record<string, unknown> = {};
  listeners = new Map<string, Set<(event: unknown) => void>>();
  text = "";
  value = "";
  composing = false;

  constructor(readonly tag: string) {}

  addEventListener(type: string, listener: (event: unknown) => void): void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(listener);
  }

  removeEventListener(type: string, listener: (event: unknown) => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  dispatch(type: string): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener({ target: this, currentTarget: this, preventDefault() {} });
    }
  }
}

function createTestRenderer() {
  return createRenderer<TestNode, TestNode>({
    patchProp(el, key, _prev, next) {
      el.props[key] = next;
      if (key === "value") el.value = String(next ?? "");
    },
    insert(child, parent, anchor) {
      child.parent = parent;
      const index = anchor ? parent.children.indexOf(anchor) : -1;
      if (index >= 0) parent.children.splice(index, 0, child);
      else parent.children.push(child);
    },
    remove(child) {
      const parent = child.parent;
      if (!parent) return;
      const index = parent.children.indexOf(child);
      if (index >= 0) parent.children.splice(index, 1);
      child.parent = null;
    },
    createElement(tag) {
      return new TestNode(tag);
    },
    createText(text) {
      const node = new TestNode("#text");
      node.text = text;
      return node;
    },
    createComment() {
      return new TestNode("#comment");
    },
    setText(node, text) {
      node.text = text;
    },
    setElementText(node, text) {
      node.children = [];
      node.text = text;
    },
    parentNode(node) {
      return node.parent;
    },
    nextSibling(node) {
      const siblings = node.parent?.children ?? [];
      const index = siblings.indexOf(node);
      return index >= 0 ? (siblings[index + 1] ?? null) : null;
    },
    querySelector() {
      return new TestNode("body");
    }
  });
}

function walk(root: TestNode): TestNode[] {
  const result: TestNode[] = [];
  const visit = (node: TestNode) => {
    result.push(node);
    for (const child of node.children) visit(child);
  };
  visit(root);
  return result;
}

function textContent(node: TestNode): string {
  if (node.tag === "#text") return node.text;
  return node.text + node.children.map(textContent).join("");
}

function findByClass(root: TestNode, className: string): TestNode[] {
  return walk(root).filter((node) => {
    const cls = node.props.class;
    return typeof cls === "string" && cls.split(/\s+/).includes(className);
  });
}

async function click(node: TestNode): Promise<void> {
  const handler = node.props.onClick;
  if (typeof handler === "function") {
    await (handler as (event: unknown) => unknown)({
      currentTarget: node,
      target: node,
      preventDefault() {}
    });
  }
  await nextTick();
}

async function inputText(node: TestNode, value: string): Promise<void> {
  node.value = value;
  node.dispatch("input");
  const onUpdate = node.props["onUpdate:modelValue"];
  if (typeof onUpdate === "function") {
    (onUpdate as (v: string) => void)(value);
  }
  await nextTick();
}

let mountedApp: { unmount: () => void } | null = null;

afterEach(() => {
  mountedApp?.unmount();
  mountedApp = null;
});

function mountCard(request: AgentUserInputRequestedPayload): {
  submitted: AgentUserInputAnswer[][];
  root: TestNode;
} {
  const submitted: AgentUserInputAnswer[][] = [];
  const root = new TestNode("div");
  const renderer = createTestRenderer();
  const app = renderer.createApp({
    render: () =>
      h(AgentUserInputCard, {
        request,
        submitting: false,
        onSubmit: (answers: AgentUserInputAnswer[]) => {
          submitted.push(answers);
        }
      })
  });
  app.mount(root);
  mountedApp = app;
  return { submitted, root };
}

function sampleRequest(): AgentUserInputRequestedPayload {
  return {
    sessionId: "session_test_1",
    runId: "run_test_1",
    runtime: {
      provider: "example",
      model: "example-model",
      mode: "provider"
    },
    requestId: "req_multi_1",
    toolCallId: "tool_ask_1",
    source: "ask_user_question",
    questions: [
      {
        id: "q1",
        question: "你希望主角的初始身份是什么？",
        options: [
          { id: "opt_a", label: "落魄世家子" },
          { id: "opt_b", label: "底层杂役" }
        ]
      },
      {
        id: "q2",
        question: "单章字数目标是多少？",
        options: [
          { id: "opt_2k", label: "2500字" },
          { id: "opt_3k", label: "3000字" }
        ]
      },
      {
        id: "q3",
        question: "是否需要附加特殊禁忌？",
        options: [
          { id: "opt_yes", label: "需要" },
          { id: "opt_no", label: "不需要" }
        ]
      }
    ]
  };
}

describe("AgentUserInputCard per-question skip & custom input preservation", () => {
  it("preserves earlier custom answers when skipping the last question", async () => {
    const { submitted, root } = mountCard(sampleRequest());

    // Q1: click custom answer, type custom text without choosing any preset option, click next
    await click(findByClass(root, "agent-user-input-custom-trigger")[0]!);
    await inputText(
      findByClass(root, "agent-user-input-text")[0]!,
      "开局被退婚的炼丹学徒"
    );
    await click(findByClass(root, "agent-user-input-submit")[0]!);

    // Q2: choose preset option
    await click(findByClass(root, "agent-user-input-option")[0]!);

    // Q3 (last question): click Skip
    await click(findByClass(root, "agent-user-input-skip")[0]!);

    expect(submitted).toHaveLength(1);
    expect(submitted[0]).toEqual([
      { id: "q1", text: "开局被退婚的炼丹学徒" },
      { id: "q2", selectedOptionIds: ["opt_2k"] },
      { id: "q3", text: "跳过" }
    ]);
  });

  it("advances to the next question when skipping a non-final question", async () => {
    const { submitted, root } = mountCard(sampleRequest());

    // Q1: choose option A
    await click(findByClass(root, "agent-user-input-option")[0]!);

    // Q2: click Skip (should advance to Q3, NOT submit all as skipped)
    await click(findByClass(root, "agent-user-input-skip")[0]!);
    expect(submitted).toHaveLength(0);
    expect(textContent(root)).toContain("是否需要附加特殊禁忌？");

    // Q3: choose option B
    await click(findByClass(root, "agent-user-input-option")[1]!);

    expect(submitted).toHaveLength(1);
    expect(submitted[0]).toEqual([
      { id: "q1", selectedOptionIds: ["opt_a"] },
      { id: "q2", text: "跳过" },
      { id: "q3", selectedOptionIds: ["opt_no"] }
    ]);
  });

  it("preserves already answered questions when closing early via top-right close button", async () => {
    const { submitted, root } = mountCard(sampleRequest());

    // Q1: custom answer -> next
    await click(findByClass(root, "agent-user-input-custom-trigger")[0]!);
    await inputText(
      findByClass(root, "agent-user-input-text")[0]!,
      "只要爽快节奏"
    );
    await click(findByClass(root, "agent-user-input-submit")[0]!);

    // Close early on Q2 via top-right X button
    await click(findByClass(root, "agent-user-input-close")[0]!);

    expect(submitted).toHaveLength(1);
    expect(submitted[0]).toEqual([
      { id: "q1", text: "只要爽快节奏" },
      { id: "q2", text: "跳过" },
      { id: "q3", text: "跳过" }
    ]);
  });
});
