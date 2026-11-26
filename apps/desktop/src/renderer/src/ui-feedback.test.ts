import { afterEach, describe, expect, it, vi } from "vitest";
import { dismissUiMessage, uiMessage, uiMessageItems } from "./ui-feedback";

afterEach(() => {
  for (const item of [...uiMessageItems.value]) dismissUiMessage(item.id);
  vi.useRealTimers();
});

describe("ui-feedback", () => {
  it("keeps a message's action, and leaves ordinary messages without one", () => {
    const run = vi.fn();
    const withAction = uiMessage.warning("需要处理", {
      action: { label: "去处理", run }
    });
    const plain = uiMessage.info("已保存");
    expect(uiMessageItems.value.map((item) => item.action?.label)).toEqual([
      "去处理",
      undefined
    ]);
    uiMessageItems.value[0]?.action?.run();
    expect(run).toHaveBeenCalledTimes(1);
    dismissUiMessage(withAction);
    dismissUiMessage(plain);
  });

  it("deduplicates identical plain messages and resets their auto-dismiss timer", () => {
    vi.useFakeTimers();
    const firstId = uiMessage.info("已保存", { duration: 1_000 });
    vi.advanceTimersByTime(600);
    const secondId = uiMessage.info(" 已保存 ", { duration: 1_000 });

    expect(secondId).toBe(firstId);
    expect(uiMessageItems.value).toHaveLength(1);

    vi.advanceTimersByTime(600);
    expect(uiMessageItems.value).toHaveLength(1);

    vi.advanceTimersByTime(400);
    expect(uiMessageItems.value).toHaveLength(0);
  });

  it("does not conflate messages with actions or different kind/content", () => {
    const run = vi.fn();
    uiMessage.warning("连接异常", { action: { label: "重试", run } });
    uiMessage.warning("连接异常", { action: { label: "重试", run } });
    uiMessage.error("连接异常");
    expect(uiMessageItems.value).toHaveLength(3);

    for (const item of [...uiMessageItems.value]) dismissUiMessage(item.id);
    uiMessage.info("第一条");
    uiMessage.info("第二条");
    uiMessage.success("第一条");
    expect(uiMessageItems.value).toHaveLength(3);
  });
});
