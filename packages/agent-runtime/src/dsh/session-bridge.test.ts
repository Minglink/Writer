import { describe, expect, it } from "vitest";
import {
  createAssistantMessageEventStream,
  type AssistantMessage,
  type Model
} from "@earendil-works/pi-ai";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import { LoopAgent } from "./loop-agent";
import { createHarnessSessionBridge } from "./session-bridge";

const TEST_MODEL: Model<"openai-completions"> = {
  id: "test-model",
  name: "Test Model",
  api: "openai-completions",
  provider: "openai",
  baseUrl: "https://example.test/v1",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 32_000,
  maxTokens: 4_096
};

function makeAssistant(text: string): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: TEST_MODEL.api,
    provider: TEST_MODEL.provider,
    model: TEST_MODEL.id,
    usage: {
      input: 10,
      output: 5,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 15,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
    },
    stopReason: "stop",
    timestamp: Date.now()
  };
}

describe("harness @deepseek-ai/dsh-session bridge", () => {
  it("mirrors LoopAgent turns into a live Cordis dsh-session store without breaking AgentSurface", async () => {
    const bridge = await createHarnessSessionBridge("writer-session-1");
    try {
      const streamFn: StreamFn = () => {
        const stream = createAssistantMessageEventStream();
        queueMicrotask(() => {
          const message = makeAssistant("已收到你的章节目标。");
          stream.push({ type: "start", partial: message });
          stream.push({ type: "done", reason: "stop", message });
        });
        return stream;
      };

      const agent = new LoopAgent({
        sessionId: "writer-session-1",
        journal: bridge.journal,
        initialState: {
          systemPrompt: "You are Writer.",
          model: TEST_MODEL
        },
        streamFn
      });

      await agent.prompt("帮我梳理第一章冲突");
      await bridge.flush();

      expect(agent.state.errorMessage).toBeUndefined();
      const lastMsg = agent.state.messages.at(-1);
      if (lastMsg?.role === "assistant" && lastMsg.stopReason === "error") {
        throw new Error(lastMsg.errorMessage ?? "assistant error");
      }
      const journalKinds = bridge.journal.entries().map((e) => e.kind);
      expect(journalKinds).toEqual([
        "turn_started",
        "assistant_completed",
        "turn_finished"
      ]);
      const dshTypes = bridge.events.map((event) => event.type);
      expect(dshTypes).toEqual([
        "turn/start",
        "step/start",
        "step/end",
        "turn/end"
      ]);
      // AgentSurface state.messages remains mutable for retry coordinators.
      expect(Object.isFrozen(agent.state.messages)).toBe(false);
    } finally {
      await bridge.dispose();
    }
  });
});
