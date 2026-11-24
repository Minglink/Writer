import type { AgentSurface } from "../agent-surface";
import { LoopAgent } from "../dsh/loop-agent";
import {
  type AgentTool,
  type StreamFn,
  type ThinkingLevel as PiThinkingLevel
} from "@earendil-works/pi-agent-core";
import {
  normalizeContext,
  toToolDeclaration,
  type Api,
  type Model
} from "@earendil-works/pi-ai";
import {
  cacheConversationAgent,
  selectConversationAgentForRun
} from "../conversation-agent-rebuild";
import type { AgentToolExecutionHooks } from "../subagent-runtime";
import { restoredConversationMessages } from "./run-model";
import type { AgentRunPlan } from "./run-plan";

const CONVERSATION_AGENT_CACHE_LIMIT = 8;
const CONVERSATION_AGENT_IDLE_TTL_MS = 5 * 60_000;

export interface ConversationAgentCacheOptions {
  limit?: number;
  idleTtlMs?: number;
  now?: () => number;
}

export interface RunAgentState {
  systemPrompt: string;
  model: Model<Api>;
  thinkingLevel: PiThinkingLevel;
  tools: AgentTool[];
  streamFn: StreamFn;
}

/** Owns the conversation-agent cache shared by every agent domain. */
export class ConversationAgentCache {
  private readonly lastUsedAt = new Map<string, number>();
  private readonly limit: number;
  private readonly idleTtlMs: number;
  private readonly now: () => number;

  constructor(
    readonly agents: Map<string, AgentSurface>,
    private readonly hooks: AgentToolExecutionHooks,
    options?: ConversationAgentCacheOptions
  ) {
    this.limit = Math.max(1, options?.limit ?? CONVERSATION_AGENT_CACHE_LIMIT);
    this.idleTtlMs = Math.max(
      0,
      options?.idleTtlMs ?? CONVERSATION_AGENT_IDLE_TTL_MS
    );
    this.now = options?.now ?? (() => Date.now());
  }

  /** Evicts non-streaming cached agents that exceeded the idle TTL. */
  sweepIdle(now = this.now()): number {
    let evicted = 0;
    for (const [key, agent] of this.agents) {
      if (agent.state.isStreaming) continue;
      const touched = this.lastUsedAt.get(key);
      if (touched !== undefined && now - touched > this.idleTtlMs) {
        this.agents.delete(key);
        this.lastUsedAt.delete(key);
        evicted += 1;
      }
    }
    for (const key of this.lastUsedAt.keys()) {
      if (!this.agents.has(key)) {
        this.lastUsedAt.delete(key);
      }
    }
    return evicted;
  }

  /** Returns the cached agent for a keyed plan, or undefined for a fresh run. */
  select(plan: AgentRunPlan): AgentSurface | undefined {
    this.sweepIdle();
    if (!plan.agentKey) return undefined;
    const selected = selectConversationAgentForRun(
      this.agents,
      plan.agentKey,
      plan.target.conversationHistoryMode
    );
    if (selected) {
      this.lastUsedAt.set(plan.agentKey, this.now());
    }
    return selected;
  }

  /** Refreshes a reused agent or creates one; only keyed plans are cached. */
  prepare(
    plan: AgentRunPlan,
    reusable: AgentSurface | undefined,
    state: RunAgentState
  ): AgentSurface {
    if (reusable) {
      if (reusable.state.isStreaming) {
        throw new Error("The selected conversation agent is already running.");
      }
      reusable.state.messages = normalizeContext({
        systemPrompt: state.systemPrompt,
        tools: state.tools.map(toToolDeclaration),
        messages: reusable.state.messages.filter(
          (message) => message.role !== "system"
        )
      }).messages;
      reusable.state.model = state.model;
      reusable.state.thinkingLevel = state.thinkingLevel;
      reusable.state.tools = state.tools;
      reusable.streamFunction = state.streamFn;
      if (this.hooks.beforeToolCall) {
        reusable.beforeToolCall = this.hooks.beforeToolCall;
      } else {
        delete reusable.beforeToolCall;
      }
      if (this.hooks.afterToolCall) {
        reusable.afterToolCall = this.hooks.afterToolCall;
      } else {
        delete reusable.afterToolCall;
      }
      reusable.sessionId = plan.target.sessionId;
      reusable.toolExecution = "sequential";
      if (plan.agentKey) {
        cacheConversationAgent(this.agents, plan.agentKey, reusable);
        this.lastUsedAt.set(plan.agentKey, this.now());
      }
      return reusable;
    }
    const restoredMessages = restoredConversationMessages(
      plan.target,
      state.model
    );
    const agent = new LoopAgent({
      initialState: {
        systemPrompt: state.systemPrompt,
        model: state.model,
        thinkingLevel: state.thinkingLevel,
        ...(restoredMessages.length ? { messages: restoredMessages } : {}),
        tools: state.tools
      },
      streamFn: state.streamFn,
      ...this.hooks,
      sessionId: plan.target.sessionId
    });
    if (plan.agentKey) {
      cacheConversationAgent(this.agents, plan.agentKey, agent);
      this.lastUsedAt.set(plan.agentKey, this.now());
      this.sweepIdle();
      this.trim();
    }
    return agent;
  }

  private trim(limit = this.limit): void {
    if (this.agents.size <= limit) return;
    for (const [key, agent] of this.agents) {
      if (this.agents.size <= limit) return;
      if (!agent.state.isStreaming) {
        this.agents.delete(key);
        this.lastUsedAt.delete(key);
      }
    }
  }
}
