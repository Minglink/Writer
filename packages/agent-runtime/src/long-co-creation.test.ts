import { describe, expect, it } from "vitest";
import { buildLongWorkspaceTools } from "./long-agent-tools";
import { buildLongCoCreationBoundary } from "./prompts-long";
import {
  fixtureIndex,
  profile as createLongProfileFixture,
  resultText,
  toolByName,
  workspace as buildWorkspaceFixture
} from "./long-agent-tools.test-support";

describe("long-form co-creation runtime guardrails", () => {
  const workspace = buildWorkspaceFixture("long", "draft");
  const profile = createLongProfileFixture("long");

  it("strips all write and ledger-commit tools in brainstorm mode even when auto-approve is requested", () => {
    const tools = buildLongWorkspaceTools({
      workspace,
      profile,
      sessionId: "sess-co-1",
      runId: "run-co-1",
      writeApprovalMode: "auto-approve",
      coCreationMode: "brainstorm"
    });
    const names = tools.map((tool) => tool.name);

    expect(names).toContain("list");
    expect(names).toContain("read");
    expect(names).toContain("search");
    expect(names).toContain("ask_user_question");
    expect(names).not.toContain("create");
    expect(names).not.toContain("edit");
    expect(names).not.toContain("delete");
    expect(names).not.toContain("commit_ledger");
  });

  it("strips all write and ledger-commit tools in critique mode", () => {
    const tools = buildLongWorkspaceTools({
      workspace,
      profile,
      sessionId: "sess-co-2",
      runId: "run-co-2",
      writeApprovalMode: "auto-approve",
      coCreationMode: "critique"
    });
    const names = tools.map((tool) => tool.name);

    expect(names).toContain("read");
    expect(names).toContain("search");
    expect(names).not.toContain("create");
    expect(names).not.toContain("edit");
    expect(names).not.toContain("delete");
    expect(names).not.toContain("commit_ledger");
  });

  it("keeps only edit (no create/delete/commit_ledger) in try_rewrite mode so local diffs can be proposed under manual approval", () => {
    const tools = buildLongWorkspaceTools({
      workspace,
      profile,
      sessionId: "sess-co-3",
      runId: "run-co-3",
      writeApprovalMode: "auto-approve",
      coCreationMode: "try_rewrite"
    });
    const names = tools.map((tool) => tool.name);

    expect(names).toContain("read");
    expect(names).toContain("edit");
    expect(names).not.toContain("create");
    expect(names).not.toContain("delete");
    expect(names).not.toContain("commit_ledger");
  });

  it("deduplicates repeated identical range reads and guides the model to a full read", async () => {
    const index = fixtureIndex();
    const chapter = index.chapters[0]!;
    const tools = buildLongWorkspaceTools({
      workspace,
      profile,
      sessionId: "sess-co-4",
      runId: "run-co-4",
      coCreationMode: "try_rewrite",
      executor: async (command) => {
        if (command.type === "long.getWorkspaceIndex") {
          return {
            status: "accepted",
            requestId: command.id,
            payload: { bookId: index.bookId, workspaceIndex: index }
          };
        }
        const text = "林澈停在石阶拐角，指尖摸到了口袋里那枚发凉的黄铜钥匙。";
        return {
          status: "accepted",
          requestId: command.id,
          payload: {
            bookId: index.bookId,
            file: chapter.body,
            content: text,
            offset: 0,
            totalCharacters: text.length,
            nextOffset: null
          }
        };
      }
    });
    const readTool = toolByName(tools, "read");
    const first = resultText(
      await readTool.execute("call-range-1", {
        id: chapter.chapterCardId,
        document: "body",
        range: "head",
        max_chars: 8000
      })
    );
    expect(first).toContain("片段，修改前须完整读取。");
    expect(first).toContain("去掉 range 和 max_chars");
    const second = resultText(
      await readTool.execute("call-range-2", {
        id: chapter.chapterCardId,
        document: "body",
        range: "head",
        max_chars: 8000
      })
    );
    expect(second).toContain("【重复片段读取】");
    expect(second).toContain("不传 range 和 max_chars");
  });

  it("emits mode-specific runtime boundaries in both zh-CN and en-US", () => {
    expect(buildLongCoCreationBoundary("brainstorm", "zh-CN")).toContain(
      "仅只读讨论"
    );
    expect(buildLongCoCreationBoundary("critique", "zh-CN")).toContain(
      "先当读者"
    );
    expect(buildLongCoCreationBoundary("try_rewrite", "zh-CN")).toContain(
      "强制手动差异审阅"
    );
    expect(buildLongCoCreationBoundary("critique", "en-US")).toContain(
      "strictly read-only"
    );
    expect(buildLongCoCreationBoundary(undefined, "zh-CN")).toBe("");
  });
});
