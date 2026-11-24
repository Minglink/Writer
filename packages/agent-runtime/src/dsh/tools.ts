import { Context } from "@deepseek-ai/cordis";
import SystemPrompt from "@deepseek-ai/dsh-system-prompt";
import ToolsService, {
  type ToolDefinition,
  type ToolExecutionResult
} from "@deepseek-ai/dsh-tools";
import { apply as applyNativeExecutor } from "@deepseek-ai/dsh-tool-executor-native";
import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";

type OnUpdate = (partial: AgentToolResult<unknown>) => void;

/** Update sink handed in by the loop for the call currently dispatching. */
const updates = new Map<string, OnUpdate | undefined>();

/**
 * Runs one run's tool calls through the harness tool pipeline: registration,
 * dispatch, ordered settlement and output projection are the harness's; the
 * tool bodies stay this app's domain tools.
 */
export interface HarnessTools {
  readonly tools: AgentTool[];
  dispose(): Promise<void>;
}

export async function withHarnessTools(
  tools: readonly AgentTool[]
): Promise<HarnessTools> {
  const ctx = new Context();
  await ctx.plugin(SystemPrompt);
  await ctx.plugin(ToolsService);
  await ctx.plugin({
    name: "writer-native-tool-executor",
    inject: ["tools"],
    apply: applyNativeExecutor
  });

  for (const tool of tools) ctx.tools.register(defineHarnessTool(tool));

  const wrapped = tools.map((tool) => ({
    ...tool,
    execute: async (
      callId: string,
      params: unknown,
      signal?: AbortSignal,
      onUpdate?: OnUpdate
    ) => {
      updates.set(callId, onUpdate);
      try {
        const signalToUse = signal ?? new AbortController().signal;
        const batch = await ctx.tools.execute({
          calls: [
            {
              type: "tool-call" as const,
              id: callId as never,
              name: tool.name,
              arguments: JSON.stringify(params ?? {})
            }
          ],
          signal: signalToUse
        });
        const result = batch.results[0]?.result;
        if (!result) throw new Error(`工具 ${tool.name} 没有返回结果。`);
        if (result.isError) throw new Error(result.error.message);
        return {
          content:
            result.content as unknown as AgentToolResult<unknown>["content"],
          details: (result.value as { details?: unknown } | undefined)?.details
        };
      } finally {
        updates.delete(callId);
      }
    }
  })) as AgentTool[];

  return {
    tools: wrapped,
    dispose: async () => {
      await ctx.fiber.dispose();
    }
  };
}

function defineHarnessTool(tool: AgentTool): ToolDefinition {
  return {
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters as unknown as Record<string, unknown>,
    output: {
      schema: { type: "object", additionalProperties: true },
      render: (_args, value) => {
        const content = (value as { content?: unknown }).content;
        return Array.isArray(content) ? (content as never) : [];
      }
    },
    async execute(args, exec): Promise<unknown> {
      const result = await tool.execute(
        String(exec.callId),
        args,
        exec.signal,
        updates.get(String(exec.callId)) as never
      );
      return { content: result.content, details: result.details };
    }
  };
}

export type { ToolExecutionResult };
