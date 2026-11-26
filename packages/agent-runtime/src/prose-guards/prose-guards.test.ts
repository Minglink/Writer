import { describe, expect, it } from "vitest";
import {
  canonicalizeMeasureToken,
  checkBodyWriteHardBlocks,
  checkReplacementConservation,
  compileAndGuardHandoff,
  extractPovGuardLinesFromCard,
  extractProtectedMeasures,
  lintProseBody,
  verifyPureBareSandboxInput
} from "./index";
import {
  documentExecutor,
  fixtureIndex,
  longChapterBodyFileId,
  longChapterCardFileId,
  longTools,
  resultText
} from "../long-agent-tools.test-support";
import { buildShortWorkspaceTools } from "../short-agent-tools";
import {
  expertSection,
  shortProfile,
  shortWorkspace
} from "../short-agent-tools.test-support";
import { assembleLongChapterEvidence } from "../long-chapter-evidence-assembler";
import {
  createSyntheticLongBook,
  createSyntheticLongCommandExecutor,
  createSyntheticLongProfile,
  createSyntheticRuntimeContext
} from "../long-memory-eval/synthetic-book";

describe("prose hard-gate linter", () => {
  it("produces zero false positives on valid Chinese attributives and idioms", () => {
    const clean = [
      "走廊尽头露出一张苍白的人脸，窗外是静静的河水。",
      "站在门口铁青的他没有说话，盘子里红的很少。",
      "这一局对方毫无作为，反而把底牌先亮了出来。"
    ].join("\n\n");
    const report = lintProseBody(clean);
    expect(report.hardBlocks).toEqual([]);
    expect(report.softNotices).toEqual([]);
  });

  it("catches genuine 的/地/得 misuse, AI clichés, and high em-dash density as soft notices", () => {
    const noisy = [
      "他眼中闪过一丝冷意，心里一沉，空气仿佛凝固。",
      "她疼的厉害，慢慢的走过来，猛的抬头。",
      "走廊里很安静——灯管闪了一下——远处传来脚步声——门锁咔哒响了一声——".repeat(
        10
      )
    ].join("\n\n");
    const report = lintProseBody(noisy);
    expect(report.hardBlocks).toEqual([]);
    const kinds = report.softNotices.map((n) => n.kind);
    expect(kinds).toContain("ai_slop");
    expect(kinds).toContain("de_typo");
    expect(kinds).toContain("em_dash_density");
  });

  it("hard-blocks unbalanced single-paragraph Chinese quotes and meta leaks", () => {
    const bad = "“把账本放下，林默说。\n\n字数统计：2100字";
    const blocks = checkBodyWriteHardBlocks("", bad, false);
    expect(blocks.map((b) => b.kind)).toEqual([
      "unbalanced_quotes",
      "meta_leak"
    ]);
  });

  it("relaxes consecutive '我' paragraph openings in first-person POV mode", () => {
    const fourWo = [
      "我推开铁门。",
      "我摸了摸口袋。",
      "我听见楼上脚步声。",
      "我退回阴影里。"
    ].join("\n\n");
    expect(
      lintProseBody(fourWo, { firstPersonPov: false }).softNotices.some(
        (n) => n.kind === "same_lead_run"
      )
    ).toBe(true);
    expect(
      lintProseBody(fourWo, { firstPersonPov: true }).softNotices.some(
        (n) => n.kind === "same_lead_run"
      )
    ).toBe(false);
  });
});

describe("patch numeric and quantifier conservation guard", () => {
  it("exempts numeric idioms, reduplicated classifiers, figurative phrases, and room codes B1/B2", () => {
    const text =
      "千钧一发之际，他一步步退进B1和B2之间的通道，四周一片漆黑，他深吸一口气，一把抓住扶手，一石二鸟，半斤八两。";
    expect(extractProtectedMeasures(text)).toEqual([]);
  });

  it("normalizes Arabic/Chinese clocks, compound durations, negative temps, and cross-genre currencies", () => {
    expect(canonicalizeMeasureToken("22:35")).toBe("TIME:22:35");
    expect(canonicalizeMeasureToken("二十二点三十五分")).toBe("TIME:22:35");
    expect(canonicalizeMeasureToken("十一点半")).toBe("TIME:11:30");
    expect(canonicalizeMeasureToken("一小时五十五分")).toBe("DUR:115m");
    expect(canonicalizeMeasureToken("1小时55分")).toBe("DUR:115m");
    expect(canonicalizeMeasureToken("半个时辰")).toBe("DUR:60m");
    expect(canonicalizeMeasureToken("60分钟")).toBe("DUR:60m");
    expect(canonicalizeMeasureToken("零下三十度")).toBe("-30度");
    expect(canonicalizeMeasureToken("-30℃")).toBe("-30度");
    expect(canonicalizeMeasureToken("五十两银子")).toBe("50两");
    expect(canonicalizeMeasureToken("三亿两千万灵石")).toBe("320000000灵石");
    expect(canonicalizeMeasureToken("百分之五")).toBe("5%");
    expect(canonicalizeMeasureToken("零八二四")).toBe("CODE:0824");
  });

  it("passes equivalent notation rewrites and blocks silent anchor deletion", () => {
    const equivalent = checkReplacementConservation({
      original_text:
        "表盘停在22:35，室外零下三十度，包里还剩五十两银子和三亿两千万灵石。",
      new_text:
        "表盘停在二十二点三十五分，室外-30℃，包里还剩50两和320000000灵石。"
    });
    expect(equivalent.ok).toBe(true);

    const dropped = checkReplacementConservation({
      original_text: "他眼中闪过一丝冷意，表盘停在22:35，电量只剩5%。",
      new_text: "他垂下眼皮，表盘停在22:35。"
    });
    expect(dropped.ok).toBe(false);
    if (!dropped.ok) {
      expect(dropped.reason).toBe("numeric_conservation_violation");
      expect(dropped.missingMeasures).toEqual(["5%"]);
    }
  });

  it("allows single-family numeric edits under allow_numeric_change while blocking collateral family wipeout", () => {
    const sameFamily = checkReplacementConservation({
      original_text: "电量只剩5%。",
      new_text: "电量只剩4%。",
      allow_numeric_change: true
    });
    expect(sameFamily.ok).toBe(true);

    const collateralWipe = checkReplacementConservation({
      original_text: "表盘停在22:35，电量只剩5%。",
      new_text: "电量只剩4%。",
      allow_numeric_change: true
    });
    expect(collateralWipe.ok).toBe(false);
    if (!collateralWipe.ok) {
      expect(collateralWipe.reason).toBe("collateral_measure_deletion");
      expect(collateralWipe.wipedUnitFamilies).toEqual(["TIME"]);
    }

    const explicitAllow = checkReplacementConservation({
      original_text: "表盘停在22:35，电量只剩5%。",
      new_text: "电量只剩4%。",
      allow_numeric_change: true,
      allowed_removed_measures: ["22:35"]
    });
    expect(explicitAllow.ok).toBe(true);
  });
});

describe("handoff and POV sandbox guards", () => {
  it("extracts native POV guard lines and scrubs pure-bare sandbox leaks longest-first", () => {
    const card = [
      "## 写作上下文",
      "- 视角：陈屿（第三人称有限视角）",
      "- 禁止透露：应急罗盘、罗盘、地下密室密码",
      "- 不能写破：周明远早已调包账本",
      "- 知情边界：仅知晓前院失火"
    ].join("\n");
    const extracted = extractPovGuardLinesFromCard(card);
    expect(extracted.hasPovGuard).toBe(true);
    expect(extracted.guardLines).toHaveLength(4);
    expect(extracted.derivedSecretPhrases).toContain("应急罗盘");

    const audit = verifyPureBareSandboxInput(
      "对手怀疑主角藏了应急罗盘和地下密室密码。",
      extracted.derivedSecretPhrases
    );
    expect(audit.clean).toBe(false);
    expect(audit.sanitizedInput).not.toContain("应急罗盘");
    expect(audit.sanitizedInput).not.toContain("地下密室密码");
  });

  it("compiles inverted-pyramid handoff within <=1,000 chars while preserving mandatory auditor hazards", () => {
    const res = compileAndGuardHandoff(
      {
        chapterNum: 12,
        immediateAnchor: [
          "时间：22:35，地点：B1 阀门间，陈屿手按铁门尚未推开。"
        ],
        hardLedger: Array.from(
          { length: 14 },
          (_, i) =>
            `物资条目${i + 1}：详细记录说明文字用于测试超长裁剪行为与账本保留逻辑。`
        ),
        mustResolve: Array.from(
          { length: 10 },
          (_, i) => `普通待办${i + 1}：下章可顺手交代的次要细节。`
        )
      },
      ["第11章提到的人质王伯必须在本章给出明确下落，严禁悬空。"],
      1_000
    );
    expect(res.withinBudget).toBe(true);
    expect(res.writer1200Safe).toBe(true);
    expect(res.charCount).toBeLessThanOrEqual(1_000);
    expect(res.injectedHazardCount).toBe(1);
    expect(res.handoffMarkdown).toContain("[审稿必圆锁]");
    expect(res.handoffMarkdown).toContain("人质王伯");
  });
});

describe("long and short edit tool body guard integration", () => {
  it("blocks numeric loss and unbalanced quotes on long chapter body while leaving chapter card unblocked", async () => {
    const tools = longTools({
      activeRoot: "draft",
      activeChapterCardId: "chapter_one",
      executor: documentExecutor(fixtureIndex(), {
        [longChapterBodyFileId("chapter_one")]:
          "他眼中闪过一丝冷意，表盘停在22:35，水壶里还剩500ml。",
        [longChapterCardFileId("chapter_one")]: "初始章卡。"
      })
    });
    const read = tools.find((t) => t.name === "read")!;
    const edit = tools.find((t) => t.name === "edit")!;

    await read.execute("read-body", { id: "chapter_one", document: "body" });

    const blockedConservation = resultText(
      await edit.execute("edit-drop-num", {
        id: "chapter_one",
        document: "body",
        replacements: [
          {
            original_text:
              "他眼中闪过一丝冷意，表盘停在22:35，水壶里还剩500ml。",
            new_text: "他垂下眼皮，表盘停在22:35。"
          }
        ]
      })
    );
    expect(blockedConservation).toContain("守恒锁");
    expect(blockedConservation).toContain("500ml");

    const blockedQuote = resultText(
      await edit.execute("edit-bad-quote", {
        id: "chapter_one",
        document: "body",
        replacements: [
          {
            original_text:
              "他眼中闪过一丝冷意，表盘停在22:35，水壶里还剩500ml。",
            new_text: "“走吧，表盘停在二十二点三十五分，水壶还剩500毫升。"
          }
        ]
      })
    );
    expect(blockedQuote).toContain("未在单自然段内成对闭合");

    const okBody = resultText(
      await edit.execute("edit-ok-body", {
        id: "chapter_one",
        document: "body",
        replacements: [
          {
            original_text:
              "他眼中闪过一丝冷意，表盘停在22:35，水壶里还剩500ml。",
            new_text: "他垂下眼皮，表盘停在二十二点三十五分，水壶还剩500毫升。"
          }
        ]
      })
    );
    expect(okBody).toContain("已形成");

    // Non-body document (card) must NOT be blocked by body conservation/quote locks
    await read.execute("read-card", { id: "chapter_one", document: "card" });
    const cardEdit = resultText(
      await edit.execute("edit-card", {
        id: "chapter_one",
        document: "card",
        content: "## 写作上下文\n- 视角：陈屿\n- 禁止透露：地下密室密码",
        overwrite_mode: "replace_all"
      })
    );
    expect(cardEdit).toContain("已形成");
  });

  it("enforces conservation lock on short draft_section body while ignoring state document", async () => {
    const ws = shortWorkspace("draft");
    ws.expertDraft.sections = [
      expertSection(
        "section-1",
        "第一节",
        "门禁锁死在22:35，他口袋里还有50两银子。",
        "时间：22:35，银子：50两。"
      )
    ];
    const tools = buildShortWorkspaceTools({
      workspace: ws,
      profile: shortProfile()
    });
    const read = tools.find((t) => t.name === "read")!;
    const edit = tools.find((t) => t.name === "edit")!;

    await read.execute("short-read-body", {
      kind: "draft_section",
      id: "section-1",
      document: "body"
    });
    const blocked = resultText(
      await edit.execute("short-edit-drop", {
        kind: "draft_section",
        id: "section-1",
        document: "body",
        replacements: [
          {
            original_text: "门禁锁死在22:35，他口袋里还有50两银子。",
            new_text: "门禁锁死在22:35。"
          }
        ]
      })
    );
    expect(blocked).toContain("守恒锁");
    expect(blocked).toContain("50两银子");

    await read.execute("short-read-state", {
      kind: "draft_section",
      id: "section-1",
      document: "state"
    });
    const stateEdit = resultText(
      await edit.execute("short-edit-state", {
        kind: "draft_section",
        id: "section-1",
        document: "state",
        replacements: [
          {
            original_text: "时间：22:35，银子：50两。",
            new_text: "时间：22:35，银子已结清。"
          }
        ]
      })
    );
    expect(stateEdit).not.toContain("守恒锁");
  });

  it("emits a truncation warning gap when checkpoint handoff exceeds HANDOFF_MAX_CHARS (1,200)", async () => {
    const book = createSyntheticLongBook();
    const ch17 = book.index.chapters.find(
      (c) => c.chapterCardId === "chapter_17"
    )!;
    const existing = book.files.get(ch17.handoff.id);
    if (existing) {
      book.files.set(ch17.handoff.id, {
        ...existing,
        content: `${existing.content}\n${"冗长前情流水账。".repeat(200)}`
      });
    }
    const profile = createSyntheticLongProfile();
    const executor = createSyntheticLongCommandExecutor(book);
    const assembled = await assembleLongChapterEvidence({
      runId: "run_handoff_warn",
      sessionId: "session_handoff_warn",
      prompt: "开始起稿第19章",
      thinkingLevel: "off",
      longAgentProfile: profile,
      longCommandExecutor: executor,
      workspaceContext: {
        longWorkspace: createSyntheticRuntimeContext(book, {
          activeRoot: "draft",
          activeChapterCardId: "chapter_19",
          profile
        })
      }
    });
    expect(assembled?.kind).toBe("evidence");
    expect(
      assembled?.gaps.some((gap) => gap.includes("超过 1200 字自动取证上限"))
    ).toBe(true);
  });
});
