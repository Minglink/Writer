import { ref } from "vue";
import { describe, expect, it, vi } from "vitest";
import { createShortBookCreator } from "./short-book-creation";
import type { ShortBookLifecycleCoordinatorOptions } from "./useShortBookLifecycleCoordinator";
function setup() {
  const createBookFromTemplate = vi.fn(async () => ({
    id: "created",
    bookType: "short"
  }));
  const createShortBook = vi.fn(async () => ({
    id: "created-direct",
    bookType: "short"
  }));
  const refresh = vi.fn(async () => true);
  const select = vi.fn(async () => true);
  const pending = ref(false);
  const open = ref(true);
  const notifications = {
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    success: vi.fn()
  };
  const create = createShortBookCreator({
    catalog: {
      api: () => ({ createBookFromTemplate, createShortBook }),
      refreshWorkspaceDirectory: async () => {}
    } as unknown as ShortBookLifecycleCoordinatorOptions["catalog"],
    state: {
      createBookDialogOpen: open
    } as ShortBookLifecycleCoordinatorOptions["state"],
    resources: {
      settleUi: async () => {},
      selectPreferredBook: select
    } as unknown as ShortBookLifecycleCoordinatorOptions["resources"],
    notifications,
    acquirePendingLease: () => {
      if (pending.value) return null;
      pending.value = true;
      return {};
    },
    runWithLease: async (_lease, task) => {
      try {
        await task();
      } finally {
        pending.value = false;
      }
    },
    leaseIsOwned: () => true,
    leaseCanPublish: () => true,
    refreshAfterDurableMutation: refresh,
    errorMessage: (error, fallback) =>
      error instanceof Error ? error.message : fallback
  });
  return {
    create,
    createBookFromTemplate,
    createShortBook,
    refresh,
    select,
    pending,
    open,
    notifications
  };
}
const input = {
  workspaceType: "short" as const,
  genre: "其他" as const,
  title: "新作品",
  templateId: "template_1"
};
describe("template creation lifecycle", () => {
  it("sends only template identity and title, prevents duplicate submission, then opens the result", async () => {
    const h = setup();
    await Promise.all([h.create(input), h.create(input)]);
    expect(h.createBookFromTemplate).toHaveBeenCalledExactlyOnceWith({
      templateId: "template_1",
      title: "新作品"
    });
    expect(h.select).toHaveBeenCalledWith("created");
    expect(h.open.value).toBe(false);
    expect(h.pending.value).toBe(false);
  });
  it("leaves dialog open on cancellation and clears pending", async () => {
    const h = setup();
    h.createBookFromTemplate.mockResolvedValueOnce(null as never);
    await h.create(input);
    expect(h.open.value).toBe(true);
    expect(h.refresh).not.toHaveBeenCalled();
    expect(h.pending.value).toBe(false);
  });
  it("keeps durable creation closed on refresh failure without creating again", async () => {
    const h = setup();
    h.refresh.mockResolvedValueOnce(false);
    await h.create(input);
    expect(h.open.value).toBe(false);
    expect(h.select).not.toHaveBeenCalled();
    expect(h.notifications.warning).toHaveBeenCalled();
    expect(h.createBookFromTemplate).toHaveBeenCalledTimes(1);
  });
  it("reports failure without closing the dialog", async () => {
    const h = setup();
    h.createBookFromTemplate.mockRejectedValueOnce(new Error("模板已删除"));
    await h.create(input);
    expect(h.notifications.error).toHaveBeenCalledWith("模板已删除");
    expect(h.open.value).toBe(true);
    expect(h.pending.value).toBe(false);
  });
  it("forwards web-novel pacingMode and tropes in a single atomic createShortBook call", async () => {
    const h = setup();
    await h.create({
      workspaceType: "short",
      genre: "真假千金",
      title: "豪门真千金",
      pacingMode: "viral_short",
      tropes: ["真假千金", "重生"]
    });
    expect(h.createShortBook).toHaveBeenCalledExactlyOnceWith({
      genre: "真假千金",
      title: "豪门真千金",
      pacingMode: "viral_short",
      tropes: ["真假千金", "重生"],
      linkedMaterialIds: undefined,
      linkedSkillIds: undefined,
      linkedMaterialIdsByKind: undefined,
      linkedSkillIdsByKind: undefined
    });
    expect(h.select).toHaveBeenCalledWith("created-direct");
    expect(h.open.value).toBe(false);
  });
});
