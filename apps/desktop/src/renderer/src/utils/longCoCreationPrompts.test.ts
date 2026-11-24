import { describe, expect, it } from "vitest";
import {
  buildEmptyCardBrainstormPrompt,
  buildSelectionCoCreationPrompt
} from "./longCoCreationPrompts";

describe("longCoCreationPrompts", () => {
  it("builds read-only critique prompt with author intent", () => {
    const prompt = buildSelectionCoCreationPrompt({
      mode: "critique",
      chapterTitle: "第一章",
      intent: "我希望读者先怀疑她，她自己还没察觉"
    });
    expect(prompt).toContain("读读这段");
    expect(prompt).toContain("仅给只读边注");
    expect(prompt).toContain("我希望读者先怀疑她，她自己还没察觉");
  });

  it("builds brainstorm prompt asking for two costly directions by default", () => {
    const prompt = buildSelectionCoCreationPrompt({
      mode: "brainstorm",
      chapterTitle: "第一章",
      intent: ""
    });
    expect(prompt).toContain("想下一幕");
    expect(prompt).toContain("当场付出什么代价");
  });

  it("builds manual-preview try_rewrite prompt", () => {
    const prompt = buildSelectionCoCreationPrompt({
      mode: "try_rewrite",
      chapterTitle: "第一章",
      intent: "删掉说破的那一句"
    });
    expect(prompt).toContain("试改此处");
    expect(prompt).toContain("强制手动差异预览");
    expect(prompt).toContain("删掉说破的那一句");
  });

  it("builds empty chapter card brainstorm prompts for ask_one and two_paths", () => {
    const askOne = buildEmptyCardBrainstormPrompt({
      chapterTitle: "第一章",
      spark: "我想写一个回自己家还得敲门的人",
      style: "ask_one"
    });
    expect(askOne).toContain("只问我 1 个最关键的人物关系或代价问题");
    expect(askOne).toContain("我想写一个回自己家还得敲门的人");

    const twoPaths = buildEmptyCardBrainstormPrompt({
      chapterTitle: "第一章",
      spark: "",
      style: "two_paths"
    });
    expect(twoPaths).toContain("2 条短走向");
    expect(twoPaths).toContain("不要修改章卡");
  });
});
