import { describe, expect, it } from "vitest";
import { Type } from "@earendil-works/pi-ai";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { withHarnessTools } from "./tools";

function echoTool(seen: unknown[]): AgentTool {
  return {
    name: "echo",
    label: "Echo",
    description: "Echo the text back.",
    parameters: Type.Object({ text: Type.String() }),
    execute: async (callId, params, _signal, onUpdate) => {
      seen.push({ callId, params });
      await onUpdate?.({
        content: [{ type: "text", text: "partial" }],
        details: { step: 1 }
      } as never);
      return {
        content: [
          { type: "text", text: `echo:${(params as { text: string }).text}` }
        ],
        details: { kind: "echo", callId }
      };
    }
  } as AgentTool;
}

describe("harness tool pipeline", () => {
  it("executes a domain tool and keeps its content and details", async () => {
    const seen: unknown[] = [];
    const updates: unknown[] = [];
    const harness = await withHarnessTools([echoTool(seen)]);
    try {
      const result = await harness.tools[0]!.execute(
        "call-1",
        { text: "hi" },
        undefined,
        (partial) => updates.push(partial)
      );

      expect(seen).toEqual([{ callId: "call-1", params: { text: "hi" } }]);
      expect(result.content).toEqual([{ type: "text", text: "echo:hi" }]);
      expect(result.details).toEqual({ kind: "echo", callId: "call-1" });
      expect(updates).toEqual([
        { content: [{ type: "text", text: "partial" }], details: { step: 1 } }
      ]);
    } finally {
      await harness.dispose();
    }
  });

  it("turns a failing tool body into a thrown error", async () => {
    const harness = await withHarnessTools([
      {
        name: "boom",
        label: "Boom",
        description: "Fail.",
        parameters: Type.Object({}),
        execute: async () => {
          throw new Error("坏了");
        }
      } as AgentTool
    ]);
    try {
      await expect(
        harness.tools[0]!.execute("call-2", {}, undefined)
      ).rejects.toThrow("坏了");
    } finally {
      await harness.dispose();
    }
  });
});
