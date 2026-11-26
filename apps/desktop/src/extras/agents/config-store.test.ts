import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_REVISION_METHOD,
  DEFAULT_STYLE_COMPARISON_METHOD,
  ExtrasAgentSettingsInputSchema
} from "@writer/contracts";
import { ExtrasAgentConfigStore } from "./config-store";
import { loadStyleComparisonMethods } from "@writer/contracts/renderer";
import { previousLongBookPrompts } from "./previous-long-book-prompts";
import { EXTRAS_AGENT_PROFILE_CATALOGS } from "./profile-catalogs";

const temporaryDirectories: string[] = [];

async function createStore(): Promise<{
  path: string;
  store: ExtrasAgentConfigStore;
}> {
  const path = await mkdtemp(join(tmpdir(), "writer-extras-config-"));
  temporaryDirectories.push(path);
  return { path, store: new ExtrasAgentConfigStore(path) };
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value), "utf8");
}

const longDefaults =
  EXTRAS_AGENT_PROFILE_CATALOGS["long-book-analysis"].defaults;

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true }))
  );
});

describe("extras agent config store", () => {
  it.each([
    "short-book-analysis",
    "long-book-analysis",
    "long-book-decomposition"
  ] as const)(
    "previews %s defaults without writing or replacing saved settings",
    async (agentId) => {
      const { path, store } = await createStore();
      const initial = await store.list(agentId);
      await store.save(
        ExtrasAgentSettingsInputSchema.parse({
          agentId,
          profiles: initial.profiles.map(
            ({ builtin: _builtin, ...profile }) => ({
              ...profile,
              name: `Edited ${profile.name}`
            })
          )
        })
      );
      const configPath = join(
        path,
        "config",
        "extras-agents",
        `${agentId}.json`
      );
      const before = await readFile(configPath, "utf8");
      const defaults = await store.reset(agentId, undefined, true);
      expect(defaults.profiles.map((profile) => profile.name)).toEqual(
        initial.profiles.map((profile) => profile.name)
      );
      expect(await readFile(configPath, "utf8")).toBe(before);
      expect((await store.list(agentId)).profiles[0]!.name).toContain("Edited");
    }
  );
  it("provides the built-in profiles of every extras agent", async () => {
    const { store } = await createStore();
    const long = await store.list("long-book-analysis");
    expect(long.profiles.map((profile) => profile.name)).toEqual([
      "剧情结构",
      "人物",
      "文风"
    ]);
    expect(long.profiles.every((profile) => profile.builtin)).toBe(true);
    expect(longDefaults[0]!.systemPrompt).toContain("大剧情");
    expect(longDefaults[0]!.systemPrompt).toContain("全局剧情设计图");
    expect(longDefaults[1]!.systemPrompt).toContain("主要人物动力学卡");
    expect(longDefaults[2]!.systemPrompt).toContain("可直接调用的文风指令");
    for (const profile of long.profiles) {
      expect(profile.systemPrompt).toContain("write_analysis_note");
      expect(profile.systemPrompt).toContain("write_analysis_result");
    }
    expect(
      (await store.list("short-book-analysis")).profiles.map(
        (profile) => profile.selectionMode
      )
    ).toEqual(["single", "single", "single"]);
    const character = (await store.resolve("short-book-analysis", "character"))
      .systemPrompt;
    expect(character).toContain("主角动力学建模卡");
    expect(character).toContain("核心对抗方动力学建模卡");
    expect(character).toContain("核心张力关系网与权力天平");
    expect(character).toContain("功能型工具人物生态位");
    expect(character).not.toContain("请提供待拆解");
    expect((await store.list("revision-analysis")).profiles).toMatchObject([
      { id: "default", systemPrompt: DEFAULT_REVISION_METHOD, builtin: true }
    ]);
    expect((await store.list("style-comparison")).profiles).toMatchObject([
      {
        id: "default",
        systemPrompt: DEFAULT_STYLE_COMPARISON_METHOD,
        builtin: true
      }
    ]);
  });

  it("serializes concurrent saves and can restore one modified default", async () => {
    const { store } = await createStore();
    const defaults = (await store.list("long-book-analysis")).profiles.map(
      ({ builtin: _builtin, ...profile }) => profile
    );
    const edited = (suffix: string) =>
      defaults.map((profile) => ({
        ...profile,
        description: `${profile.description} ${suffix}`
      }));
    await Promise.all([
      store.save({ agentId: "long-book-analysis", profiles: edited("A") }),
      store.save({ agentId: "long-book-analysis", profiles: edited("B") })
    ]);
    expect(
      (
        await store.list("long-book-analysis")
      ).profiles[0]?.description.endsWith("B")
    ).toBe(true);
    const reset = await store.reset("long-book-analysis", "plot-structure");
    expect(reset.profiles[0]).toMatchObject({
      description: longDefaults[0]!.description
    });
    await expect(store.reset("long-book-analysis", "custom")).rejects.toThrow(
      "没有可恢复的默认版本"
    );
  });

  it("merges concurrent edits to different profiles", async () => {
    const { store } = await createStore();
    const baseline = (await store.list("long-book-analysis")).profiles.map(
      ({ builtin: _builtin, ...profile }) => profile
    );
    const first = baseline.map((profile, index) =>
      index === 0 ? { ...profile, description: "窗口 A 的修改" } : profile
    );
    const second = baseline.map((profile, index) =>
      index === 1 ? { ...profile, description: "窗口 B 的修改" } : profile
    );

    await Promise.all([
      store.save({
        agentId: "long-book-analysis",
        profiles: first,
        baseProfiles: baseline
      }),
      store.save({
        agentId: "long-book-analysis",
        profiles: second,
        baseProfiles: baseline
      })
    ]);

    expect((await store.list("long-book-analysis")).profiles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: baseline[0]!.id,
          description: "窗口 A 的修改"
        }),
        expect.objectContaining({
          id: baseline[1]!.id,
          description: "窗口 B 的修改"
        })
      ])
    );
  });

  it.each(["long-book-analysis", "short-book-analysis"] as const)(
    "reads legacy %s profiles without restoring default save destinations",
    async (agentId) => {
      const { path, store } = await createStore();
      const { builtin: _builtin, ...profile } = (await store.list(agentId))
        .profiles[0]!;
      const configPath = join(
        path,
        "config",
        "extras-agents",
        `${agentId}.json`
      );
      await writeJson(configPath, {
        version: 1,
        profiles: [
          {
            ...profile,
            id: "custom-analysis",
            name: "自定义拆书",
            output: { ...profile.output, libraryId: "legacy-library" }
          }
        ]
      });
      const resolved = await store.resolve(agentId, "custom-analysis");
      expect(resolved.systemPrompt).toBe(profile.systemPrompt);
      expect(resolved.output).toEqual(profile.output);
      expect(resolved.output).not.toHaveProperty("libraryId");
      const current = await store.list(agentId);
      await store.save(
        ExtrasAgentSettingsInputSchema.parse({
          agentId,
          profiles: current.profiles
        })
      );
      const saved = JSON.parse(await readFile(configPath, "utf8")) as {
        profiles: { id: string; output: object }[];
      };
      expect(
        saved.profiles.find((item) => item.id === "custom-analysis")?.output
      ).not.toHaveProperty("libraryId");
      await expect(store.resolve(agentId, "missing")).rejects.toThrow(
        "预设已不存在"
      );
    }
  );

  it("restores missing built-in profiles without overwriting edited defaults", async () => {
    const { store } = await createStore();
    const { builtin: _builtin, ...plot } = (
      await store.list("long-book-analysis")
    ).profiles.find((profile) => profile.id === "plot-structure")!;
    const saved = await store.save({
      agentId: "long-book-analysis",
      profiles: [{ ...plot, description: "保留用户修改后的剧情结构预设。" }]
    });
    expect(saved.profiles.map((profile) => profile.id)).toEqual([
      "character",
      "style",
      "plot-structure"
    ]);
    expect(saved.profiles.at(-1)).toMatchObject({
      description: "保留用户修改后的剧情结构预设。"
    });
  });

  it("upgrades saved long defaults while preserving edited and custom prompts", async () => {
    const { path, store } = await createStore();
    const profiles = (await store.list("long-book-analysis")).profiles.map(
      ({ builtin: _builtin, ...profile }) => profile
    );
    const configPath = join(
      path,
      "config",
      "extras-agents",
      "long-book-analysis.json"
    );
    await writeJson(configPath, {
      version: 1,
      profiles: [
        ...profiles.map((profile) => ({
          ...profile,
          systemPrompt: previousLongBookPrompts[profile.id]
        })),
        {
          ...profiles[0],
          id: "custom-plot",
          name: "自定义剧情",
          systemPrompt: "我的长篇拆书方法"
        }
      ]
    });

    const upgraded = await store.list("long-book-analysis");
    for (const builtin of longDefaults) {
      expect(
        upgraded.profiles.find((profile) => profile.id === builtin.id)
          ?.systemPrompt
      ).toBe(builtin.systemPrompt.trim());
    }
    expect(upgraded.profiles.at(-1)?.systemPrompt).toBe("我的长篇拆书方法");

    const edited = upgraded.profiles.map(({ builtin: _builtin, ...profile }) =>
      profile.id === "character"
        ? { ...profile, systemPrompt: "用户修改的人物卡提示词" }
        : profile
    );
    await store.save({ agentId: "long-book-analysis", profiles: edited });
    expect(
      (await store.resolve("long-book-analysis", "character")).systemPrompt
    ).toBe("用户修改的人物卡提示词");

    await writeJson(configPath, {
      version: 1,
      profiles: profiles.map((profile) => ({
        ...profile,
        systemPrompt:
          profile.id === "style"
            ? "用户原先修改的文风提示词"
            : previousLongBookPrompts[profile.id]
      }))
    });
    expect(
      (await store.resolve("long-book-analysis", "style")).systemPrompt
    ).toBe("用户原先修改的文风提示词");
  });

  it("preserves edited short plot methods even without the old revision marker", async () => {
    const { path, store } = await createStore();
    const original = (await store.list("short-book-analysis")).profiles.map(
      ({ builtin: _builtin, ...profile }) => profile
    );
    const configPath = join(
      path,
      "config",
      "extras-agents",
      "short-book-analysis.json"
    );
    await writeJson(configPath, {
      version: 1,
      profiles: [
        {
          ...original[0],
          systemPrompt: "旧版用户修改的剧情提示词",
          description: "保留剧情预设的其他设置"
        },
        ...original.slice(1),
        {
          ...original[0],
          id: "custom-plot",
          name: "自定义剧情",
          systemPrompt: "保留自定义提示词"
        }
      ]
    });

    const upgraded = await store.list("short-book-analysis");
    expect(upgraded.profiles[0]).toMatchObject({
      description: "保留剧情预设的其他设置",
      systemPrompt: "旧版用户修改的剧情提示词"
    });
    expect(upgraded.profiles.at(-1)?.systemPrompt).toBe("保留自定义提示词");
    expect(upgraded.profiles[1]?.systemPrompt).toBe(original[1]?.systemPrompt);

    const edited = upgraded.profiles.map(({ builtin: _builtin, ...profile }) =>
      profile.id === "plot-structure"
        ? { ...profile, systemPrompt: "升级后新改的剧情提示词" }
        : profile
    );
    await store.save({ agentId: "short-book-analysis", profiles: edited });
    expect(
      (await store.list("short-book-analysis")).profiles[0]?.systemPrompt
    ).toBe("升级后新改的剧情提示词");
    expect(JSON.parse(await readFile(configPath, "utf8"))).toMatchObject({
      promptRevisions: { "plot-structure": 1 }
    });
  });

  it("resolves an untouched prior packaging method while keeping the author's settings and copies", async () => {
    const { path, store } = await createStore();
    const original =
      "第一句就是钩子。交代主角是谁、处境是什么、想要什么与阻碍是什么，突出一两个高光看点，结尾留悬念，不剧透结局。符合目标字数，并与采用书名呼应。一轮覆盖悬念、爽点、情感、人设与世界观等角度。";
    const preset = await store.resolve("book-synopsis-design", "default");
    const customized = { ...preset, targetLength: 150, systemPrompt: original };
    const configPath = join(
      path,
      "config",
      "extras-agents",
      "book-synopsis-design.json"
    );
    await writeJson(configPath, {
      version: 1,
      profiles: [
        customized,
        { ...customized, id: "my-copy", name: "我的简介方法" }
      ]
    });
    expect(
      await store.resolve("book-synopsis-design", "default")
    ).toMatchObject({
      targetLength: 150,
      systemPrompt: preset.systemPrompt
    });
    expect(
      (await store.resolve("book-synopsis-design", "my-copy")).systemPrompt
    ).toBe(original);
    await writeJson(configPath, {
      version: 1,
      profiles: [{ ...customized, systemPrompt: `${original} 用第一人称。` }]
    });
    expect(
      (await store.resolve("book-synopsis-design", "default")).systemPrompt
    ).toBe(`${original} 用第一人称。`);
  });

  it("upgrades only the unchanged older short character prompt", async () => {
    const { path, store } = await createStore();
    const current = (await store.list("short-book-analysis")).profiles.find(
      (profile) => profile.id === "character"
    )!;
    const oldPrompt =
      "你是短篇拆书分析师。基于完整短篇，分析人物目标、冲突、关系、关键选择及人物弧光，提炼可复用的人物设计方法。多本输入时比较共性与差异，并标明书名证据。";
    const configPath = join(
      path,
      "config",
      "extras-agents",
      "short-book-analysis.json"
    );
    await writeJson(configPath, {
      version: 1,
      profiles: [{ ...current, systemPrompt: oldPrompt }]
    });
    expect(
      (await store.resolve("short-book-analysis", "character")).systemPrompt
    ).toBe(current.systemPrompt);

    await writeJson(configPath, {
      version: 1,
      profiles: [{ ...current, systemPrompt: "用户修改的人物拆书提示词" }]
    });
    expect(
      (await store.resolve("short-book-analysis", "character")).systemPrompt
    ).toBe("用户修改的人物拆书提示词");
  });

  it("falls back safely when the persisted JSON is damaged", async () => {
    const { path, store } = await createStore();
    const configPath = join(
      path,
      "config",
      "extras-agents",
      "long-book-analysis.json"
    );
    await mkdir(dirname(configPath), { recursive: true });
    await writeFile(configPath, "{damaged", "utf8");
    expect((await store.list("long-book-analysis")).profiles).toHaveLength(3);
    expect(await readFile(configPath, "utf8")).toBe("{damaged");
  });

  it("reads each agent's pre-unification settings until the first save", async () => {
    const { path, store } = await createStore();
    const customShort = {
      id: "custom",
      name: "自定义",
      description: "旧版本保存的预设",
      systemPrompt: "旧提示词",
      selectionMode: "multiple",
      output: { domain: "material", kind: "plot", stageId: "pacing" }
    };
    const legacyShort = join(
      path,
      "config",
      "short-book-analysis-presets.json"
    );
    await writeJson(legacyShort, { version: 1, presets: [customShort] });
    await writeJson(join(path, "revision-analysis-settings.json"), {
      systemPrompt: "旧的修改分析方法"
    });

    const short = await store.list("short-book-analysis");
    expect(short.profiles.map((profile) => profile.id)).toEqual([
      "plot-structure",
      "character",
      "style",
      "custom"
    ]);
    expect(
      (await store.resolve("revision-analysis", "default")).systemPrompt
    ).toBe("旧的修改分析方法");

    const { builtin: _builtin, ...custom } = short.profiles.at(-1)!;
    await store.save({
      agentId: "short-book-analysis",
      profiles: [{ ...custom, name: "改名后" }]
    });
    await writeJson(legacyShort, { version: 1, presets: [] });
    expect(
      (await store.list("short-book-analysis")).profiles.at(-1)?.name
    ).toBe("改名后");
    expect(
      JSON.parse(
        await readFile(
          join(path, "config", "extras-agents", "short-book-analysis.json"),
          "utf8"
        )
      )
    ).toMatchObject({ version: 1 });
  });

  it("allows an empty comparison method but not an empty revision method", async () => {
    const { store } = await createStore();
    const style = await store.save({
      agentId: "style-comparison",
      profiles: [
        {
          id: "default",
          name: "文风比对",
          description: "测试",
          systemPrompt: ""
        }
      ]
    });
    expect(style.profiles[0]?.systemPrompt).toBe("");
    await expect(
      store.save({
        agentId: "revision-analysis",
        profiles: [
          {
            id: "default",
            name: "修改分析",
            description: "测试",
            systemPrompt: " "
          }
        ]
      })
    ).rejects.toThrow();
  });

  it("updates old default review methods from both settings stores", async () => {
    const { path, store } = await createStore();
    const oldRevision = [
      "你是修改分析智能体。阅读修改前后完整正文，优先学习用户在修改后版本中表现的目标和偏好，并以用户填写的修改理由为优先依据。",
      "分析报告应包含修改概览、各差异组的变化及作用、用户修改偏好和可复用修改方向；结论引用差异编号。",
      "未提供理由时明确标注动机为推断，不虚构用户意图；单次局部修改限定适用条件，不泛化为通用定律。",
      "同时生成能脱离本次文档独立使用的技能：提供技能标题、简短描述（说明用途与适用场景）和正文；正文包含适用场景、修改目标、具体规则、执行步骤、检查清单和少量前后示例。避免大段照抄正文。"
    ].join("\r\n");
    await writeJson(join(path, "revision-analysis-settings.json"), {
      systemPrompt: oldRevision
    });
    expect(
      (await store.resolve("revision-analysis", "default")).systemPrompt
    ).toBe(DEFAULT_REVISION_METHOD);

    const { PREVIOUS_DEFAULT_STYLE_COMPARISON_METHOD } =
      await loadStyleComparisonMethods();
    const original = await store.resolve("style-comparison", "default");
    const configPath = join(
      path,
      "config",
      "extras-agents",
      "style-comparison.json"
    );
    await writeJson(configPath, {
      version: 1,
      profiles: [
        { ...original, systemPrompt: PREVIOUS_DEFAULT_STYLE_COMPARISON_METHOD }
      ]
    });
    expect(
      (await store.resolve("style-comparison", "default")).systemPrompt
    ).toBe(DEFAULT_STYLE_COMPARISON_METHOD);
    const custom = `${PREVIOUS_DEFAULT_STYLE_COMPARISON_METHOD}\n只分析对白。`;
    await writeJson(configPath, {
      version: 1,
      profiles: [{ ...original, systemPrompt: custom }]
    });
    expect(
      (await store.resolve("style-comparison", "default")).systemPrompt
    ).toBe(custom);
  });
});
