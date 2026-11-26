import { mkdtemp, readFile, rm, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  WritingIndexSchema,
  WritingFileSchema,
  createShortWorkspaceContentRevision,
  DEFAULT_SCRIPT_WRITING_CONTEXT,
  DEFAULT_SHORT_WRITING_CONTEXT,
  portableBookSchema,
  WRITING_CONTEXT_MAX_CHARACTERS
} from "@writer/contracts";
import {
  FolderCatalogConflictError,
  FolderCatalogStore
} from "./folder-catalog-store";

const roots: string[] = [];

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "writer-writing-context-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

describe("FolderCatalogStore writing context", () => {
  it.each(["short", "script"] as const)(
    "reads only the registered %s work and its latest saved State file",
    async (bookType) => {
      const root = await temporaryRoot();
      const store = new FolderCatalogStore({
        userDataPath: join(root, "user-data")
      });
      const book = await (bookType === "short"
        ? store.createShortBook(
            { title: "测试", genre: "其他" },
            join(root, "books")
          )
        : store.createScriptBook(
            { title: "测试", genre: "其他" },
            join(root, "books")
          ));
      const scope = { bookType, bookId: book.resource.id };
      const read = (query: import("@writer/contracts").WritingReadQuery) =>
        store.readWritingWorkspace({ ...scope, query }, "run-test");
      const index = WritingIndexSchema.parse(await read({ mode: "index" }));
      const documentId = index.sections[0]!.characterState.id;
      const disabledStage = book.resource.plotStages.find(
        (stage) => !stage.enabled
      )!;
      await expect(
        read({ mode: "file", documentId: disabledStage.id })
      ).rejects.toThrow();
      expect(
        index.plotStages.some((stage) => stage.id === disabledStage.id)
      ).toBe(false);
      await expect(
        read({ mode: "file", documentId: "../other.md" })
      ).rejects.toThrow();
      await expect(
        store.readWritingWorkspace(
          {
            ...scope,
            bookType: bookType === "short" ? "script" : "short",
            query: { mode: "index" }
          },
          "run-test"
        )
      ).rejects.toThrow();
      const before = WritingFileSchema.parse(
        await read({ mode: "file", documentId })
      );
      await store.saveDocument({
        bookId: scope.bookId,
        documentId,
        content: "情感 转变",
        baseRevision: before.revision,
        baseProjectRevision: 0
      });
      const slice = WritingFileSchema.parse(
        await read({ mode: "file", documentId, offset: 3, limit: 2 })
      );
      expect(slice).toMatchObject({
        content: "转变",
        length: 5,
        characters: 4,
        revision: createShortWorkspaceContentRevision("情感 转变")
      });
      const directory = WritingIndexSchema.parse(
        await read({ mode: "index", counts: "draft" })
      );
      expect(directory.counts).toContainEqual({
        id: documentId,
        length: 5,
        characters: 4,
        revision: slice.revision
      });
      expect(JSON.stringify(directory)).not.toContain("情感 转变");
    }
  );

  it("initializes distinct AGENTS.md defaults for new short and script books", async () => {
    const root = await temporaryRoot();
    const store = new FolderCatalogStore({
      userDataPath: join(root, "user-data")
    });
    const short = await store.createShortBook(
      { title: "短篇测试", genre: "悬疑" },
      join(root, "books")
    );
    const script = await store.createScriptBook(
      { title: "剧本测试", genre: "其他" },
      join(root, "books")
    );

    await expect(
      readFile(join(short.projectDirectory, "AGENTS.md"), "utf8")
    ).resolves.toBe(DEFAULT_SHORT_WRITING_CONTEXT);
    await expect(
      readFile(join(script.projectDirectory, "AGENTS.md"), "utf8")
    ).resolves.toBe(DEFAULT_SCRIPT_WRITING_CONTEXT);
    await expect(
      store.readWritingContext({ bookId: short.resource.id })
    ).resolves.toMatchObject({
      workspaceType: "short",
      content: DEFAULT_SHORT_WRITING_CONTEXT,
      truncated: false
    });
    await expect(
      store.readWritingContext({ bookId: script.resource.id })
    ).resolves.toMatchObject({
      workspaceType: "script",
      content: DEFAULT_SCRIPT_WRITING_CONTEXT,
      truncated: false
    });
  });

  it("saves custom context and lazily repairs a missing legacy file", async () => {
    const root = await temporaryRoot();
    const store = new FolderCatalogStore({
      userDataPath: join(root, "user-data")
    });
    const book = await store.createShortBook(
      { title: "旧短篇", genre: "其他" },
      join(root, "books")
    );
    const custom = "# 我的短篇上下文\n\n结尾必须回收开场意象。\n";

    await expect(
      store.writeWritingContext({ bookId: book.resource.id, content: custom })
    ).resolves.toMatchObject({ workspaceType: "short" });
    await expect(
      store.readWritingContext({ bookId: book.resource.id })
    ).resolves.toMatchObject({ content: custom });

    await unlink(join(book.projectDirectory, "AGENTS.md"));
    await expect(
      store.readWritingContext({ bookId: book.resource.id })
    ).resolves.toMatchObject({ content: DEFAULT_SHORT_WRITING_CONTEXT });
    await expect(
      readFile(join(book.projectDirectory, "AGENTS.md"), "utf8")
    ).resolves.toBe(DEFAULT_SHORT_WRITING_CONTEXT);
  });

  it("rejects writes above the code-point limit", async () => {
    const root = await temporaryRoot();
    const store = new FolderCatalogStore({
      userDataPath: join(root, "user-data")
    });
    const book = await store.createScriptBook(
      { title: "超限剧本", genre: "其他" },
      join(root, "books")
    );
    await expect(
      store.writeWritingContext({
        bookId: book.resource.id,
        content: "界".repeat(WRITING_CONTEXT_MAX_CHARACTERS + 1)
      })
    ).rejects.toThrow();
  });

  it("copies customized context with a duplicated book", async () => {
    const root = await temporaryRoot();
    const store = new FolderCatalogStore({
      userDataPath: join(root, "user-data")
    });
    const source = await store.createScriptBook(
      { title: "原剧本", genre: "其他" },
      join(root, "books")
    );
    const custom = "# 剧本上下文\n\n每集结尾留下一个可见行动悬念。\n";
    await store.writeWritingContext({
      bookId: source.resource.id,
      content: custom
    });
    const copy = await store.duplicateProject({
      domain: "book",
      projectId: source.resource.id
    });
    await expect(
      store.readWritingContext({ bookId: copy.projectId })
    ).resolves.toMatchObject({ workspaceType: "script", content: custom });
  });

  it("atomically initializes web-novel short AGENTS.md during createShortBook and serializes parallel creations", async () => {
    const root = await temporaryRoot();
    const store = new FolderCatalogStore({
      userDataPath: join(root, "user-data")
    });
    const booksDir = join(root, "books");

    const [viralBook, refinedBook] = await Promise.all([
      store.createShortBook(
        {
          title: "真假千金爆款",
          genre: "真假千金",
          pacingMode: "viral_short",
          tropes: ["真假千金", "重生"]
        },
        booksDir
      ),
      store.createShortBook(
        {
          title: "怪谈精品短篇",
          genre: "规则怪谈",
          pacingMode: "refined_short",
          tropes: ["规则怪谈"]
        },
        booksDir
      )
    ]);

    const viralAgentsMd = await readFile(
      join(viralBook.projectDirectory, "AGENTS.md"),
      "utf8"
    );
    expect(viralAgentsMd).toContain("## 本篇网文短篇框架（真假千金）");
    expect(viralAgentsMd).toContain("盐选/番茄爆款短篇");
    expect(viralAgentsMd).toContain("【真假千金】");

    const refinedAgentsMd = await readFile(
      join(refinedBook.projectDirectory, "AGENTS.md"),
      "utf8"
    );
    expect(refinedAgentsMd).toContain("## 本篇网文短篇框架（规则怪谈）");
    expect(refinedAgentsMd).toContain("精品叙事短篇");
    expect(refinedAgentsMd).toContain("【规则怪谈】");
  });

  it("persists short web-novel positioning across manifest, index/snapshot reload, and AGENTS.md lazy repair", async () => {
    const root = await temporaryRoot();
    const userDataPath = join(root, "user-data");
    const store = new FolderCatalogStore({ userDataPath });
    const book = await store.createShortBook(
      {
        title: "定位往返短篇",
        genre: "真假千金",
        pacingMode: "viral_short",
        tropes: ["真假千金", "真假千金", " 虐渣打脸 "]
      },
      join(root, "books")
    );

    expect(book.resource).toMatchObject({
      genre: "真假千金",
      pacingMode: "viral_short",
      tropes: ["真假千金", "虐渣打脸"]
    });

    const rawManifest = await readFile(
      join(book.projectDirectory, "writer.json"),
      "utf8"
    );
    const parsedManifest = portableBookSchema.parse(JSON.parse(rawManifest));
    expect(parsedManifest).toMatchObject({
      bookType: "short",
      genre: "真假千金",
      pacingMode: "viral_short",
      tropes: ["真假千金", "虐渣打脸"]
    });

    const reloadedStore = new FolderCatalogStore({ userDataPath });
    const reloadedIndex = await reloadedStore.indexSnapshot();
    expect(reloadedIndex.books).toHaveLength(1);
    expect(reloadedIndex.books[0]).toMatchObject({
      id: book.resource.id,
      bookType: "short",
      genre: "真假千金",
      pacingMode: "viral_short",
      tropes: ["真假千金", "虐渣打脸"]
    });

    const reloadedSnapshot = await reloadedStore.snapshot();
    expect(reloadedSnapshot.books).toHaveLength(1);
    expect(reloadedSnapshot.books[0]).toMatchObject({
      id: book.resource.id,
      bookType: "short",
      genre: "真假千金",
      pacingMode: "viral_short",
      tropes: ["真假千金", "虐渣打脸"]
    });

    await unlink(join(book.projectDirectory, "AGENTS.md"));
    const repaired = await reloadedStore.readWritingContext({
      bookId: book.resource.id
    });
    expect(repaired.content).toContain("## 本篇网文短篇框架（真假千金）");
    expect(repaired.content).toContain("盐选/番茄爆款短篇");
    expect(repaired.content).toContain("【真假千金】");
    expect(repaired.content).toContain("【虐渣打脸】");

    const repairedOnDisk = await readFile(
      join(book.projectDirectory, "AGENTS.md"),
      "utf8"
    );
    expect(repairedOnDisk).toBe(repaired.content);
  });

  it("updates, preserves on partial patch, and clears short web-novel positioning via updateBook", async () => {
    const root = await temporaryRoot();
    const store = new FolderCatalogStore({
      userDataPath: join(root, "user-data")
    });
    const created = await store.createShortBook(
      {
        title: "初始短篇",
        genre: "真假千金",
        pacingMode: "viral_short",
        tropes: ["真假千金", "虐渣打脸"]
      },
      join(root, "books")
    );

    const updated = await store.updateBook({
      bookId: created.resource.id,
      genre: "追妻",
      pacingMode: "refined_short",
      tropes: ["破镜重圆", "破镜重圆"]
    });
    expect(updated).toMatchObject({
      bookType: "short",
      genre: "追妻",
      pacingMode: "refined_short",
      tropes: ["破镜重圆"]
    });

    const renamed = await store.updateBook({
      bookId: created.resource.id,
      title: "新名"
    });
    expect(renamed).toMatchObject({
      bookType: "short",
      title: "新名",
      genre: "追妻",
      pacingMode: "refined_short",
      tropes: ["破镜重圆"]
    });

    const cleared = await store.updateBook({
      bookId: created.resource.id,
      pacingMode: null,
      tropes: []
    });
    expect(cleared.bookType).toBe("short");
    if (cleared.bookType === "short") {
      expect(cleared.pacingMode).toBeUndefined();
      expect(cleared.tropes).toBeUndefined();
    }

    const rawClearedManifest = JSON.parse(
      await readFile(join(created.projectDirectory, "writer.json"), "utf8")
    ) as Record<string, unknown>;
    expect(rawClearedManifest).not.toHaveProperty("pacingMode");
    expect(rawClearedManifest).not.toHaveProperty("tropes");
    expect(portableBookSchema.parse(rawClearedManifest)).toMatchObject({
      bookType: "short",
      title: "新名",
      genre: "追妻"
    });
  });

  it("enforces expectedRevision CAS on writeWritingContext and exposes pure AGENTS.md reads and workspace-only counts", async () => {
    const root = await temporaryRoot();
    const store = new FolderCatalogStore({
      userDataPath: join(root, "user-data")
    });
    const created = await store.createShortBook(
      {
        title: "CAS短篇",
        genre: "规则怪谈",
        pacingMode: "viral_short",
        tropes: ["规则怪谈"]
      },
      join(root, "books")
    );
    const bookId = created.resource.id;
    const initial = await store.readWritingContext({ bookId });
    expect(initial.revision).toBe(
      createShortWorkspaceContentRevision(initial.content)
    );

    const updatedContent = `${initial.content}\n## 追加约束\n- 严禁吃书。\n`;
    const written = await store.writeWritingContext({
      bookId,
      content: updatedContent,
      expectedRevision: initial.revision
    });
    expect(written.revision).toBe(
      createShortWorkspaceContentRevision(updatedContent)
    );

    await expect(
      store.writeWritingContext({
        bookId,
        content: "# 过期覆盖",
        expectedRevision: initial.revision
      })
    ).rejects.toBeInstanceOf(FolderCatalogConflictError);

    await unlink(join(created.projectDirectory, "AGENTS.md"));
    const pureFile = WritingFileSchema.parse(
      await store.readWritingWorkspace(
        {
          bookId,
          bookType: "short",
          query: { mode: "file", documentId: "AGENTS.md" }
        },
        "run-pure-agents-md"
      )
    );
    expect(pureFile.content).toContain("盐选/番茄爆款短篇");
    expect(pureFile.content).toContain("【规则怪谈】");
    await expect(
      readFile(join(created.projectDirectory, "AGENTS.md"), "utf8")
    ).rejects.toThrow();

    const workspaceCounts = WritingIndexSchema.parse(
      await store.readWritingWorkspace(
        {
          bookId,
          bookType: "short",
          query: { mode: "index", counts: "workspace" }
        },
        "run-pure-agents-md"
      )
    );
    expect(workspaceCounts.counts).toContainEqual({
      id: "AGENTS.md",
      revision: pureFile.revision,
      length: pureFile.length,
      characters: pureFile.characters
    });

    const draftCounts = WritingIndexSchema.parse(
      await store.readWritingWorkspace(
        {
          bookId,
          bookType: "short",
          query: { mode: "index", counts: "draft" }
        },
        "run-pure-agents-md"
      )
    );
    expect(draftCounts.counts.some((item) => item.id === "AGENTS.md")).toBe(
      false
    );
  });
});
