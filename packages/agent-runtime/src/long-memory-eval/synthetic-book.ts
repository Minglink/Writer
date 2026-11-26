import { createHash } from "node:crypto";
import {
  DEFAULT_LONG_AGENT_PROFILES,
  LONG_BOOK_LINE_FILE_ID,
  LONG_CHARACTER_OVERVIEW_FILE_ID,
  LONG_CHARACTER_OVERVIEW_PATH,
  LongWorkspaceIndexSnapshotSchema,
  createLongWorkspaceNavigationSnapshot,
  longChapterBodyFileId,
  longChapterCardFileId,
  longChapterCharacterStateFileId,
  longChapterContinuityFilePath,
  longChapterForeshadowingChangesFileId,
  longChapterHandoffFileId,
  longCharacterCoreProfileFileId,
  longCharacterRelationshipsFileId,
  longLedgerCommitFileId,
  longWorldbuildingFileId,
  type LongAgentProfile,
  type LongWorkspaceFileReference,
  type LongWorkspaceIndexSnapshot,
  type LongWorkspaceRoot,
  type LongWorkspaceRuntimeContext
} from "@writer/contracts";
import type {
  LongCommandExecutor,
  LongQueryCommandEnvelope
} from "../long-agent-tools";

export const SYNTHETIC_BOOK_ID = "longbook_eval_wugang";
export const BASE_TS = "2026-11-20T10:00:00.000Z";
export const REWRITTEN_CH17_TS = "2026-11-24T09:30:00.000Z";
export const CH80_TS = "2026-11-23T20:00:00.000Z";

export interface SyntheticChapterSpec {
  id: string;
  volumeId: string;
  arcId: string;
  title: string;
  narrativeOrder: number;
  card: string;
  body: string;
  handoff?: string;
  characterState?: string;
  updatedAt?: string;
  commitId?: string | null;
}

export interface SyntheticLongBook {
  bookId: string;
  title: string;
  index: LongWorkspaceIndexSnapshot;
  files: Map<string, { ref: LongWorkspaceFileReference; content: string }>;
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function fileRef(
  id: string,
  path: string,
  updatedAt = BASE_TS
): LongWorkspaceFileReference {
  return { id, path, updatedAt };
}

export interface SyntheticBookOptions {
  /** Simulates rewriting chapter 17 after commit_b2 was already archived. */
  rewriteChapter17?: boolean;
}

export function createSyntheticLongBook(
  options: SyntheticBookOptions = {}
): SyntheticLongBook {
  const ch17OldBody =
    "雨点砸在码头栈桥上。沈青蹲在火盆边，将那封盖着港务印章的信封丢进炭火，看着火舌吞掉最后一行数字。林岚从雾里走来，只闻到焦纸味。";
  const ch17NewBody =
    "雨点砸在码头栈桥上。沈青没有烧掉信封，而是把半截残缺的船票折成方块，悄悄塞进锈迹斑斑的灯笼底座，转身对赶来的林岚说：“账簿不在船长手里。”";
  const ch17Body = options.rewriteChapter17 ? ch17NewBody : ch17OldBody;
  const ch17UpdatedAt = options.rewriteChapter17 ? REWRITTEN_CH17_TS : BASE_TS;

  const chapters: SyntheticChapterSpec[] = [
    {
      id: "chapter_01",
      volumeId: "volume_1",
      arcId: "arc_harbor",
      title: "第1章 盐雾码头",
      narrativeOrder: 1,
      card: "## 本章目标\n林岚初到雾港，发现港务账目缺页。\n## 写作上下文\n- 视角：林岚\n- 氛围：咸湿海风、煤油灯影。",
      body: "十月的雾港像一口扣在海面上的铁锅。林岚拎着旧皮箱踏上木栈桥，码头巡夜人提着一盏缺角的铜灯笼从她身旁擦过。",
      commitId: "commit_b1"
    },
    {
      id: "chapter_05",
      volumeId: "volume_1",
      arcId: "arc_harbor",
      title: "第5章 铜钥匙的旧账",
      narrativeOrder: 2,
      card: "## 本章目标\n林岚在仓库抽屉里捡到一把旧铜钥匙，注意到钥匙齿纹少了一道。\n## 写作上下文\n- 伏笔：铜钥匙齿纹少了一道（后续远距回调）。",
      body: "林岚把煤油灯凑近桌面，那把旧铜钥匙躺在霉味很重的抽屉底层。她用指腹摩挲齿口，发现从尖端数第三道齿纹被人用锉刀磨平了。",
      handoff:
        "第5章末状态：林岚已收好缺齿铜钥匙；老船长拒绝配合盘账；仓库守卫对灯笼底座讳莫如深。",
      characterState: "林岚：持有缺齿铜钥匙，怀疑老船长私吞账本。",
      commitId: "commit_b1"
    },
    {
      id: "chapter_15",
      volumeId: "volume_1",
      arcId: "arc_harbor",
      title: "第15章 钟楼暗格",
      narrativeOrder: 3,
      card: "## 本章目标\n林岚与沈青夜探钟楼外墙，发现暗格已被人提前清空。",
      body: "钟楼二层的木板松动了一块，里面只剩半圈新鲜的蜡油，说明不久前才有人带走了原本藏在这里的物件。",
      commitId: "commit_b2"
    },
    {
      id: "chapter_16",
      volumeId: "volume_1",
      arcId: "arc_harbor",
      title: "第16章 潮汐账簿",
      narrativeOrder: 4,
      card: "## 本章目标\n沈青带来半本受潮的货单，指向码头夜班船只。\n## 写作上下文\n- 视角：林岚\n- 前情：刚离开钟楼，尚未去码头。",
      body: "油灯下，潮汐账簿的墨迹晕成了灰蓝色。沈青指着九月十七日那一页：“那天根本没有官方货轮进港，可吊机记录却多出三趟。”",
      commitId: "commit_b2"
    },
    {
      id: "chapter_17",
      volumeId: "volume_1",
      arcId: "arc_harbor",
      title: "第17章 码头雨夜",
      narrativeOrder: 5,
      card: "## 本章目标\n沈青在码头雨夜处理证据，林岚赶到现场。\n## 写作上下文\n- 承接第16章潮汐账簿线索。",
      body: ch17Body,
      handoff:
        "第17章末交接（commit_b2 归档版）：沈青在码头火盆烧毁了港务信封，林岚只闻到焦纸味，两人约定天亮去质问老船长。",
      characterState: "林岚：未看到信封内容，仍怀疑老船长。沈青：情绪紧绷。",
      updatedAt: ch17UpdatedAt,
      commitId: "commit_b2"
    },
    {
      id: "chapter_18",
      volumeId: "volume_1",
      arcId: "arc_harbor",
      title: "第18章 雾中对质",
      narrativeOrder: 6,
      card: [
        "## 本章目标",
        "林岚与沈青在雾中核对码头线索，准备天亮后去找老船长对质。",
        "## 写作上下文",
        "- 视角：林岚（此时只掌握潮汐账簿与第17章码头现场情况，仍误以为老船长私吞账本）",
        "- 禁止透露：周明远是幕后主使、第80章钟楼密室真相、周明远调换铜钥匙",
        "- 承接：紧接第17章结尾，不要写破第80章才揭晓的幕后主使身份。"
      ].join("\n"),
      body: "雾气从栈桥木缝里往上钻，林岚拢紧大衣袖口，盯着灯影里晃动的潮水，心里盘算着天亮后如何逼老船长交出缺失的页码。",
      commitId: null
    },
    {
      id: "chapter_19",
      volumeId: "volume_1",
      arcId: "arc_harbor",
      title: "第19章 空船离港",
      narrativeOrder: 7,
      card: [
        "## 本章目标",
        "清晨雾散，林岚赶到三号泊位，发现老船长的拖轮已经解缆离港。",
        "## 写作上下文",
        "- 视角：林岚",
        "- 前情：紧接第18章雾中对质后的清晨行动。"
      ].join("\n"),
      body: "",
      commitId: null
    },
    {
      id: "chapter_20",
      volumeId: "volume_1",
      arcId: "arc_harbor",
      title: "第20章 断桥余烬",
      narrativeOrder: 8,
      card: "## 本章目标\n过渡章：断桥南侧起火，封锁港务通道。（尚未起稿）",
      body: "",
      commitId: null
    },
    {
      id: "chapter_21",
      volumeId: "volume_1",
      arcId: "arc_harbor",
      title: "第21章 远港回声",
      narrativeOrder: 9,
      card: [
        "## 本章目标",
        "林岚在废船舱门前尝试开锁，回忆起第5章那把缺齿铜钥匙。",
        "## 写作上下文",
        "- 伏笔回调：第5章捡到的缺齿铜钥匙（第三道齿纹被磨平）。"
      ].join("\n"),
      body: "",
      commitId: null
    },
    {
      id: "chapter_80",
      volumeId: "volume_2",
      arcId: "arc_truth",
      title: "第80章 幕后之人",
      narrativeOrder: 1,
      card: "## 本章目标\n钟楼密室摊牌，揭晓周明远才是幕后主使。",
      body: "钟声震落梁上积灰。周明远慢条斯理地摘下手套：“从第5章我亲自磨平那把铜钥匙的第三道齿纹开始，老船长就只是替我背锅的幌子。”",
      handoff:
        "第80章末交接：幕后主使已揭晓为周明远，老船长早已洗清嫌疑，林岚掌握全部真相。",
      characterState: "林岚：已彻底查明周明远是幕后主使。",
      updatedAt: CH80_TS,
      commitId: "commit_b80"
    }
  ];

  const files = new Map<
    string,
    { ref: LongWorkspaceFileReference; content: string }
  >();
  const register = (ref: LongWorkspaceFileReference, content: string) => {
    files.set(ref.id, { ref, content });
    return ref;
  };

  const bookLine = register(
    fileRef(LONG_BOOK_LINE_FILE_ID, "long/plot/book-line.md"),
    "《雾港钟声》全书主线：审计员林岚追查雾港走私账目，逐步揭开港口权力网络。"
  );
  const worldRules = register(
    fileRef(
      longWorldbuildingFileId("world_harbor"),
      "long/worldbuilding/harbor.md"
    ),
    "雾港每年十月进入大雾季，港务局实行夜间封港令。"
  );
  const charOverview = register(
    fileRef(LONG_CHARACTER_OVERVIEW_FILE_ID, LONG_CHARACTER_OVERVIEW_PATH),
    "林岚：审计员；沈青：码头书记员；老船长：三号拖轮船长；周明远：港务局副局长。"
  );
  const linlanCore = register(
    fileRef(
      longCharacterCoreProfileFileId("character_linlan"),
      "long/characters/linlan/core-profile.md"
    ),
    "林岚，冷静克制，习惯先核对纸面证据再下判断。"
  );
  const linlanRel = register(
    fileRef(
      longCharacterRelationshipsFileId("character_linlan"),
      "long/characters/linlan/relationships.md"
    ),
    "与沈青是临时合作关系，对港务局高层保持警惕。"
  );

  const chapterEntries = chapters.map((spec) => {
    const ts = spec.updatedAt ?? BASE_TS;
    const body = register(
      fileRef(
        longChapterBodyFileId(spec.id),
        `long/chapters/${spec.id}/body.md`,
        ts
      ),
      spec.body
    );
    const card = register(
      fileRef(
        longChapterCardFileId(spec.id),
        `long/chapters/${spec.id}/card.md`,
        BASE_TS
      ),
      spec.card
    );
    const characterState = register(
      fileRef(
        longChapterCharacterStateFileId(spec.id),
        `long/chapters/${spec.id}/character-state.md`,
        BASE_TS
      ),
      spec.characterState ?? ""
    );
    const handoff = register(
      fileRef(
        longChapterHandoffFileId(spec.id),
        `long/chapters/${spec.id}/handoff.md`,
        BASE_TS
      ),
      spec.handoff ?? ""
    );
    const foreshadowingChanges = register(
      fileRef(
        longChapterForeshadowingChangesFileId(spec.id),
        longChapterContinuityFilePath(spec.id, "foreshadowing-changes.md"),
        BASE_TS
      ),
      ""
    );
    return {
      chapterCardId: spec.id,
      body,
      card,
      characterState,
      handoff,
      foreshadowingChanges,
      worldReveals: null,
      characterContinuity: [],
      bodyStatus: spec.body.trim() ? ("written" as const) : ("empty" as const),
      commitId: spec.commitId ?? null
    };
  });

  const commitB1File = register(
    fileRef(longLedgerCommitFileId("commit_b1"), "long/ledger/commit_b1.json"),
    "{}"
  );
  const commitB2File = register(
    fileRef(longLedgerCommitFileId("commit_b2"), "long/ledger/commit_b2.json"),
    "{}"
  );
  const commitB80File = register(
    fileRef(
      longLedgerCommitFileId("commit_b80"),
      "long/ledger/commit_b80.json",
      CH80_TS
    ),
    "{}"
  );

  const index = LongWorkspaceIndexSnapshotSchema.parse({
    schemaVersion: 1,
    bookId: SYNTHETIC_BOOK_ID,
    updatedAt: options.rewriteChapter17 ? REWRITTEN_CH17_TS : CH80_TS,
    bookLine,
    worldbuilding: [
      {
        id: "world_harbor",
        title: "雾港制度",
        order: 1,
        format: "text",
        contentAuthority: "markdown",
        file: worldRules
      }
    ],
    characterOverview: charOverview,
    characters: [
      {
        id: "character_linlan",
        name: "林岚",
        group: "protagonist",
        order: 1,
        aliases: ["林审计"]
      }
    ],
    characterFiles: [
      {
        characterId: "character_linlan",
        coreProfile: linlanCore,
        relationships: linlanRel
      }
    ],
    plot: {
      volumes: [
        {
          id: "volume_1",
          title: "第一卷 潮汐暗账",
          order: 1,
          summary: "追查雾港失踪货单。"
        },
        {
          id: "volume_2",
          title: "第二卷 钟声真相",
          order: 2,
          summary: "揭开港务局幕后黑手。"
        }
      ],
      arcs: [
        {
          id: "arc_harbor",
          volumeId: "volume_1",
          title: "码头暗账线",
          order: 1,
          outline: ""
        },
        {
          id: "arc_truth",
          volumeId: "volume_2",
          title: "钟楼真相线",
          order: 1,
          outline: ""
        }
      ],
      chapterCards: chapters.map((spec) => ({
        id: spec.id,
        volumeId: spec.volumeId,
        primaryArcId: spec.arcId,
        title: spec.title,
        narrativeOrder: spec.narrativeOrder
      })),
      storyEvents: [],
      storyPlots: [],
      eventConnections: [],
      narrativePlacements: [],
      foreshadowing: [
        {
          id: "foreshadow_key",
          title: "缺齿铜钥匙",
          coreQuestion: "第5章捡到的缺齿铜钥匙究竟被谁磨平了第三道齿纹？",
          truthEventId: null,
          expectedReaderEffect:
            "第21章废船试锁时呼应第5章细节，第80章揭晓幕后真相。",
          status: "open",
          beats: [
            {
              id: "beat_key_plant",
              type: "plant",
              order: 1,
              eventId: null,
              placementId: null,
              chapterCardId: "chapter_05",
              plannedScope: "第一卷",
              note: "抽屉里发现缺齿铜钥匙，第三道齿纹被磨平",
              status: "committed",
              commitId: "commit_b1"
            },
            {
              id: "beat_key_payoff",
              type: "payoff",
              order: 2,
              eventId: null,
              placementId: null,
              chapterCardId: "chapter_21",
              plannedScope: "第一卷",
              note: "废船舱门试锁回调缺齿特征",
              status: "planned",
              commitId: null
            }
          ]
        }
      ]
    },
    chapters: chapterEntries,
    ledger: {
      committedThroughChapterId: "chapter_17",
      commits: [
        {
          id: "commit_b1",
          mode: "text_files_batch",
          sequence: 1,
          chapterCardId: "chapter_05",
          chapterCardIds: ["chapter_01", "chapter_05"],
          checkpointChapterCardId: "chapter_05",
          committedAt: BASE_TS,
          bodyEvidence: [
            { chapterCardId: "chapter_01", sha256: sha256(chapters[0]!.body) },
            { chapterCardId: "chapter_05", sha256: sha256(chapters[1]!.body) }
          ],
          placementIds: [],
          foreshadowingBeatIds: ["beat_key_plant"],
          recordFile: commitB1File
        },
        {
          id: "commit_b2",
          mode: "text_files_batch",
          sequence: 2,
          chapterCardId: "chapter_17",
          chapterCardIds: ["chapter_15", "chapter_16", "chapter_17"],
          checkpointChapterCardId: "chapter_17",
          committedAt: BASE_TS,
          bodyEvidence: [
            { chapterCardId: "chapter_15", sha256: sha256(chapters[2]!.body) },
            { chapterCardId: "chapter_16", sha256: sha256(chapters[3]!.body) },
            { chapterCardId: "chapter_17", sha256: sha256(ch17OldBody) }
          ],
          ...(options.rewriteChapter17
            ? { changedChapterIds: ["chapter_17"] }
            : {}),
          placementIds: [],
          foreshadowingBeatIds: [],
          recordFile: commitB2File
        },
        {
          id: "commit_b80",
          mode: "text_files_batch",
          sequence: 3,
          chapterCardId: "chapter_80",
          chapterCardIds: ["chapter_80"],
          checkpointChapterCardId: "chapter_80",
          committedAt: CH80_TS,
          bodyEvidence: [
            { chapterCardId: "chapter_80", sha256: sha256(chapters[9]!.body) }
          ],
          placementIds: [],
          foreshadowingBeatIds: [],
          recordFile: commitB80File
        }
      ]
    }
  });

  return {
    bookId: SYNTHETIC_BOOK_ID,
    title: "雾港钟声",
    index,
    files
  };
}

export function createSyntheticLongProfile(
  readableRoots?: readonly LongWorkspaceRoot[]
): LongAgentProfile {
  const base = DEFAULT_LONG_AGENT_PROFILES[0]!;
  if (!readableRoots) return structuredClone(base);
  return {
    ...structuredClone(base),
    readAccess: {
      ...base.readAccess,
      workspaceRoots: [...readableRoots]
    }
  };
}

export function createSyntheticRuntimeContext(
  book: SyntheticLongBook,
  options: {
    activeRoot?: LongWorkspaceRoot;
    activeChapterCardId?: string;
    agentsMd?: string;
    profile?: LongAgentProfile;
  } = {}
): LongWorkspaceRuntimeContext {
  const profile = options.profile ?? createSyntheticLongProfile();
  return {
    bookId: book.bookId,
    title: book.title,
    activeRoot: options.activeRoot ?? "draft",
    activeAgentId: profile.id,
    ...(options.activeChapterCardId
      ? { activeChapterCardId: options.activeChapterCardId }
      : {}),
    ...(options.agentsMd ? { agentsMd: options.agentsMd } : {}),
    navigation: createLongWorkspaceNavigationSnapshot(book.index)
  };
}

export interface SyntheticExecutorHooks {
  onCommand?: (command: LongQueryCommandEnvelope) => void;
  delayMs?: number;
  failFileIds?: ReadonlySet<string>;
}

export function createSyntheticLongCommandExecutor(
  book: SyntheticLongBook,
  hooks: SyntheticExecutorHooks = {}
): LongCommandExecutor {
  return async (command, signal) => {
    signal?.throwIfAborted();
    hooks.onCommand?.(command);
    if (hooks.delayMs && hooks.delayMs > 0) {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, hooks.delayMs);
        signal?.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            reject(signal.reason ?? new Error("Aborted"));
          },
          { once: true }
        );
      });
    }
    signal?.throwIfAborted();

    if (command.type === "long.getWorkspaceIndex") {
      if (command.payload.bookId !== book.bookId) {
        return {
          requestId: command.id,
          status: "rejected",
          error: {
            code: "long.book_mismatch",
            message: "Book mismatch"
          }
        };
      }
      return {
        requestId: command.id,
        status: "accepted",
        payload: {
          bookId: book.bookId,
          workspaceIndex: structuredClone(book.index)
        }
      };
    }

    if (command.type === "long.readDocument") {
      const entry = book.files.get(command.payload.fileId);
      if (!entry || hooks.failFileIds?.has(command.payload.fileId)) {
        return {
          requestId: command.id,
          status: "rejected",
          error: {
            code: "long.document_unavailable",
            message: `Document unavailable: ${command.payload.fileId}`
          }
        };
      }
      const chars = Array.from(entry.content);
      const offset = command.payload.offset ?? 0;
      const maxCharacters = command.payload.maxCharacters ?? chars.length;
      const slice = chars.slice(offset, offset + maxCharacters).join("");
      const nextOffset =
        offset + maxCharacters < chars.length ? offset + maxCharacters : null;
      return {
        requestId: command.id,
        status: "accepted",
        payload: {
          bookId: book.bookId,
          file: { ...entry.ref },
          content: slice,
          offset,
          nextOffset,
          totalCharacters: chars.length
        }
      };
    }

    if (command.type === "long.readAgentsMd") {
      return {
        requestId: command.id,
        status: "accepted",
        payload: {
          bookId: book.bookId,
          content: "",
          truncated: false
        }
      };
    }

    const query = command.payload.query.trim();
    const hits = [...book.files.values()]
      .filter((entry) => query && entry.content.includes(query))
      .slice(0, 10)
      .map((entry) => ({
        fileId: entry.ref.id,
        path: entry.ref.path,
        snippet: entry.content.slice(0, 120)
      }));
    return {
      requestId: command.id,
      status: "accepted",
      payload: {
        bookId: book.bookId,
        query,
        hits
      }
    };
  };
}
