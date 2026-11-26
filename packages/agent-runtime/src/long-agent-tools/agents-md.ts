import { createHash } from "node:crypto";
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import {
  LONG_AGENTS_MD_MAX_CHARACTERS,
  LONG_AGENTS_MD_PATH,
  LongMutationReviewSchema,
  LongWorkspaceOperationBatchSchema,
  createShortWorkspaceContentRevision,
  longAgentsMdCharacterCount
} from "@writer/contracts";
import {
  appendWritingContentCounts,
  writingReadContentCountLine
} from "../writing-content-counts";
import {
  REPLACE_ALL_OVERWRITE_MODE,
  WRITING_EDIT_OVERWRITE_RECOVERY
} from "../writing-edit-guidance";
import { resolveWritingEditSummary } from "../writing-edit-summary";
import { longProposalResultSummary, type LongToolContext } from "./context";
import {
  LONG_AGENTS_MD_FILE_ID,
  LONG_AGENTS_MD_ID,
  LONG_AGENTS_MD_TITLE
} from "./entity-registry";
import type { LongAgentToolDetails } from "./index";
import { proposalId } from "./proposals";
import { stableHash, textResult } from "./shared";

const TRUNCATED_AGENTS_MD_READ_NOTICE =
  "注意：长篇上下文超过 10,000 个字符上限，当前返回内容已被截断，不授予完整读取凭据；请先在项目结构管理中精简后再修改。";

export async function readAgentsMdTarget(
  ctx: LongToolContext,
  toolCallId: string,
  params: {
    document?: string;
    chapter_id?: string;
    range?: "head" | "tail";
  },
  maximum: number,
  hadExplicitMaxChars: boolean,
  formatResult: (text: string) => AgentToolResult<LongAgentToolDetails>,
  signal?: AbortSignal
): Promise<AgentToolResult<LongAgentToolDetails>> {
  if (params.document !== undefined) {
    throw new Error("长篇上下文（AGENTS.md）不接受 document 参数。");
  }
  if (params.chapter_id !== undefined) {
    throw new Error("chapter_id 仅用于人物 current_state 或 history。");
  }
  if (ctx.readableRoots.size === 0) {
    throw new Error("当前智能体无权读取长篇上下文。");
  }

  const agentsMd = await ctx.readAgentsMd(signal);
  const header = `${LONG_AGENTS_MD_TITLE}（${LONG_AGENTS_MD_ID}）`;

  if (params.range) {
    const characters = Array.from(agentsMd.content);
    const excerpt = (
      params.range === "head"
        ? characters.slice(0, maximum)
        : characters.slice(-maximum)
    ).join("");
    const rangeKey = `range:${LONG_AGENTS_MD_ID}:${params.range}:${maximum}`;
    const rangeFingerprint = createHash("sha256")
      .update(`${agentsMd.truncated ? "1" : "0"}:${excerpt}`)
      .digest("hex");
    if (ctx.retainedReads.get(rangeKey)?.fingerprint === rangeFingerprint) {
      return formatResult(
        [
          header,
          `【重复片段读取】相同范围（range=${params.range}, max_chars=${maximum}）自上次读取后未变化，请勿重复调用相同参数的片段读取。`,
          '如需修改正文，请不传 range 和 max_chars 调用 read(id="agents_md") 进行一次完整读取，随后直接调用 edit 提交局部修改。'
        ].join("\n")
      );
    }
    ctx.retainedReads.set(rangeKey, {
      fingerprint: rangeFingerprint,
      toolCallId
    });
    return formatResult(
      [
        '片段，修改前须完整读取。请去掉 range 和 max_chars 调用 read(id="agents_md") 完整读取。',
        header,
        ...(agentsMd.truncated ? [TRUNCATED_AGENTS_MD_READ_NOTICE] : []),
        writingReadContentCountLine(excerpt, agentsMd.truncated),
        "",
        excerpt || "（正文为空）"
      ].join("\n")
    );
  }

  if (agentsMd.truncated || hadExplicitMaxChars) {
    ctx.fullyReadAgentsMd = undefined;
    return formatResult(
      [
        header,
        TRUNCATED_AGENTS_MD_READ_NOTICE,
        writingReadContentCountLine(agentsMd.content, true),
        "",
        agentsMd.content || "（正文为空）"
      ].join("\n")
    );
  }

  ctx.fullyReadAgentsMd = { content: agentsMd.content };
  const text = [
    header,
    writingReadContentCountLine(agentsMd.content),
    "",
    agentsMd.content || "（正文为空）"
  ].join("\n");
  const key = `file:${LONG_AGENTS_MD_ID}`;
  const fingerprint = createHash("sha256").update(text).digest("hex");
  if (ctx.retainedReads.get(key)?.fingerprint === fingerprint) {
    return formatResult(
      [header, "该文档自上次读取后未变化，原文仍在上文。"].join("\n")
    );
  }
  ctx.retainedReads.set(key, { fingerprint, toolCallId });
  return formatResult(
    text +
      (Array.from(agentsMd.content).length > 8_000
        ? "\n\n本文较长；只需结尾或片段时可用 range / search。"
        : "")
  );
}

export async function editAgentsMdTarget(
  ctx: LongToolContext,
  toolCallId: string,
  params: {
    document?: string;
    chapter_id?: string;
    content?: string;
    replacements?: readonly { original_text: string; new_text: string }[];
    meta?: Record<string, unknown>;
    overwrite_mode?: string;
    summary?: string;
  },
  applyReplacements: (
    source: string,
    replacements: readonly { original_text: string; new_text: string }[]
  ) => { content: string } | { failure: string },
  signal?: AbortSignal
): Promise<AgentToolResult<LongAgentToolDetails>> {
  if (ctx.writableRoots.size === 0) {
    throw new Error("当前智能体无权写入长篇上下文。");
  }
  if (params.document !== undefined) {
    throw new Error("长篇上下文（AGENTS.md）不接受 document 参数。");
  }
  if (params.chapter_id !== undefined) {
    throw new Error("chapter_id 仅用于人物 current_state 或 history。");
  }
  if (params.meta !== undefined) {
    throw new Error("长篇上下文不支持 meta 修改，请直接编辑正文。");
  }
  const bodyIntents = [
    params.content !== undefined,
    (params.replacements?.length ?? 0) > 0
  ].filter(Boolean).length;
  if (bodyIntents > 1) {
    throw new Error("content 与 replacements 只能二选一。");
  }
  if (bodyIntents === 0) {
    throw new Error("edit 至少需要 content、replacements 或 meta 其中之一。");
  }

  const current = await ctx.readAgentsMd(signal);
  if (current.truncated) {
    return textResult(
      "未修改：长篇上下文超过 10,000 个字符上限被截断，请先在项目结构管理中精简后再修改。"
    );
  }

  const beforeText = current.content;
  const evidence = ctx.fullyReadAgentsMd;
  if (beforeText.trim().length > 0) {
    if (!evidence) {
      return textResult(
        `未修改：请先用 read 完整读取 ${LONG_AGENTS_MD_TITLE}。`
      );
    }
    if (evidence.content !== beforeText) {
      return textResult(
        `未修改：${LONG_AGENTS_MD_TITLE} 在你读取后已有改动，请先用 read 完整读取最新内容再修改。`
      );
    }
    if (
      params.content !== undefined &&
      params.overwrite_mode !== REPLACE_ALL_OVERWRITE_MODE
    ) {
      return textResult(WRITING_EDIT_OVERWRITE_RECOVERY);
    }
  } else if (params.replacements && !evidence) {
    return textResult(`未修改：请先用 read 完整读取 ${LONG_AGENTS_MD_TITLE}。`);
  }

  const next = params.replacements
    ? applyReplacements(beforeText, params.replacements)
    : { content: params.content! };
  if ("failure" in next) {
    return textResult(next.failure);
  }
  const afterText = next.content;
  if (afterText === beforeText) {
    return textResult("未修改：内容与当前一致。", { kind: "none" });
  }
  const afterCount = longAgentsMdCharacterCount(afterText);
  if (afterCount > LONG_AGENTS_MD_MAX_CHARACTERS) {
    return textResult(
      `未修改：长篇上下文（AGENTS.md）不能超过 ${LONG_AGENTS_MD_MAX_CHARACTERS} 个字符（当前 ${afterCount} 个字符），请精简后重试。`,
      { kind: "none" }
    );
  }

  ctx.proposalOverlay.rememberAgentsMd(afterText);
  ctx.fullyReadAgentsMd = { content: afterText };
  ctx.retainedReads.delete(`file:${LONG_AGENTS_MD_ID}`);
  for (const key of ctx.retainedReads.keys()) {
    if (key.startsWith(`range:${LONG_AGENTS_MD_ID}:`)) {
      ctx.retainedReads.delete(key);
    }
  }

  const summary = resolveWritingEditSummary(
    params.summary,
    LONG_AGENTS_MD_TITLE,
    params
  );
  const timestamp = new Date().toISOString();
  const baseRevision =
    current.revision || createShortWorkspaceContentRevision(beforeText);
  const batch = LongWorkspaceOperationBatchSchema.parse({
    updatedAt: timestamp,
    operations: [],
    documentWrites: [
      {
        proposalId: proposalId(ctx, toolCallId, "write:0"),
        fileId: LONG_AGENTS_MD_FILE_ID,
        content: afterText,
        updatedAt: timestamp,
        reason: summary,
        mode: "replace",
        expectedSha256: stableHash(beforeText)
      }
    ]
  });
  const review = LongMutationReviewSchema.parse({
    targetKey: "doc:agents_md",
    targetKind: "agents_md",
    targetId: LONG_AGENTS_MD_ID,
    action: "edit",
    title: LONG_AGENTS_MD_TITLE,
    content: {
      fileId: LONG_AGENTS_MD_FILE_ID,
      filePath: LONG_AGENTS_MD_PATH,
      operation: beforeText.trim() ? "edit" : "write",
      beforeText,
      afterText,
      baseRevision
    }
  });
  const message = appendWritingContentCounts(
    longProposalResultSummary(
      ctx.input,
      `已形成《${LONG_AGENTS_MD_TITLE}》正文${
        params.replacements ? "编辑" : "写入"
      }提案，等待客户端审阅。`
    ),
    [
      {
        title: LONG_AGENTS_MD_TITLE,
        id: LONG_AGENTS_MD_ID,
        content: afterText
      }
    ]
  );
  return textResult(message, {
    kind: "long-mutation-proposal",
    bookId: ctx.workspace.bookId,
    agentId: ctx.profile.id,
    batch,
    summary,
    review
  });
}
