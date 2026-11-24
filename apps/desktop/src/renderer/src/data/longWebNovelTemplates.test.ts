import { describe, expect, it } from "vitest";
import {
  LONG_CHAPTER_TARGET_PRESETS,
  nextChapterTargetPreset,
  resolveLongCraftScaffold
} from "./longWebNovelTemplates";

describe("long-form web-novel chapter targets and craft scaffolds", () => {
  it("cycles chapter target presets across standard web-novel word lines", () => {
    expect(LONG_CHAPTER_TARGET_PRESETS).toEqual([2000, 3000, 4000]);
    expect(nextChapterTargetPreset(2000)).toBe(3000);
    expect(nextChapterTargetPreset(3000)).toBe(4000);
    expect(nextChapterTargetPreset(4000)).toBe(2000);
  });

  it("provides structured Markdown scaffolds for book line, worldbuilding, character, and chapter cards", () => {
    const bookLine = resolveLongCraftScaffold("bookLine");
    expect(bookLine.markdown).toContain("金手指");

    const world = resolveLongCraftScaffold("worldbuilding");
    expect(world.markdown).toContain("防崩坏");

    const character = resolveLongCraftScaffold("character");
    expect(character.markdown).toContain("防 OOC");

    const card = resolveLongCraftScaffold("chapterCard");
    expect(card.markdown).toContain("情绪曲线四拍");
  });
});
