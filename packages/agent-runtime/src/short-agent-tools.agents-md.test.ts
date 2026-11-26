import type { AgentEvent } from "@earendil-works/pi-agent-core";
import { validateToolArguments } from "@earendil-works/pi-ai";
import {
  WRITING_CONTEXT_MAX_CHARACTERS,
  WRITING_CONTEXT_PATH,
  WorkspaceEditorMutationPayloadSchema,
  createShortWorkspaceContentRevision,
  type AgentRuntimeRef,
  type AgentWriteApprovalResult,
  type WritingFile,
  type WritingIndex
} from "@writer/contracts";
import { describe, expect, it } from "vitest";
import { toRuntimeEvents } from "./event-mapping";
import { renderWritingRules } from "./prompts-writing-rules";
import {
  buildScriptWorkspaceTools,
  buildShortWorkspaceTools,
  createScriptWorkspaceToolSharedState,
  createShortWorkspaceToolSharedState,
  type ShortWorkspaceToolSharedState
} from "./short-agent-tools";
import type { WritingReader } from "./short-agent-tools/core-reader";
import {
  replayWritingMutations,
  settleWritingMutations
} from "./short-agent-tools/settlement";
import {
  details,
  resultText,
  scriptProfile,
  scriptWorkspace,
  shortProfile,
  shortWorkspace,
  toolByName,
  type ShortWorkspaceFixtureOptions
} from "./short-agent-tools.test-support";

const RUNTIME_REF: AgentRuntimeRef = {
  provider: "openai-completions",
  model: "gpt-test",
  mode: "local-faux"
};

function buildHarness(
  workspaceType: "short" | "script",
  options: ShortWorkspaceFixtureOptions & {
    activeStageId?: "character_design" | "plot_design" | "draft";
    promptLocale?: "zh-CN" | "en-US";
    writeApprovalMode?: "request-approval" | "auto-approve";
    writingReader?: WritingReader;
    readSource?: "core";
  } = {}
) {
  const activeStageId = options.activeStageId ?? "plot_design";
  if (workspaceType === "short") {
    const workspace = {
      ...shortWorkspace(activeStageId, options),
      ...(options.readSource ? { readSource: options.readSource } : {})
    };
    const sharedState = createShortWorkspaceToolSharedState(workspace);
    const build = () =>
      buildShortWorkspaceTools({
        workspace,
        profile: shortProfile(),
        sharedState,
        ...(options.promptLocale ? { promptLocale: options.promptLocale } : {}),
        ...(options.writeApprovalMode
          ? { writeApprovalMode: options.writeApprovalMode }
          : {}),
        ...(options.writingReader
          ? { writingReader: options.writingReader }
          : {})
      });
    return { workspace, sharedState, tools: build(), build };
  }
  const workspace = {
    ...scriptWorkspace(activeStageId, options),
    ...(options.readSource ? { readSource: options.readSource } : {})
  };
  const sharedState = createScriptWorkspaceToolSharedState(workspace);
  const build = () =>
    buildScriptWorkspaceTools({
      workspace,
      profile: scriptProfile(),
      sharedState,
      ...(options.promptLocale ? { promptLocale: options.promptLocale } : {}),
      ...(options.writeApprovalMode
        ? { writeApprovalMode: options.writeApprovalMode }
        : {}),
      ...(options.writingReader ? { writingReader: options.writingReader } : {})
    });
  return { workspace, sharedState, tools: build(), build };
}

function createMockCoreReader(
  workspaceType: "short" | "script",
  initialAgentsMd: string,
  options: { forceTruncated?: boolean } = {}
) {
  let diskAgentsMd = initialAgentsMd;
  let forceTruncated = options.forceTruncated === true;
  const base = workspaceType === "short" ? shortWorkspace() : scriptWorkspace();
  const calls: Array<{
    mode: "index" | "file";
    id?: string;
    counts?: string;
    offset?: number;
    limit?: number;
  }> = [];

  const fileMetrics = (content: string) => ({
    revision: createShortWorkspaceContentRevision(content),
    length: content.length,
    characters: content.replace(/\s/gu, "").length
  });

  const buildIndex = (counts?: "workspace" | "draft"): WritingIndex => ({
    mode: "index",
    title: base.title,
    overview: { id: "character_design", title: "人物概览" },
    characterStructure: base.characterStructure,
    plotStages: base.plotStages,
    sections: base.expertDraft.sections.map((section) => ({
      id: section.id,
      title: section.title,
      wordCountRequirement: section.wordCountRequirement,
      body: { id: section.body.documentId, title: section.body.title },
      characterState: {
        id: section.characterState.documentId,
        title: section.characterState.title
      }
    })),
    createdSections: [],
    counts:
      counts === "workspace"
        ? [
            {
              id: "character_design",
              ...fileMetrics("人物概览。")
            },
            {
              id: WRITING_CONTEXT_PATH,
              ...fileMetrics(diskAgentsMd)
            }
          ]
        : []
  });

  const reader: WritingReader = {
    runId: `run-${workspaceType}-core`,
    async index(counts) {
      calls.push({ mode: "index", ...(counts ? { counts } : {}) });
      return buildIndex(counts);
    },
    async file(id, range) {
      calls.push({
        mode: "file",
        id,
        ...(range?.offset !== undefined ? { offset: range.offset } : {}),
        ...(range?.limit !== undefined ? { limit: range.limit } : {})
      });
      if (id !== WRITING_CONTEXT_PATH) {
        const text = id === "plot_design" ? "旧剧情的唯一片段。" : "人物概览。";
        const offset = range?.offset ?? 0;
        const sliced =
          range?.offset !== undefined || range?.limit !== undefined
            ? text.slice(offset, offset + (range.limit ?? 50_000))
            : text;
        return {
          mode: "file",
          id,
          ...fileMetrics(text),
          content: sliced
        };
      }
      const offset = range?.offset ?? 0;
      const sliced =
        range?.offset !== undefined || range?.limit !== undefined
          ? diskAgentsMd.slice(offset, offset + (range.limit ?? 50_000))
          : diskAgentsMd;
      const response: WritingFile = {
        mode: "file",
        id: WRITING_CONTEXT_PATH,
        ...fileMetrics(diskAgentsMd),
        ...(forceTruncated ? { truncated: true } : {}),
        content: sliced
      };
      return response;
    }
  };

  return {
    reader,
    calls,
    buildIndex,
    setDiskAgentsMd(next: string, nextTruncated = false) {
      diskAgentsMd = next;
      forceTruncated = nextTruncated;
    }
  };
}

describe.each(["short", "script"] as const)(
  "%s workspace kind=agents_md tools",
  (workspaceType) => {
    const expectedTitle =
      workspaceType === "script"
        ? "剧本上下文（AGENTS.md）"
        : "短篇上下文（AGENTS.md）";

    it("reads kind=agents_md with omitted or explicit id across every stage while requiring id for other kinds", async () => {
      const agentsMd = `# ${expectedTitle}\n\n## 作者手写禁令\n禁止机械旁白总结。`;
      for (const activeStageId of [
        "character_design",
        "plot_design",
        "draft"
      ] as const) {
        const { tools } = buildHarness(workspaceType, {
          activeStageId,
          agentsMd
        });
        const read = toolByName(tools, "read");

        const omittedArgs = validateToolArguments(read, {
          type: "toolCall",
          id: `read-omitted-${activeStageId}`,
          name: "read",
          arguments: { kind: "agents_md" }
        });
        const omittedText = resultText(
          await read.execute(`read-omitted-${activeStageId}`, omittedArgs)
        );
        expect(omittedText).toContain(`【${expectedTitle}】`);
        expect(omittedText).toContain("kind: agents_md");
        expect(omittedText).toContain("id: agents_md");
        expect(omittedText).toContain("禁止机械旁白总结。");

        for (const explicitId of ["agents_md", "AGENTS.md"] as const) {
          const explicitArgs = validateToolArguments(read, {
            type: "toolCall",
            id: `read-${explicitId}-${activeStageId}`,
            name: "read",
            arguments: { kind: "agents_md", id: explicitId }
          });
          const explicitText = resultText(
            await read.execute(
              `read-${explicitId}-${activeStageId}`,
              explicitArgs
            )
          );
          expect(explicitText).toContain(`【${expectedTitle}】`);
          expect(explicitText).toContain("id: agents_md");
          expect(explicitText).toContain("禁止机械旁白总结。");
        }
      }

      const { tools } = buildHarness(workspaceType, { agentsMd });
      const read = toolByName(tools, "read");
      expect(
        resultText(
          await read.execute("read-body-doc", {
            kind: "agents_md",
            document: "body"
          })
        )
      ).toContain("禁止机械旁白总结。");

      await expect(
        read.execute("read-wrong-id", { kind: "agents_md", id: "plot_design" })
      ).rejects.toThrow("agents_md");
      await expect(
        read.execute("read-state-doc", {
          kind: "agents_md",
          document: "state"
        })
      ).rejects.toThrow("不要传 document");
      await expect(
        read.execute("read-missing-other-id", { kind: "plot_stage" })
      ).rejects.toThrow("id 不能为空");
    });

    it("does not grant edit credentials on partial slice reads and refuses truncated snapshots", async () => {
      const agentsMd =
        "# 上下文\n\n第一段：保持冷峻克制。\n第二段：结尾留悬念钩子。";
      const { tools } = buildHarness(workspaceType, { agentsMd });
      const read = toolByName(tools, "read");
      const edit = toolByName(tools, "edit");

      const sliceText = resultText(
        await read.execute("read-slice", {
          kind: "agents_md",
          offset: 0,
          limit: 10
        })
      );
      expect(sliceText).toContain("分段读取不授予全文覆盖权限");

      const blockedAfterSlice = await edit.execute("edit-after-slice", {
        kind: "agents_md",
        replacements: [
          { original_text: "保持冷峻克制", new_text: "保持快节奏强钩子" }
        ]
      });
      expect(resultText(blockedAfterSlice)).toContain("请先用 read 完整读取");
      expect(details(blockedAfterSlice)).toEqual({ kind: "none" });

      const truncatedHarness = buildHarness(workspaceType, {
        agentsMd,
        agentsMdTruncated: true
      });
      const truncatedRead = resultText(
        await toolByName(truncatedHarness.tools, "read").execute(
          "read-truncated",
          { kind: "agents_md" }
        )
      );
      expect(truncatedRead).toContain("快照已截断");
      await expect(
        toolByName(truncatedHarness.tools, "edit").execute("edit-truncated", {
          kind: "agents_md",
          replacements: [
            { original_text: "保持冷峻克制", new_text: "保持快节奏" }
          ]
        })
      ).rejects.toThrow("快照已截断");
    });

    it("enforces full-read & overwrite guards, supports surgical/full edits, chains same-run overlays, and rejects meta/state", async () => {
      const initial = "# 创作上下文\n\n## 文风禁令\n严禁解释性旁白。";
      const { tools, sharedState, build } = buildHarness(workspaceType, {
        activeStageId: "draft",
        agentsMd: initial
      });
      const read = toolByName(tools, "read");
      const edit = toolByName(tools, "edit");

      await expect(
        edit.execute("reject-meta", {
          kind: "agents_md",
          meta: { title: "不能改标题" }
        })
      ).rejects.toThrow("不支持 meta");
      await expect(
        edit.execute("reject-state-doc", {
          kind: "agents_md",
          document: "character_state",
          content: "无效"
        })
      ).rejects.toThrow("不要传 document");

      const unreadAttempt = await edit.execute("unread-edit", {
        kind: "agents_md",
        append: "\n## 新增约束\n衔接既有设定。"
      });
      expect(resultText(unreadAttempt)).toContain("请先用 read 完整读取");
      expect(details(unreadAttempt)).toEqual({ kind: "none" });

      await read.execute("full-read", { kind: "agents_md" });

      const missingOverwrite = await edit.execute("missing-overwrite", {
        kind: "agents_md",
        content: "试图直接覆盖"
      });
      expect(resultText(missingOverwrite)).toContain(
        "overwrite_mode=replace_all"
      );
      expect(details(missingOverwrite)).toEqual({ kind: "none" });

      const replaceArgs = validateToolArguments(edit, {
        type: "toolCall",
        id: "edit-replace",
        name: "edit",
        arguments: {
          kind: "agents_md",
          replacements: [
            {
              original_text: "严禁解释性旁白。",
              new_text: "严禁解释性旁白；保留作者冷峻短句。"
            }
          ],
          summary: "补充短句约束"
        }
      });
      const first = await edit.execute("edit-replace", replaceArgs);
      const afterFirst =
        "# 创作上下文\n\n## 文风禁令\n严禁解释性旁白；保留作者冷峻短句。";
      expect(details(first)).toEqual({
        kind: "workspace-agents-md-mutation",
        workspaceId:
          workspaceType === "script" ? "script-tool-test" : "short-tool-test",
        workspaceType,
        beforeText: initial,
        text: afterFirst,
        baseRevision: createShortWorkspaceContentRevision(initial),
        summary: "补充短句约束"
      });

      const second = await edit.execute("edit-insert", {
        id: "agents_md",
        insert: {
          anchor: "## 文风禁令",
          position: "before",
          text: "## 平滑变轨约定\n前文一字不动，新流派从下一节自然切入。\n\n"
        },
        summary: "插入平滑变轨约定"
      });
      const afterSecond =
        "# 创作上下文\n\n## 平滑变轨约定\n前文一字不动，新流派从下一节自然切入。\n\n## 文风禁令\n严禁解释性旁白；保留作者冷峻短句。";
      expect(details(second)).toMatchObject({
        kind: "workspace-agents-md-mutation",
        workspaceType,
        beforeText: afterFirst,
        text: afterSecond,
        baseRevision: createShortWorkspaceContentRevision(afterFirst),
        summary: "插入平滑变轨约定"
      });

      const third = await edit.execute("edit-append", {
        id: "AGENTS.md",
        append: "\n\n## 节奏衔接\n末尾保留悬念钩子。",
        summary: "追加节奏衔接"
      });
      const afterThird = `${afterSecond}\n\n## 节奏衔接\n末尾保留悬念钩子。`;
      expect(details(third)).toMatchObject({
        kind: "workspace-agents-md-mutation",
        beforeText: afterSecond,
        text: afterThird,
        baseRevision: createShortWorkspaceContentRevision(afterSecond)
      });

      const fourth = await edit.execute("edit-full-replace", {
        kind: "agents_md",
        content: "# 重整后的上下文\n\n保留核心禁令。",
        overwrite_mode: "replace_all",
        summary: "整篇整理上下文"
      });
      expect(details(fourth)).toMatchObject({
        kind: "workspace-agents-md-mutation",
        beforeText: afterThird,
        text: "# 重整后的上下文\n\n保留核心禁令。",
        baseRevision: createShortWorkspaceContentRevision(afterThird)
      });
      expect(sharedState.agentsMd.content).toBe(
        "# 重整后的上下文\n\n保留核心禁令。"
      );

      const childTools = build();
      expect(
        resultText(
          await toolByName(childTools, "edit").execute("child-unread", {
            kind: "agents_md",
            append: "\n子智能体未读直接改"
          })
        )
      ).toContain("请先用 read 完整读取");

      const blankHarness = buildHarness(workspaceType, { agentsMd: "" });
      const blankWrite = await toolByName(blankHarness.tools, "edit").execute(
        "write-blank",
        {
          kind: "agents_md",
          content: "# 新建上下文\n\n首版规则。",
          summary: "初始化上下文"
        }
      );
      expect(details(blankWrite)).toMatchObject({
        kind: "workspace-agents-md-mutation",
        beforeText: "",
        text: "# 新建上下文\n\n首版规则。"
      });
    });

    it("enforces the 10,000 Unicode code-point limit including astral characters without mutating state", async () => {
      const initial = "# 初始上下文";
      const { tools, sharedState } = buildHarness(workspaceType, {
        agentsMd: initial
      });
      await toolByName(tools, "read").execute("read-initial", {
        kind: "agents_md"
      });
      const edit = toolByName(tools, "edit");
      const initialRevision = sharedState.agentsMd.revision;

      const overBmp = "界".repeat(WRITING_CONTEXT_MAX_CHARACTERS + 1);
      const bmpRejected = await edit.execute("over-bmp", {
        kind: "agents_md",
        content: overBmp,
        overwrite_mode: "replace_all"
      });
      expect(resultText(bmpRejected)).toBe(
        `未修改：作品上下文（AGENTS.md）不能超过 ${WRITING_CONTEXT_MAX_CHARACTERS} 个字符（当前 ${WRITING_CONTEXT_MAX_CHARACTERS + 1} 个字符），请精简后重试。`
      );
      expect(details(bmpRejected)).toEqual({ kind: "none" });
      expect(sharedState.agentsMd).toEqual({
        content: initial,
        revision: initialRevision
      });

      const overAstral = "🚀".repeat(WRITING_CONTEXT_MAX_CHARACTERS + 1);
      const astralRejected = await edit.execute("over-astral", {
        kind: "agents_md",
        content: overAstral,
        overwrite_mode: "replace_all"
      });
      expect(resultText(astralRejected)).toBe(
        `未修改：作品上下文（AGENTS.md）不能超过 ${WRITING_CONTEXT_MAX_CHARACTERS} 个字符（当前 ${WRITING_CONTEXT_MAX_CHARACTERS + 1} 个字符），请精简后重试。`
      );
      expect(details(astralRejected)).toEqual({ kind: "none" });
      expect(sharedState.agentsMd.content).toBe(initial);

      const exactAstral = "🚀".repeat(WRITING_CONTEXT_MAX_CHARACTERS);
      expect(exactAstral.length).toBe(WRITING_CONTEXT_MAX_CHARACTERS * 2);
      const astralAccepted = await edit.execute("exact-astral", {
        kind: "agents_md",
        content: exactAstral,
        overwrite_mode: "replace_all",
        summary: "写入恰好一万码点"
      });
      expect(details(astralAccepted)).toMatchObject({
        kind: "workspace-agents-md-mutation",
        beforeText: initial,
        text: exactAstral
      });
      expect(sharedState.agentsMd.content).toBe(exactAstral);
    });

    it("reconciles accepted, user-edited, rejected, and truncated-edited settlements", async () => {
      const initial = "# 原版上下文\n\n保留第一条约定。";
      const h = buildHarness(workspaceType, {
        agentsMd: initial,
        writeApprovalMode: "request-approval"
      });
      const read = toolByName(h.tools, "read");
      const edit = toolByName(h.tools, "edit");
      const settle = (
        id: string,
        result: Partial<AgentWriteApprovalResult>
      ) => {
        settleWritingMutations(h.sharedState, [id], {
          items: [
            {
              title: expectedTitle,
              status: "saved",
              toolCallIds: [id],
              ...result
            }
          ]
        });
      };

      await read.execute("read-1", { kind: "agents_md" });
      await edit.execute("rejected-call", {
        kind: "agents_md",
        content: "# 被拒绝的改动",
        overwrite_mode: "replace_all"
      });
      settle("rejected-call", { status: "rejected" });
      expect(h.sharedState.agentsMd).toEqual({
        content: initial,
        revision: createShortWorkspaceContentRevision(initial)
      });
      expect(
        resultText(
          await read.execute("read-after-reject", { kind: "agents_md" })
        )
      ).toContain("保留第一条约定。");

      await edit.execute("accepted-call", {
        kind: "agents_md",
        append: "\n保留第二条约定。"
      });
      settle("accepted-call", { status: "saved" });
      const acceptedText = `${initial}\n保留第二条约定。`;
      expect(h.sharedState.agentsMd.content).toBe(acceptedText);

      await edit.execute("edited-call", {
        kind: "agents_md",
        append: "\n智能体拟稿第三条。"
      });
      const authorSaved = `${acceptedText}\n作者手改确认的第三条。`;
      settle("edited-call", {
        status: "saved",
        edited: true,
        editedText: authorSaved
      });
      expect(h.sharedState.agentsMd).toEqual({
        content: authorSaved,
        revision: createShortWorkspaceContentRevision(authorSaved)
      });

      const blockedWithoutFreshRead = await edit.execute("stale-edit", {
        kind: "agents_md",
        append: "\n未重读直接追加"
      });
      expect(resultText(blockedWithoutFreshRead)).toContain("请先用 read");
      expect(details(blockedWithoutFreshRead)).toEqual({ kind: "none" });

      expect(
        resultText(await read.execute("fresh-read", { kind: "agents_md" }))
      ).toContain("作者手改确认的第三条。");
      const afterFreshRead = await edit.execute("next-edit", {
        kind: "agents_md",
        append: "\n第四条衔接。"
      });
      expect(details(afterFreshRead)).toMatchObject({
        kind: "workspace-agents-md-mutation",
        beforeText: authorSaved,
        baseRevision: createShortWorkspaceContentRevision(authorSaved)
      });

      settle("next-edit", {
        status: "saved",
        edited: true,
        editedText: "截断片段",
        editedTextTruncated: true
      });
      await expect(
        read.execute("read-unavailable", { kind: "agents_md" })
      ).rejects.toThrow("完整保存版本");
      await expect(
        edit.execute("edit-unavailable", {
          kind: "agents_md",
          content: "覆盖",
          overwrite_mode: "replace_all"
        })
      ).rejects.toThrow("完整保存版本");
    });

    it("reads live AGENTS.md from Core writingReader, tracks coreFiles, replays uncommitted mutations, and drops stale ones", async () => {
      const liveDefault =
        "# 网文定位上下文\n\n- 叙事风向：强钩子快节奏\n- 手写禁令：不许强行降智";
      const mockCore = createMockCoreReader(workspaceType, liveDefault);
      const h = buildHarness(workspaceType, {
        readSource: "core",
        writingReader: mockCore.reader,
        writeApprovalMode: "request-approval"
      });
      const read = toolByName(h.tools, "read");
      const edit = toolByName(h.tools, "edit");

      const loadedText = resultText(
        await read.execute("core-read", { kind: "agents_md" })
      );
      expect(loadedText).toContain("不许强行降智");
      expect(h.sharedState.coreFiles?.get(WRITING_CONTEXT_PATH)).toMatchObject({
        content: liveDefault,
        revision: createShortWorkspaceContentRevision(liveDefault),
        length: liveDefault.length,
        truncated: false
      });

      const firstProposal = await edit.execute("core-edit-1", {
        kind: "agents_md",
        append: "\n- 平滑变轨：下一节引入悬疑副线",
        summary: "补充副线变轨"
      });
      const overlaid = `${liveDefault}\n- 平滑变轨：下一节引入悬疑副线`;
      expect(details(firstProposal)).toMatchObject({
        kind: "workspace-agents-md-mutation",
        beforeText: liveDefault,
        text: overlaid,
        baseRevision: createShortWorkspaceContentRevision(liveDefault)
      });

      await read.execute("core-read-workspace", {
        kind: "workspace",
        id: "workspace"
      });
      expect(
        resultText(
          await read.execute("core-read-overlay", { kind: "agents_md" })
        )
      ).toContain("平滑变轨：下一节引入悬疑副线");

      const secondProposal = await edit.execute("core-edit-2", {
        kind: "agents_md",
        append: "\n- 钩子要求：章末留未解物证",
        summary: "继续补充钩子要求"
      });
      expect(details(secondProposal)).toMatchObject({
        kind: "workspace-agents-md-mutation",
        beforeText: overlaid,
        baseRevision: createShortWorkspaceContentRevision(overlaid)
      });

      const diskUpdated = "# 作者在编辑器另行保存的新上下文";
      mockCore.setDiskAgentsMd(diskUpdated);
      const refreshedText = resultText(
        await read.execute("core-read-after-disk-change", {
          kind: "agents_md"
        })
      );
      expect(refreshedText).toContain("作者在编辑器另行保存的新上下文");
      expect(refreshedText).not.toContain("平滑变轨：下一节引入悬疑副线");

      const baseState: ShortWorkspaceToolSharedState =
        workspaceType === "short"
          ? createShortWorkspaceToolSharedState(
              shortWorkspace("plot_design", { agentsMd: diskUpdated })
            )
          : createScriptWorkspaceToolSharedState(
              scriptWorkspace("plot_design", { agentsMd: diskUpdated })
            );
      replayWritingMutations(
        h.sharedState,
        baseState,
        mockCore.buildIndex("workspace")
      );
      expect(h.sharedState.agentsMd.content).toBe(diskUpdated);

      mockCore.setDiskAgentsMd(
        "超".repeat(WRITING_CONTEXT_MAX_CHARACTERS),
        true
      );
      const truncatedCoreRead = resultText(
        await read.execute("core-read-truncated", { kind: "agents_md" })
      );
      expect(truncatedCoreRead).toContain("快照已截断");
      expect(
        h.sharedState.coreFiles?.get(WRITING_CONTEXT_PATH)?.truncated
      ).toBe(true);
      await expect(
        edit.execute("core-edit-truncated", {
          kind: "agents_md",
          append: "\n禁止修改截断文件"
        })
      ).rejects.toThrow("快照已截断");
    });

    it("returns recovery guidance from delete instead of deleting AGENTS.md", async () => {
      const initial = "# 保留上下文";
      const { tools, sharedState } = buildHarness(workspaceType, {
        agentsMd: initial
      });
      const remove = toolByName(tools, "delete");
      const validated = validateToolArguments(remove, {
        type: "toolCall",
        id: "delete-agents-md",
        name: "delete",
        arguments: { kind: "agents_md" }
      });
      const refused = await remove.execute("delete-agents-md", validated);
      expect(resultText(refused)).toContain("未修改");
      expect(resultText(refused)).toContain("请用 edit");
      expect(resultText(refused)).toContain('content=""');
      expect(resultText(refused)).toContain("overwrite_mode=replace_all");
      expect(details(refused)).toEqual({ kind: "none" });
      expect(sharedState.agentsMd.content).toBe(initial);

      const enHarness = buildHarness(workspaceType, {
        agentsMd: initial,
        promptLocale: "en-US"
      });
      const enRefused = await toolByName(enHarness.tools, "delete").execute(
        "delete-agents-md-en",
        { kind: "agents_md", id: "agents_md" }
      );
      expect(resultText(enRefused)).toContain("Not changed");
      expect(resultText(enRefused)).toContain('content=""');
      expect(details(enRefused)).toEqual({ kind: "none" });
    });

    it("maps workspace-agents-md-mutation details to a valid workspace.editor_mutation runtime event", async () => {
      const beforeText = "# 旧上下文";
      const afterText = "# 旧上下文\n\n新增平滑过渡说明。";
      const { tools } = buildHarness(workspaceType, { agentsMd: beforeText });
      await toolByName(tools, "read").execute("read-before-map", {
        kind: "agents_md"
      });
      const toolResult = await toolByName(tools, "edit").execute(
        "call-agents-md",
        {
          kind: "agents_md",
          append: "\n\n新增平滑过渡说明。",
          summary: "更新作品上下文"
        }
      );

      const agentEvent: AgentEvent = {
        type: "tool_execution_end",
        toolCallId: "call-agents-md",
        toolName: "edit",
        result: toolResult,
        isError: false
      };
      const mapped = toRuntimeEvents(
        agentEvent,
        { runId: "run_1", sessionId: "session_1" },
        RUNTIME_REF,
        "msg_1"
      );
      const mutationEvent = mapped.find(
        (event) => event.type === "workspace.editor_mutation"
      );
      expect(mutationEvent).toBeDefined();
      expect(mutationEvent?.payload).toEqual({
        toolCallId: "call-agents-md",
        workspaceId:
          workspaceType === "script" ? "script-tool-test" : "short-tool-test",
        stageId: "agents_md",
        text: afterText,
        mutationTarget: {
          kind: "agents-md",
          workspaceType,
          beforeText,
          afterText,
          expectedRevision: createShortWorkspaceContentRevision(beforeText)
        },
        baseRevision: createShortWorkspaceContentRevision(beforeText),
        summary: "更新作品上下文",
        runtime: RUNTIME_REF
      });

      const parsed = WorkspaceEditorMutationPayloadSchema.parse({
        sessionId: mutationEvent!.sessionId,
        runId: mutationEvent!.runId,
        ...mutationEvent!.payload
      });
      expect(parsed.stageId).toBe("agents_md");
      expect(parsed.mutationTarget?.kind).toBe("agents-md");
    });

    it("renders localized kind=agents_md addressing, 10,000-char limit, and smooth-transition rules with zero CJK in en-US", () => {
      const zhRules = renderWritingRules(
        { workspaceType, characterFormat: "text" },
        "zh-CN"
      );
      expect(zhRules).toContain('kind="agents_md"');
      expect(zhRules).toContain("10000 字符");
      expect(zhRules).toContain("【作品定位调整与中途平滑变轨规则】");
      expect(zhRules).toContain("绝不吃书");
      expect(zhRules).toContain('read(kind="agents_md")');
      expect(zhRules).toContain('edit(kind="agents_md")');
      expect(zhRules).toContain(
        workspaceType === "script"
          ? "下一集的过渡钩子建议"
          : "下一小节的过渡钩子建议"
      );

      const enRules = renderWritingRules(
        { workspaceType, characterFormat: "list" },
        "en-US"
      );
      expect(enRules).toContain('kind="agents_md"');
      expect(enRules).toContain("10,000-character limit");
      expect(enRules).toContain(
        "[Positioning changes and smooth mid-work transitions]"
      );
      expect(enRules).toContain('read(kind="agents_md")');
      expect(enRules).toContain('edit(kind="agents_md")');
      expect(enRules).toContain(
        workspaceType === "script"
          ? "transition hooks for the next episode"
          : "transition hooks for the next section"
      );
      expect(enRules).not.toMatch(/[㐀-鿿]/u);
    });
  }
);
