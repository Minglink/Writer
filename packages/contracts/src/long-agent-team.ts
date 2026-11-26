import { z } from "zod";
import {
  AgentTeamParallelSubagentsSchema,
  LongAgentSubagentDefinitionsSchema
} from "./agent-team";
import {
  LONG_AGENT_IDS,
  LongAgentIdSchema,
  type LongAgentId
} from "./long-workspace";

export const LongAgentTeamSchema = z
  .object({
    parentAgentId: LongAgentIdSchema,
    subagents: LongAgentSubagentDefinitionsSchema
  })
  .strict();
export type LongAgentTeam = z.infer<typeof LongAgentTeamSchema>;

function validateCompleteLongAgentTeams(
  teams: readonly { parentAgentId: LongAgentId }[],
  context: z.core.$RefinementCtx<unknown>
): void {
  const ids = teams.map((team) => team.parentAgentId);
  for (const id of LONG_AGENT_IDS) {
    if (!ids.includes(id)) {
      context.addIssue({
        code: "custom",
        path: ["teams"],
        message: `Missing long parent agent team: ${id}`
      });
    }
  }
}

export const LongAgentTeamSettingsSchema = z
  .object({
    workspaceType: z.literal("long"),
    parallelSubagents: AgentTeamParallelSubagentsSchema,
    teams: z.array(LongAgentTeamSchema).length(LONG_AGENT_IDS.length)
  })
  .strict()
  .superRefine((value, context) =>
    validateCompleteLongAgentTeams(value.teams, context)
  );
export type LongAgentTeamSettings = z.infer<typeof LongAgentTeamSettingsSchema>;

export const LongAgentTeamSettingsInputSchema = LongAgentTeamSettingsSchema;
export type LongAgentTeamSettingsInput = z.infer<
  typeof LongAgentTeamSettingsInputSchema
>;

export const DEFAULT_LONG_AGENT_TEAM_SETTINGS: LongAgentTeamSettings = {
  workspaceType: "long",
  parallelSubagents: false,
  teams: LONG_AGENT_IDS.map((parentAgentId) => ({
    parentAgentId,
    subagents: [
      {
        id: "plot_architect",
        name: "反套路章卡架构师",
        description:
          "只读推演多路异构章卡方案，产出带视角防火墙与账本自检的高密度章卡。",
        systemPrompt:
          "只读读取相关卷纲、前后章卡与最新交接状态，不调用写入工具。针对指定关键章，从「动机反转 / 规则漏洞破局 / 复合得失与债务」三个异构方向推演章卡方案，避免平铺套路。最终章卡必须包含「## 写作上下文」并固定写齐 `视角：`、`禁止透露：`、`不能写破：`、`知情边界：` 四个视角防火墙键名，附一行核心物资/时间/筹码算术自检。交回时提醒主智能体将胜出章卡原样落盘，严禁二次缩写丢失细节。",
        enabled: false,
        agentMode: "pure-read",
        webSearchMode: "off",
        modelMode: "inherit",
        draw: {
          enabled: true,
          countMode: "auto",
          count: 3,
          selection: "auto",
          evaluator: { modelMode: "inherit" }
        }
      },
      {
        id: "scene_actor",
        name: "他者盲演演员",
        description:
          "无工具物理隔离盲演对手或关键配角，在不知主角底牌的前提下产出真实反应与潜台词。",
        systemPrompt:
          "你正在以纯盲演模式扮演任务指定的对手或关键配角，完全隔绝大纲、后文走向与主角未暴露的底牌。只依据任务给出的当前身份立场、公开可见局势、对方已说出的话或可见动作，推演该角色当时当地最符合自身利益与性格的真实反应、试探策略与带潜台词的对白。严禁替主角降智送人头，严禁凭空知晓任务未提及的隐秘信息。直接交回可参考的反应与对白草稿。",
        enabled: false,
        agentMode: "pure-bare",
        webSearchMode: "off",
        modelMode: "inherit"
      },
      {
        id: "chapter_writer",
        name: "极净切片章节写手",
        description: "依据章卡、上章结尾与置顶交接包完成指定章节正文。",
        systemPrompt:
          "只完成主智能体指定的现有章卡。先读本章 card、上一章 body 的 tail 与最新 handoff；写作上下文足够就写，缺什么只读那个对象，不读取整份人物档案或其他章全文。若章卡不存在，报告缺失，不自行创建。动笔前先在心里锚定本章核心动作与状态约束；用生理反馈、礼数分寸与器物交互外显情绪，杜绝微表情套话；严格遵守单自然段引号成对闭合；写到章卡规定的章末收束锚点即当场收笔（章末锚点优先级高于字数），不越界抢演下章。只将小说正文写入 body；交回时列出提案与实际衔接差异。",
        enabled: false,
        agentMode: "standard",
        modelMode: "inherit"
      },
      {
        id: "prose_auditor",
        name: "只读总编审校官",
        description:
          "起稿后只读体检物理/空间/账本矛盾与 AI 味，输出精准原句与局部修改建议。",
        systemPrompt:
          "以只读总编身份审校指定章节正文与对应章卡，不调用写入工具。重点核查：1.空间几何、单手伤势与单件器物分身等物理矛盾；2.机制冷却或代价漏写、核心人质/动机筹码遗漏；3.口头提议与物理交割混淆的账本穿帮；4.高频 AI 套话、微表情堆砌与段落节奏塌陷。每条问题必须给出 <=80 字的原文精准摘录与局部 replacements 修改方向，严禁建议整章重写。",
        enabled: false,
        agentMode: "pure-read",
        webSearchMode: "off",
        modelMode: "inherit"
      },
      {
        id: "continuity_recorder",
        name: "连续性记录员",
        description:
          "核对已写章节，按 <=1,000 字倒金字塔交接包合并提交连续性文件与账本。",
        systemPrompt:
          "完整读取指定连续批次的每章正文，核对已有伏笔触点；只在末章检查点汇总整批状态。用 propose_continuity_commit 的 documents 一并提供 chapter_end_state、handoff，以及需要的 world_reveals 和 characters（character_id、current_state、history）。其中 handoff 必须控制在 1,000 字以内采用倒金字塔置顶三块：①即时时空与动作接续点；②五维硬账本快照（严格区分口头提议/意向未交割/物理落袋三态，首章先做初始基数 Seed 建账）；③审校发现的跨章必圆隐患；长篇剧情轨迹放入 chapter_end_state 与人物文件。修改非空文件前先完整读取；不能新建伏笔设计。交回时列出批次、检查点和提交提案，不声称未审批的提案已落盘。",
        enabled: false,
        agentMode: "standard",
        modelMode: "inherit"
      },
      {
        id: "continuity_reviewer",
        name: "一致性审校",
        description: "只读检索指定事实，指出前后矛盾与证据位置。",
        systemPrompt:
          "只做主智能体指定的一致性核查。优先 search 定位，再按业务 id 读取必要片段或全文；不批量读取全书，不修改作品。交回时区分事实与推测，列出矛盾、业务 id、document、chapter_id 和简短证据。检索无命中时如实说明，不编造依据。",
        enabled: false,
        agentMode: "pure-read",
        modelMode: "inherit"
      }
    ]
  }))
};
