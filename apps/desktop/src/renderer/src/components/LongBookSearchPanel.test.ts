import { describe, expect, it } from "vitest";
import searchPanelSource from "./LongBookSearchPanel.vue?raw";
import editorSource from "./LongWorkspaceEditor.vue?raw";
import footerMetaSource from "./LongEditorFooterMeta.vue?raw";

describe("long-form whole-book search, jump-back, and save-state separation", () => {
  it("supports all cross-stage search scopes and calls window.writer.long.search", () => {
    expect(searchPanelSource).toContain('value: "all"');
    expect(searchPanelSource).toContain('value: "draft"');
    expect(searchPanelSource).toContain('value: "worldbuilding"');
    expect(searchPanelSource).toContain('value: "character_design"');
    expect(searchPanelSource).toContain('value: "plot_design"');
    expect(searchPanelSource).toContain('value: "continuity_ledger"');
    expect(searchPanelSource).toContain("api.search({");
    expect(searchPanelSource).toContain(
      'registerFeatureMessages("longBookSearch"'
    );
  });

  it("wires fixed whole-book search trigger, Ctrl+Shift+F, jump-back bar, and Alt+Left in LongWorkspaceEditor", () => {
    expect(editorSource).toContain("long-book-search-trigger");
    expect(editorSource).toContain("<LongBookSearchPanel");
    expect(editorSource).toContain("long-jump-back-bar");
    expect(editorSource).toContain("captureTextareaJumpAnchor");
    expect(editorSource).toContain("applyTextareaJumpAnchor");
    expect(editorSource).toContain("handleBookSearchGlobalKeydown");
    expect(editorSource).toContain(':save-state="currentSaveState"');
  });

  it("renders manuscript save state independently in LongEditorFooterMeta", () => {
    expect(footerMetaSource).toContain('saved: "已保存"');
    expect(footerMetaSource).toContain('saving: "保存中…"');
    expect(footerMetaSource).toContain('unsaved: "未保存"');
    expect(footerMetaSource).toContain("long-footer-save-state");
  });
});
