import type {
  ConversationCheckpoint,
  LongCoCreationMode,
  LongWorkspaceRoot,
  SessionConversationHistoryMessage
} from "@writer/contracts";
import { REWRITTEN_CH17_TS } from "./synthetic-book";

export type EvalSessionState =
  "fresh" | "hot" | "post_compaction" | "cold_restore";

export type ForbiddenSourceKind =
  | "future_chapter"
  | "stale_version"
  | "withdrawn_decision"
  | "wrong_batch_handoff";

export interface RequiredEvidenceSpec {
  id: string;
  document: string;
  mustContain: string;
  allowedUpdatedAt?: string;
}

export interface ForbiddenInfoSpec {
  label: string;
  pattern: string;
  sourceKind: ForbiddenSourceKind;
}

export interface LongMemorySeedCase {
  id: string;
  title: string;
  category:
    | "blank_chapter_draft"
    | "same_chapter_continue"
    | "edit_after_prior_rewrite"
    | "batch_intermediate_chapter"
    | "flashback_scene"
    | "limited_pov_future_leak"
    | "withdrawn_author_decision"
    | "missing_prior_and_distant_evidence";
  rewriteChapter17?: boolean;
  activeRoot: LongWorkspaceRoot;
  activeChapterCardId: string;
  targetChapterCardId: string;
  prompt: string;
  coCreationMode?: LongCoCreationMode;
  priorConversationHistory?: SessionConversationHistoryMessage[];
  priorCheckpoint?: ConversationCheckpoint;
  requiredEvidence: readonly RequiredEvidenceSpec[];
  forbiddenInfo: readonly ForbiddenInfoSpec[];
  oracleEvidenceText: string;
  expectedBehavior: string;
}

export const LONG_MEMORY_SEED_CASES: readonly LongMemorySeedCase[] = [
  {
    id: "seed_01_blank_chapter_draft",
    title: "空白章起稿（第19章）",
    category: "blank_chapter_draft",
    activeRoot: "draft",
    activeChapterCardId: "chapter_19",
    targetChapterCardId: "chapter_19",
    prompt: "请按章卡起稿第19章《空船离港》的开头部分。",
    requiredEvidence: [
      {
        id: "chapter_19",
        document: "card",
        mustContain: "发现老船长的拖轮已经解缆离港"
      },
      {
        id: "chapter_18",
        document: "body",
        mustContain: "逼老船长交出缺失的页码"
      }
    ],
    forbiddenInfo: [
      {
        label: "第80章幕后真相",
        pattern: "周明远才是幕后主使",
        sourceKind: "future_chapter"
      }
    ],
    oracleEvidenceText:
      "【人工证据】\n- 第19章章卡：清晨雾散，林岚赶到三号泊位，发现老船长的拖轮已经解缆离港。\n- 第18章最新结尾：林岚拢紧大衣袖口，心里盘算着天亮后如何逼老船长交出缺失的页码。\n- 严格早于第19章的检查点：commit_b2（截至第17章）。",
    expectedBehavior:
      "自动附带第19章章卡与第18章最新已保存结尾，不引入第80章后文。"
  },
  {
    id: "seed_02_same_chapter_continue",
    title: "同章续写（第18章）",
    category: "same_chapter_continue",
    activeRoot: "draft",
    activeChapterCardId: "chapter_18",
    targetChapterCardId: "chapter_18",
    prompt: "接着第18章刚才写到的地方继续往后写两段。",
    requiredEvidence: [
      {
        id: "chapter_18",
        document: "card",
        mustContain: "林岚与沈青在雾中核对码头线索"
      },
      {
        id: "chapter_18",
        document: "body",
        mustContain: "心里盘算着天亮后如何逼老船长交出缺失的页码"
      }
    ],
    forbiddenInfo: [
      {
        label: "第80章交接",
        pattern: "幕后主使已揭晓为周明远",
        sourceKind: "future_chapter"
      }
    ],
    oracleEvidenceText:
      "【人工证据】\n- 第18章章卡：林岚与沈青在雾中核对码头线索，准备天亮后去找老船长对质。\n- 第18章当前已保存尾段：雾气从栈桥木缝里往上钻，林岚拢紧大衣袖口，盯着灯影里晃动的潮水，心里盘算着天亮后如何逼老船长交出缺失的页码。",
    expectedBehavior:
      "附带第18章章卡和第18章当前已保存结尾，衔接自然且无未来剧透。"
  },
  {
    id: "seed_03_edit_after_prior_rewrite",
    title: "前章第17章重写后回改第18章",
    category: "edit_after_prior_rewrite",
    rewriteChapter17: true,
    activeRoot: "draft",
    activeChapterCardId: "chapter_18",
    targetChapterCardId: "chapter_18",
    prompt: "我刚重写了第17章结尾，请据此回改第18章开头衔接。",
    requiredEvidence: [
      {
        id: "chapter_18",
        document: "card",
        mustContain: "准备天亮后去找老船长对质"
      },
      {
        id: "chapter_17",
        document: "body",
        mustContain: "塞进锈迹斑斑的灯笼底座",
        allowedUpdatedAt: REWRITTEN_CH17_TS
      }
    ],
    forbiddenInfo: [
      {
        label: "旧版第17章烧信封交接",
        pattern: "沈青在码头火盆烧毁了港务信封",
        sourceKind: "stale_version"
      }
    ],
    oracleEvidenceText:
      "【人工证据】\n- 第18章章卡：林岚与沈青在雾中核对码头线索，准备天亮后去找老船长对质。\n- 第17章最新保存正文（已改稿）：沈青把半截残缺的船票塞进锈迹斑斑的灯笼底座，对林岚说“账簿不在船长手里”。\n- 注意：commit_b2 的旧版 handoff 已过期，不作为前情依据。",
    expectedBehavior:
      "识别 commit_b2 的 changedChapterIds 包含 chapter_17，放弃过期 handoff，以第17章最新保存正文作为衔接依据。"
  },
  {
    id: "seed_04_batch_intermediate_chapter",
    title: "批次中间章回改（第16章）",
    category: "batch_intermediate_chapter",
    activeRoot: "draft",
    activeChapterCardId: "chapter_16",
    targetChapterCardId: "chapter_16",
    prompt: "回改第16章《潮汐账簿》，补强林岚看账簿时的细节。",
    requiredEvidence: [
      {
        id: "chapter_16",
        document: "card",
        mustContain: "沈青带来半本受潮的货单"
      },
      {
        id: "chapter_16",
        document: "body",
        mustContain: "九月十七日那一页"
      },
      {
        id: "chapter_15",
        document: "body",
        mustContain: "半圈新鲜的蜡油"
      }
    ],
    forbiddenInfo: [
      {
        label: "晚于第16章的批次末章交接",
        pattern: "沈青在码头火盆烧毁了港务信封",
        sourceKind: "wrong_batch_handoff"
      }
    ],
    oracleEvidenceText:
      "【人工证据】\n- 第16章章卡：沈青带来半本受潮的货单，指向码头夜班船只。\n- 第16章正文：沈青指着九月十七日那一页。\n- 第15章已保存结尾（严格早于第16章）：里面只剩半圈新鲜的蜡油。\n- 注意：commit_b2 覆盖第15–17章，其末章第17章 handoff 晚于第16章，不得用作第16章前情。",
    expectedBehavior:
      "仅说明 commit_b2 覆盖关系，不使用第17章 handoff，改用严格早于第16章的 commit_b1（如适用）与第15章原文。"
  },
  {
    id: "seed_05_flashback_scene",
    title: "倒叙场景回改（第15章）",
    category: "flashback_scene",
    activeRoot: "draft",
    activeChapterCardId: "chapter_15",
    targetChapterCardId: "chapter_15",
    prompt:
      "在第15章开头补一段简短倒叙，承接第5章仓库检查后的疑虑，但不要剧透后面码头和钟楼密室的事。",
    requiredEvidence: [
      {
        id: "chapter_15",
        document: "card",
        mustContain: "夜探钟楼外墙"
      },
      {
        id: "chapter_05",
        document: "handoff",
        mustContain: "林岚已收好缺齿铜钥匙"
      }
    ],
    forbiddenInfo: [
      {
        label: "第80章密室真相",
        pattern: "周明远是幕后主使",
        sourceKind: "future_chapter"
      }
    ],
    oracleEvidenceText:
      "【人工证据】\n- 第15章章卡：林岚与沈青夜探钟楼外墙，发现暗格已被人提前清空。\n- 第5章检查点 handoff：林岚已收好缺齿铜钥匙；老船长拒绝配合盘账。",
    expectedBehavior: "只采用第15章之前的已知状态，对较晚情节保持未知。"
  },
  {
    id: "seed_06_limited_pov_future_leak",
    title: "写到第80章压缩重开后回改第18章（有限视角核心场景）",
    category: "limited_pov_future_leak",
    rewriteChapter17: true,
    activeRoot: "draft",
    activeChapterCardId: "chapter_18",
    targetChapterCardId: "chapter_18",
    prompt: "回改第18章，突出林岚此刻的判断和心理推进，衔接第17章最新结尾。",
    priorConversationHistory: [
      {
        role: "user",
        content:
          "第80章我们定好了：周明远是幕后主使，而且早在第5章就调换并磨平了铜钥匙。",
        createdAt: "2026-11-23T20:05:00.000Z"
      },
      {
        role: "assistant",
        content: "明白，第80章钟楼密室摊牌已经明确周明远是幕后主使。",
        createdAt: "2026-11-23T20:06:00.000Z"
      }
    ],
    priorCheckpoint: {
      summary:
        "此前已讨论完第80章真相：周明远是幕后主使，老船长只是替罪羊。作者随后切回第一卷准备精修早章。",
      firstKeptCreatedAt: "2026-11-23T20:05:00.000Z",
      tokensBefore: 12000,
      createdAt: "2026-11-23T21:00:00.000Z"
    },
    requiredEvidence: [
      {
        id: "chapter_18",
        document: "card",
        mustContain: "禁止透露：周明远是幕后主使"
      },
      {
        id: "chapter_17",
        document: "body",
        mustContain: "塞进锈迹斑斑的灯笼底座",
        allowedUpdatedAt: REWRITTEN_CH17_TS
      }
    ],
    forbiddenInfo: [
      {
        label: "第80章真相泄露",
        pattern: "周明远是幕后主使",
        sourceKind: "future_chapter"
      }
    ],
    oracleEvidenceText:
      "【人工证据】\n- 第18章章卡（含有限视角边界：林岚此时仍误以为老船长私吞账本，禁止透露：周明远是幕后主使）。\n- 第17章最新保存结尾：沈青把半截残缺的船票塞进锈迹斑斑的灯笼底座。\n- 注意：历史对话与检查点中含第80章真相，不得作为林岚在第18章的已知信息。",
    expectedBehavior:
      "取证层不引入第80章记录，附带第17章最新正文与第18章视角边界；在评分器中显式记录历史/检查点中已存在的剧透来源。"
  },
  {
    id: "seed_07_withdrawn_author_decision",
    title: "旧决定被撤回与范围限定（P2 基线对照）",
    category: "withdrawn_author_decision",
    activeRoot: "draft",
    activeChapterCardId: "chapter_18",
    targetChapterCardId: "chapter_18",
    prompt: "按我们最新的约定修改第18章的对话节奏。",
    priorConversationHistory: [
      {
        role: "user",
        content: "先定一条：第18章不要写任何关于铜钥匙的对白。",
        createdAt: "2026-11-22T10:00:00.000Z"
      },
      {
        role: "assistant",
        content: "好的，第18章不写铜钥匙对白。",
        createdAt: "2026-11-22T10:01:00.000Z"
      },
      {
        role: "user",
        content:
          "撤回刚才那条关于第18章不能写铜钥匙对白的限制，第18章可以顺带提一句旧钥匙。",
        createdAt: "2026-11-22T11:00:00.000Z"
      }
    ],
    requiredEvidence: [
      {
        id: "chapter_18",
        document: "card",
        mustContain: "林岚与沈青在雾中核对码头线索"
      },
      {
        id: "chapter_18",
        document: "body",
        mustContain: "雾气从栈桥木缝里往上钻"
      }
    ],
    forbiddenInfo: [],
    oracleEvidenceText:
      "【人工证据】\n- 第18章章卡：林岚与沈青在雾中核对码头线索。\n- 第18章正文：雾气从栈桥木缝里往上钻。\n- 有效作者决定：已撤回“第18章不写铜钥匙对白”，现允许第18章顺带提及旧钥匙。",
    expectedBehavior:
      "P0/P1 保留原话基线；P2 落地后需准确识别撤回状态并阻断旧限制复活。"
  },
  {
    id: "seed_08_missing_prior_and_distant_evidence",
    title: "前章未写缺口 + 远距伏笔回调（第21章）",
    category: "missing_prior_and_distant_evidence",
    activeRoot: "draft",
    activeChapterCardId: "chapter_21",
    targetChapterCardId: "chapter_21",
    prompt: "请起稿第21章《远港回声》开头，注意衔接前文并回调第5章那把钥匙。",
    requiredEvidence: [
      {
        id: "chapter_21",
        document: "card",
        mustContain: "废船舱门前尝试开锁"
      },
      {
        id: "chapter_18",
        document: "body",
        mustContain: "逼老船长交出缺失的页码"
      }
    ],
    forbiddenInfo: [
      {
        label: "第80章真相",
        pattern: "周明远才是幕后主使",
        sourceKind: "future_chapter"
      }
    ],
    oracleEvidenceText:
      "【人工证据】\n- 第21章章卡：林岚在废船舱门前尝试开锁。\n- 缺口说明：第19章、第20章尚未起稿，最近已写正文为第18章结尾：逼老船长交出缺失的页码。\n- 远距伏笔：第5章捡到的缺齿铜钥匙（第三道齿纹被磨平）。",
    expectedBehavior:
      "公开标注第19/20章未写缺口，回溯引用最近已写的第18章结尾并注明位置。"
  }
];
