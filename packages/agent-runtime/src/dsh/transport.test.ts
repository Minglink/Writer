import { describe, expect, it } from "vitest";
import {
  createAssistantMessageEventStream,
  type Api,
  type AssistantMessage,
  type AssistantMessageEvent,
  type Model
} from "@earendil-works/pi-ai";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import { createHarnessStreamFn } from "./transport";

const model = {
  api: "openai-completions" as Api,
  provider: "example" as never,
  id: "example-model",
  name: "Example",
  contextWindow: 8_192,
  maxTokens: 1_024,
  input: ["text"] as const
} as unknown as Model<Api>;

function fakeStream(text: string, seen: unknown[]): StreamFn {
  return (_model, context) => {
    const stream = createAssistantMessageEventStream();
    void (async () => {
      seen.push(context.messages);
      const partial = {
        role: "assistant",
        content: [{ type: "text", text: "" }],
        api: model.api,
        provider: model.provider,
        model: model.id,
        usage: {
          input: 1,
          output: 2,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 3,
          cost: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            total: 0
          }
        },
        stopReason: "stop",
        timestamp: Date.now()
      } satisfies AssistantMessage;
      stream.push({ type: "start", partial });
      stream.push({
        type: "text_delta",
        contentIndex: 0,
        delta: text,
        partial
      });
      partial.content[0] = { type: "text", text };
      stream.push({ type: "done", reason: "stop", message: partial });
      stream.end(partial);
    })();
    return stream;
  };
}

async function collect(
  streamFn: StreamFn
): Promise<{ events: AssistantMessageEvent[]; result: AssistantMessage }> {
  const stream = await streamFn(
    model,
    {
      messages: [
        { role: "system", content: "Be brief.", timestamp: 0 },
        { role: "user", content: "Hello", timestamp: 0 }
      ]
    } as unknown as Parameters<StreamFn>[1],
    {}
  );
  const events: AssistantMessageEvent[] = [];
  for await (const event of stream) events.push(event);
  return { events, result: await stream.result() };
}

describe("harness stream seam", () => {
  it("carries text deltas and the final message back to the loop", async () => {
    const seen: unknown[] = [];
    const { events, result } = await collect(
      createHarnessStreamFn(fakeStream("Hi there", seen), model)
    );

    expect(events.map((event) => event.type)).toContain("text_delta");
    expect(result.content).toEqual([{ type: "text", text: "Hi there" }]);
    expect(result.stopReason).toBe("stop");
    expect(result.usage.output).toBe(2);
    expect(seen).toHaveLength(1);
  });

  it("reports a failing inner stream as an error message", async () => {
    const failing: StreamFn = () => {
      throw new Error("boom");
    };
    const { result } = await collect(createHarnessStreamFn(failing, model));

    expect(result.stopReason).toBe("error");
    expect(result.errorMessage).toBe("boom");
  });

  it("keeps user image attachments across the seam", async () => {
    const seen: unknown[] = [];
    const image = {
      type: "image" as const,
      data: "AAAA",
      mimeType: "image/png"
    };
    const streamFn = createHarnessStreamFn(fakeStream("seen", seen), model);
    const stream = await streamFn(
      model,
      {
        messages: [
          { role: "system", content: "Be brief.", timestamp: 0 },
          {
            role: "user",
            content: [{ type: "text", text: "看这张图" }, image],
            timestamp: 0
          }
        ]
      } as unknown as Parameters<StreamFn>[1],
      {}
    );
    for await (const _event of stream) void _event;

    const messages = seen[0] as {
      role: string;
      content: unknown[];
    }[];
    const user = messages.find((message) => message.role === "user");
    expect(user?.content).toContainEqual(image);
  });
});
