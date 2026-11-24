import { describe, expect, it } from "vitest";
import type { AgentSurface } from "../agent-surface";
import { ConversationAgentCache } from "./run-agent";
import type { AgentRunPlan } from "./run-plan";

function fakeAgent(isStreaming = false): AgentSurface {
  return {
    state: {
      isStreaming,
      messages: [],
      tools: []
    }
  } as unknown as AgentSurface;
}

function fakePlan(agentKey: string): AgentRunPlan {
  return {
    agentKey,
    target: {
      sessionId: agentKey
    }
  } as unknown as AgentRunPlan;
}

describe("ConversationAgentCache LRU and idle TTL eviction", () => {
  it("evicts idle non-streaming agents past TTL while preserving streaming ones", () => {
    let clock = 1_000;
    const agents = new Map<string, AgentSurface>();
    const cache = new ConversationAgentCache(
      agents,
      {},
      { limit: 4, idleTtlMs: 5_000, now: () => clock }
    );

    agents.set("idle-a", fakeAgent(false));
    agents.set("busy-b", fakeAgent(true));
    cache.select(fakePlan("idle-a"));
    cache.select(fakePlan("busy-b"));

    clock += 6_000;
    const evicted = cache.sweepIdle();
    expect(evicted).toBe(1);
    expect(agents.has("idle-a")).toBe(false);
    expect(agents.has("busy-b")).toBe(true);
  });

  it("keeps recently selected agents alive by refreshing their lastUsedAt timestamp", () => {
    let clock = 1_000;
    const agents = new Map<string, AgentSurface>();
    const cache = new ConversationAgentCache(
      agents,
      {},
      { limit: 4, idleTtlMs: 5_000, now: () => clock }
    );

    agents.set("active-a", fakeAgent(false));
    cache.select(fakePlan("active-a"));

    clock += 4_000;
    expect(cache.select(fakePlan("active-a"))).toBeDefined();

    clock += 4_000;
    expect(cache.sweepIdle()).toBe(0);
    expect(agents.has("active-a")).toBe(true);
  });
});
