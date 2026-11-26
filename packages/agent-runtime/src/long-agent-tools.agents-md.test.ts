import { validateToolArguments, type JsonObject } from "@earendil-works/pi-ai";
import {
  LONG_AGENTS_MD_MAX_CHARACTERS,
  LongMutationProposalPayloadSchema,
  createShortWorkspaceContentRevision,
  type LongAgentProfile,
  type LongWorkspaceRoot
} from "@writer/contracts";
import { createLongWorkspaceToolSharedState } from "./long-agent-tools";
import {
  buildLongWorkspaceTools,
  createLongWorkspaceNavigationSnapshot,
  describe,
  documentExecutor,
  expect,
  fixtureIndex,
  it,
  longTools,
  profile,
  resultText,
  toRuntimeEvents,
  toolByName,
  vi,
  workspace,
  type AgentTool,
  type LongAgentToolDetails,
  type LongCommandExecutor
} from "./long-agent-tools.test-support";
import { buildLongWorkspaceRules } from "./prompts-long-rules";

const CJK_PATTERN = /[㐀-鿿]/u;

function invokeTool(tool: AgentTool, id: string, args: JsonObject) {
  const validated = validateToolArguments(tool, {
    type: "toolCall",
    id,
    name: tool.name,
    arguments: args
  });
  return tool.execute(id, validated);
}

function mutableAgentsMdHarness(options?: {
  initialAgentsMd?: string;
  truncated?: boolean;
  activeRoot?: LongWorkspaceRoot;
  agentProfile?: LongAgentProfile;
  writeApprovalMode?: "auto-approve" | "request-approval";
}) {
  const index = fixtureIndex();
  let diskAgentsMd =
    options?.initialAgentsMd ??
    "# 长篇上下文\n\n## 作者手写禁令\n禁用感叹号堆砌。\n\n## 当前定位\n古典仙侠慢热修行。";
  let diskTruncated = options?.truncated ?? false;
  let notifyCompacted: ((ids?: readonly string[]) => void) | undefined;
  const sharedState = createLongWorkspaceToolSharedState();

  const executor = vi.fn<LongCommandExecutor>(async (command, signal) => {
    if (command.type === "long.readAgentsMd") {
      return {
        status: "accepted" as const,
        requestId: command.id,
        payload: {
          bookId: index.bookId,
          content: diskAgentsMd,
          truncated: diskTruncated,
          revision: createShortWorkspaceContentRevision(diskAgentsMd)
        }
      };
    }
    return documentExecutor(index)(command, signal);
  });

  const ctxWorkspace = workspace(
    "long",
    options?.activeRoot ?? "plot_design",
    "chapter_one"
  );
  ctxWorkspace.navigation = createLongWorkspaceNavigationSnapshot(index);

  const tools = buildLongWorkspaceTools({
    workspace: ctxWorkspace,
    profile: options?.agentProfile ?? profile("long"),
    sessionId: "session_agents_md",
    runId: "run_agents_md",
    writeApprovalMode: options?.writeApprovalMode ?? "request-approval",
    executor,
    sharedState,
    onContextCompacted: (listener) => {
      notifyCompacted = listener;
    }
  });

  return {
    index,
    tools,
    sharedState,
    executor,
    setDiskAgentsMd(next: string, truncated = false) {
      diskAgentsMd = next;
      diskTruncated = truncated;
    },
    compact(removedIds?: readonly string[]) {
      notifyCompacted?.(removedIds);
    }
  };
}

describe("long-agent-tools: singleton id='agents_md'", () => {
  it("exposes agents_md in book_line list and rejects list(scope_id='agents_md') with leaf guidance", async () => {
    const { tools } = mutableAgentsMdHarness();
    const list = toolByName(tools, "list");

    const bookLine = resultText(
      await invokeTool(list, "list-book-line", {
        scope_id: "book_line"
      })
    );
    expect(bookLine).toContain("agents_md");
    expect(bookLine).toContain("长篇上下文（AGENTS.md）");

    await expect(
      invokeTool(list, "list-agents-md", {
        scope_id: "agents_md"
      })
    ).rejects.toThrow('read(id="agents_md")');

    await expect(
      invokeTool(list, "list-agents-md-world", {
        stage: "worldbuilding",
        scope_id: "agents_md"
      })
    ).rejects.toThrow('read(id="agents_md")');
  });

  it("supports full read, retainedReads deduplication, context compaction reset, and no-executor fallback", async () => {
    const { tools, compact } = mutableAgentsMdHarness({
      activeRoot: "draft"
    });
    const read = toolByName(tools, "read");

    const first = resultText(
      await invokeTool(read, "read-full-1", { id: "agents_md" })
    );
    expect(first).toContain("长篇上下文（AGENTS.md）（agents_md）");
    expect(first).toContain("禁用感叹号堆砌。");
    expect(first).toContain("当前字数：");

    const duplicate = resultText(
      await invokeTool(read, "read-full-2", { id: "agents_md" })
    );
    expect(duplicate).toContain("该文档自上次读取后未变化，原文仍在上文。");

    compact(["read-full-1"]);
    const afterPrune = resultText(
      await invokeTool(read, "read-full-3", { id: "agents_md" })
    );
    expect(afterPrune).toContain("禁用感叹号堆砌。");
    expect(afterPrune).not.toContain("原文仍在上文");

    await expect(
      invokeTool(read, "read-with-doc", {
        id: "agents_md",
        document: "card"
      })
    ).rejects.toThrow("不接受 document 参数");
    await expect(
      invokeTool(read, "read-with-chapter", {
        id: "agents_md",
        chapter_id: "chapter_one"
      })
    ).rejects.toThrow("chapter_id 仅用于人物 current_state 或 history");

    const index = fixtureIndex();
    const fallbackWorkspace = workspace("long", "worldbuilding");
    fallbackWorkspace.navigation = createLongWorkspaceNavigationSnapshot(index);
    fallbackWorkspace.agentsMd = "# 离线回退上下文\n保留冷峻笔触。";
    const fallbackTools = buildLongWorkspaceTools({
      workspace: fallbackWorkspace,
      profile: profile("long"),
      sessionId: "session_fallback",
      runId: "run_fallback"
    });
    const fallbackRead = resultText(
      await invokeTool(toolByName(fallbackTools, "read"), "read-fallback", {
        id: "agents_md"
      })
    );
    expect(fallbackRead).toContain("保留冷峻笔触。");
  });

  it("supports head/tail/max_chars excerpts without granting full-read edit credentials", async () => {
    const { tools } = mutableAgentsMdHarness({
      initialAgentsMd: "开头🐉中间段落内容🐉结尾标记"
    });
    const read = toolByName(tools, "read");
    const edit = toolByName(tools, "edit");

    const head = resultText(
      await invokeTool(read, "read-head", {
        id: "agents_md",
        range: "head",
        max_chars: 3
      })
    );
    expect(head).toContain("片段，修改前须完整读取");
    expect(head).toContain("开头🐉");
    expect(head).not.toContain("结尾标记");

    const tail = resultText(
      await invokeTool(read, "read-tail", {
        id: "agents_md",
        range: "tail",
        max_chars: 5
      })
    );
    expect(tail).toContain("🐉结尾标记");

    const maxCharsOnly = resultText(
      await invokeTool(read, "read-max-only", {
        id: "agents_md",
        max_chars: 3
      })
    );
    expect(maxCharsOnly).toContain("【参数归一化】");

    const blockedEdit = await invokeTool(edit, "edit-after-excerpt", {
      id: "agents_md",
      replacements: [{ original_text: "开头🐉", new_text: "新开头🐉" }]
    });
    expect(resultText(blockedEdit)).toContain("完整读取");
    expect(blockedEdit.details).toEqual({ kind: "none" });
  });

  it("refuses full-read credential and rejects edit when AGENTS.md is truncated", async () => {
    const { tools } = mutableAgentsMdHarness({
      initialAgentsMd: "截断预览内容",
      truncated: true
    });
    const read = toolByName(tools, "read");
    const edit = toolByName(tools, "edit");

    const truncatedRead = resultText(
      await invokeTool(read, "read-truncated", { id: "agents_md" })
    );
    expect(truncatedRead).toContain("已被截断");
    expect(truncatedRead).toContain("快照已截断，非全文字数");

    const rejectedEdit = await invokeTool(edit, "edit-truncated", {
      id: "agents_md",
      content: "尝试覆盖截断文档",
      overwrite_mode: "replace_all"
    });
    expect(resultText(rejectedEdit)).toBe(
      "未修改：长篇上下文超过 10,000 个字符上限被截断，请先在项目结构管理中精简后再修改。"
    );
    expect(rejectedEdit.details).toEqual({ kind: "none" });
  });

  it("enforces full-read guard, surgical replacements, replace_all overwrite, meta rejection, no-op check, and emitted review metadata", async () => {
    const initial =
      "# 长篇上下文\n\n## 作者禁令\n保留短句冷幽默。\n\n## 方向\n前期悬疑探案。";
    const { index, tools } = mutableAgentsMdHarness({
      initialAgentsMd: initial,
      activeRoot: "character_design"
    });
    const read = toolByName(tools, "read");
    const edit = toolByName(tools, "edit");

    const unreadReplace = await invokeTool(edit, "unread-replace", {
      id: "agents_md",
      replacements: [
        { original_text: "前期悬疑探案。", new_text: "变轨权谋。" }
      ]
    });
    expect(resultText(unreadReplace)).toContain("请先用 read 完整读取");

    await expect(
      invokeTool(edit, "meta-rejected", {
        id: "agents_md",
        meta: { title: "非法标题" }
      })
    ).rejects.toThrow("长篇上下文不支持 meta 修改，请直接编辑正文。");

    await invokeTool(read, "read-initial", { id: "agents_md" });

    const missingOverwriteMode = await invokeTool(
      edit,
      "missing-overwrite-mode",
      {
        id: "agents_md",
        content: "# 全量重写"
      }
    );
    expect(resultText(missingOverwriteMode)).toContain("overwrite_mode");

    const noop = await invokeTool(edit, "noop-edit", {
      id: "agents_md",
      content: initial,
      overwrite_mode: "replace_all"
    });
    expect(resultText(noop)).toBe("未修改：内容与当前一致。");
    expect(noop.details).toEqual({ kind: "none" });

    const edited = await invokeTool(edit, "surgical-edit", {
      id: "agents_md",
      replacements: [
        {
          original_text: "## 方向\n前期悬疑探案。",
          new_text:
            "## 方向\n前期悬疑探案保持不变；自下一章起平滑切入朝堂权谋暗线。"
        }
      ],
      summary: "增量融合朝堂权谋变轨约束"
    });

    const editedText = resultText(edited);
    expect(editedText).toContain(
      "已形成《长篇上下文（AGENTS.md）》正文编辑提案"
    );
    expect(editedText).toContain("目标内容字数（本次提案）：");

    const expectedAfter =
      "# 长篇上下文\n\n## 作者禁令\n保留短句冷幽默。\n\n## 方向\n前期悬疑探案保持不变；自下一章起平滑切入朝堂权谋暗线。";
    expect(edited.details).toMatchObject({
      kind: "long-mutation-proposal",
      bookId: index.bookId,
      agentId: "long",
      summary: "增量融合朝堂权谋变轨约束",
      batch: {
        operations: [],
        documentWrites: [
          expect.objectContaining({
            fileId: "file_agents_md",
            mode: "replace",
            content: expectedAfter,
            reason: "增量融合朝堂权谋变轨约束"
          })
        ]
      },
      review: {
        targetKey: "doc:agents_md",
        targetKind: "agents_md",
        targetId: "agents_md",
        action: "edit",
        title: "长篇上下文（AGENTS.md）",
        content: {
          fileId: "file_agents_md",
          filePath: "AGENTS.md",
          operation: "edit",
          beforeText: initial,
          afterText: expectedAfter,
          baseRevision: createShortWorkspaceContentRevision(initial)
        }
      }
    });

    const mappedEvents = toRuntimeEvents(
      {
        type: "tool_execution_end",
        toolCallId: "surgical-edit",
        toolName: "edit",
        result: edited,
        isError: false
      },
      { sessionId: "session_agents_md", runId: "run_agents_md" },
      { provider: "writer", model: "test", mode: "local-faux" },
      "message"
    );
    const proposalEvent = mappedEvents.find(
      (event) => event.type === "long.mutation_proposal"
    );
    expect(proposalEvent).toBeDefined();
    expect(
      LongMutationProposalPayloadSchema.parse({
        sessionId: proposalEvent!.sessionId,
        runId: proposalEvent!.runId,
        ...proposalEvent!.payload
      }).review?.targetKind
    ).toBe("agents_md");

    const fullReplaced = await invokeTool(edit, "full-replace", {
      id: "agents_md",
      content: "# 长篇上下文\n\n保留短句冷幽默；后续走权谋主线。",
      overwrite_mode: "replace_all",
      summary: "整理精简长篇上下文"
    });
    expect(fullReplaced.details).toMatchObject({
      kind: "long-mutation-proposal",
      review: {
        targetKind: "agents_md",
        content: {
          beforeText: expectedAfter,
          afterText: "# 长篇上下文\n\n保留短句冷幽默；后续走权谋主线。",
          baseRevision: createShortWorkspaceContentRevision(expectedAfter)
        }
      }
    });
  });

  it("writes empty AGENTS.md with operation='write' and enforces the 10,000 Unicode code-point limit including astral characters", async () => {
    const { tools } = mutableAgentsMdHarness({ initialAgentsMd: "" });
    const edit = toolByName(tools, "edit");

    const exactLimit = "🐉".repeat(LONG_AGENTS_MD_MAX_CHARACTERS);
    const withinLimit = await invokeTool(edit, "write-exact-limit", {
      id: "agents_md",
      content: exactLimit,
      summary: "写入边界长度上下文"
    });
    expect(withinLimit.details).toMatchObject({
      kind: "long-mutation-proposal",
      review: {
        targetKind: "agents_md",
        content: {
          operation: "write",
          beforeText: "",
          afterText: exactLimit,
          baseRevision: createShortWorkspaceContentRevision("")
        }
      }
    });

    const overLimit = "🐉".repeat(LONG_AGENTS_MD_MAX_CHARACTERS + 1);
    const rejected = await invokeTool(edit, "write-over-limit", {
      id: "agents_md",
      content: overLimit,
      overwrite_mode: "replace_all",
      summary: "超出长度上限"
    });
    expect(resultText(rejected)).toBe(
      `未修改：长篇上下文（AGENTS.md）不能超过 ${LONG_AGENTS_MD_MAX_CHARACTERS} 个字符（当前 ${
        LONG_AGENTS_MD_MAX_CHARACTERS + 1
      } 个字符），请精简后重试。`
    );
    expect(rejected.details).toEqual({ kind: "none" });
  });

  it("chains same-run edits via proposalOverlay and forces a fresh read after proposalOverlay.clear() on rejection or user-edit", async () => {
    const v1 = "# 长篇上下文\n阶段一：市井种田。";
    const v2 = "# 长篇上下文\n阶段一：市井种田；阶段二：科举入仕。";
    const v3 =
      "# 长篇上下文\n阶段一：市井种田；阶段二：科举入仕；阶段三：朝堂变法。";
    const { tools, sharedState, setDiskAgentsMd } = mutableAgentsMdHarness({
      initialAgentsMd: v1
    });
    const read = toolByName(tools, "read");
    const edit = toolByName(tools, "edit");

    await invokeTool(read, "read-v1", { id: "agents_md" });
    const firstEdit = await invokeTool(edit, "edit-v2", {
      id: "agents_md",
      replacements: [
        {
          original_text: "阶段一：市井种田。",
          new_text: "阶段一：市井种田；阶段二：科举入仕。"
        }
      ]
    });
    expect(firstEdit.details).toMatchObject({
      kind: "long-mutation-proposal",
      review: { content: { beforeText: v1, afterText: v2 } }
    });

    const secondEdit = await invokeTool(edit, "edit-v3", {
      id: "agents_md",
      replacements: [
        {
          original_text: "阶段二：科举入仕。",
          new_text: "阶段二：科举入仕；阶段三：朝堂变法。"
        }
      ]
    });
    expect(secondEdit.details).toMatchObject({
      kind: "long-mutation-proposal",
      review: {
        content: {
          beforeText: v2,
          afterText: v3,
          baseRevision: createShortWorkspaceContentRevision(v2)
        }
      }
    });

    // Simulate user rejecting the proposal: overlay clears, disk remains at v1.
    sharedState.proposalOverlay.clear();
    const editAfterRejection = await invokeTool(
      edit,
      "edit-without-reread-after-reject",
      {
        id: "agents_md",
        content: "# 盲目再次提交",
        overwrite_mode: "replace_all"
      }
    );
    expect(resultText(editAfterRejection)).toContain("请先用 read 完整读取");
    expect(editAfterRejection.details).toEqual({ kind: "none" });

    const rereadAfterRejection = resultText(
      await invokeTool(read, "reread-after-reject", { id: "agents_md" })
    );
    expect(rereadAfterRejection).toContain(v1);

    const retryAfterReread = await invokeTool(edit, "edit-after-reread", {
      id: "agents_md",
      replacements: [
        {
          original_text: "阶段一：市井种田。",
          new_text: "阶段一：市井种田；过渡至州府商战。"
        }
      ]
    });
    expect(retryAfterReread.details).toMatchObject({
      kind: "long-mutation-proposal",
      review: {
        content: {
          beforeText: v1,
          baseRevision: createShortWorkspaceContentRevision(v1)
        }
      }
    });

    // Simulate user editing the proposal text before accepting on disk.
    const userEdited = "# 长篇上下文\n阶段一：市井种田（作者手改保留慢节奏）。";
    setDiskAgentsMd(userEdited);
    sharedState.proposalOverlay.clear();

    const editAfterUserEdit = await invokeTool(
      edit,
      "edit-without-reread-after-user-edit",
      {
        id: "agents_md",
        replacements: [
          { original_text: "过渡至州府商战。", new_text: "继续推进。" }
        ]
      }
    );
    expect(resultText(editAfterUserEdit)).toContain("请先用 read 完整读取");

    const rereadUserEdit = resultText(
      await invokeTool(read, "reread-user-edit", { id: "agents_md" })
    );
    expect(rereadUserEdit).toContain(userEdited);

    const reconciledEdit = await invokeTool(edit, "edit-reconciled", {
      id: "agents_md",
      replacements: [
        {
          original_text: "（作者手改保留慢节奏）。",
          new_text: "（作者手改保留慢节奏）；后续逐步引入商战。"
        }
      ]
    });
    expect(
      (
        reconciledEdit.details as Extract<
          LongAgentToolDetails,
          { kind: "long-mutation-proposal" }
        >
      ).review?.content?.baseRevision
    ).toBe(createShortWorkspaceContentRevision(userEdited));
  });

  it("rejects delete(id='agents_md') with guidance to use edit", async () => {
    const tools = longTools({ executor: documentExecutor(fixtureIndex()) });
    const remove = toolByName(tools, "delete");

    await expect(
      invokeTool(remove, "delete-agents-md", { id: "agents_md" })
    ).rejects.toThrow('edit(id="agents_md")');

    await expect(
      invokeTool(remove, "delete-agents-md-doc", {
        id: "agents_md",
        document: "world_reveals"
      })
    ).rejects.toThrow('edit(id="agents_md")');
  });

  it("validates tool parameter schemas and gates coCreationMode (brainstorm strips edit, try_rewrite allows manual-review edit)", async () => {
    const index = fixtureIndex();
    const ctxWorkspace = workspace("long", "draft", "chapter_one");
    ctxWorkspace.navigation = createLongWorkspaceNavigationSnapshot(index);
    const executor = documentExecutor(
      index,
      {},
      { agentsMd: "# 长篇上下文\n原定位：悬疑。" }
    );

    const brainstormTools = buildLongWorkspaceTools({
      workspace: ctxWorkspace,
      profile: profile("long"),
      sessionId: "session_co",
      runId: "run_brainstorm",
      coCreationMode: "brainstorm",
      executor
    });
    expect(brainstormTools.map((t) => t.name)).not.toContain("edit");
    expect(brainstormTools.map((t) => t.name)).not.toContain("delete");
    expect(
      resultText(
        await invokeTool(
          toolByName(brainstormTools, "read"),
          "brainstorm-read",
          { id: "agents_md" }
        )
      )
    ).toContain("原定位：悬疑。");

    const tryRewriteTools = buildLongWorkspaceTools({
      workspace: ctxWorkspace,
      profile: profile("long"),
      sessionId: "session_co",
      runId: "run_try_rewrite",
      writeApprovalMode: "auto-approve",
      coCreationMode: "try_rewrite",
      executor
    });
    expect(tryRewriteTools.map((t) => t.name)).toContain("edit");
    expect(tryRewriteTools.map((t) => t.name)).not.toContain("create");
    expect(tryRewriteTools.map((t) => t.name)).not.toContain("delete");

    const tryRead = toolByName(tryRewriteTools, "read");
    const tryEdit = toolByName(tryRewriteTools, "edit");
    await invokeTool(tryRead, "try-read", { id: "agents_md" });
    const tryEdited = await invokeTool(tryEdit, "try-edit", {
      id: "agents_md",
      replacements: [
        { original_text: "原定位：悬疑。", new_text: "原定位：悬疑加权谋。" }
      ]
    });
    expect(resultText(tryEdited)).toContain("等待客户端审阅。");
    expect(tryEdited.details).toMatchObject({
      kind: "long-mutation-proposal",
      review: { targetKind: "agents_md" }
    });

    expect(() =>
      validateToolArguments(tryEdit, {
        type: "toolCall",
        id: "invalid-extra-prop",
        name: "edit",
        arguments: {
          id: "agents_md",
          content: "x",
          unexpected_field: true
        }
      })
    ).toThrow();
  });

  it("documents id='agents_md' and smooth-transition repositioning rules in both zh-CN and en-US without CJK leakage", () => {
    const zh = buildLongWorkspaceRules("zh-CN");
    expect(zh).toContain('id="agents_md"');
    expect(zh).toContain("长篇上下文（AGENTS.md）");
    expect(zh).toContain("10,000");
    expect(zh).toContain("【作品网文定位调整与连载中途平滑变轨】");
    expect(zh).toContain("严禁修改任何已写正文、已有角色档案与已有世界观条目");
    expect(zh).toContain("保留作者原有的手写文风禁令与个人约定");
    expect(zh).toContain('edit(id="agents_md")');
    expect(zh).toContain("先在对话回复中给出增量补齐建议");

    const en = buildLongWorkspaceRules("en-US");
    expect(en).toContain('id="agents_md"');
    expect(en).toContain("Long-form context (AGENTS.md)");
    expect(en).toContain("10,000-character limit");
    expect(en).toContain(
      "[Repositioning and mid-serialization smooth transition]"
    );
    expect(en).toContain(
      "strictly never modify any written manuscript chapters, existing character profiles or existing worldbuilding entries"
    );
    expect(en).toContain(
      "preserving all author-written style bans and personal conventions"
    );
    expect(en).toContain('edit(id="agents_md")');
    expect(en).toContain(
      "first offer incremental suggestions in your reply and wait for the author's confirmation"
    );
    expect(en.split("\n").filter((line) => CJK_PATTERN.test(line))).toEqual([]);
  });
});
