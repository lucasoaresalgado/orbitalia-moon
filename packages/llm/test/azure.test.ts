import { afterEach, describe, expect, it, vi } from "vitest";
import { complete, type ModelClient, type TurnRequest } from "../src/client.ts";
import { AzureClient, type AzureOptions } from "../src/azure.ts";

function sse(events: object[], done = true): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      const enc = new TextEncoder();
      let text = "";
      for (const e of events) text += `data: ${JSON.stringify(e)}\n\n`;
      if (done) text += "data: [DONE]\n\n";
      c.enqueue(enc.encode(text));
      c.close();
    },
  });
  return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
}

const client = (opts?: Partial<AzureOptions>): ModelClient => new AzureClient({ id: "azure:gpt-5.1", provider: "azure", model: "gpt-5.1" }, { endpoint: "http://localhost:8000", apiKey: "k", deployment: "gpt-5.1", ...opts });

const req = (over: Partial<TurnRequest> = {}): TurnRequest => ({
  system: [{ text: "You are a worker.", tier: "static" }],
  messages: [{ role: "user", content: [{ type: "text", text: "do the thing" }] }],
  tools: [],
  effort: "high",
  maxOutputTokens: 1024,
  ...over,
});

describe("azure client", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("streams text deltas and finishes", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => sse([{ choices: [{ delta: { content: "Hello" }, finish_reason: null }], usage: { prompt_tokens: 5, completion_tokens: 2 } }])));
    const events = [];
    for await (const ev of client().stream(req())) events.push(ev);
    expect(events).toEqual([
      { type: "text", delta: "Hello" },
      { type: "done", message: { role: "assistant", content: [{ type: "text", text: "Hello" }] }, stop: "end", usage: { input: 5, output: 2, cacheRead: 0, cacheWrite: 0 } },
    ]);
  });

  it("streams a tool call and stops on tool_use", async () => {
    const events = [
      { choices: [{ delta: { content: "Creating the file." } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", function: { name: "write_file", arguments: JSON.stringify({ path: "a.txt" }) } }] } }] },
      { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
    ];
    vi.stubGlobal("fetch", vi.fn(async () => sse(events)));
    const done = await complete(client(), req({ tools: [{ name: "write_file", description: "write a file", schema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } }] }));
    expect(done.stop).toBe("tool_use");
    expect(done.message.content).toEqual([
      { type: "text", text: "Creating the file." },
      { type: "tool_use", id: "call_1", name: "write_file", input: { path: "a.txt" } },
    ]);
  });

  it("asks for the deployment with the translated turn and structured output", async () => {
    const f = vi.fn(async () => sse([{ choices: [{ delta: {}, finish_reason: "stop" }] }]));
    vi.stubGlobal("fetch", f);
    const format = { type: "object", properties: { decision: { type: "string" } }, required: ["decision"] };
    await complete(client(), req({ format }));
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(url)).toBe("http://localhost:8000/openai/deployments/gpt-5.1/chat/completions?api-version=2025-04-01-preview");
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body).toMatchObject({ model: "gpt-5.1", stream: true, max_completion_tokens: 1024 });
    expect(body.messages).toEqual([
      { role: "system", content: "You are a worker." },
      { role: "user", content: "do the thing" },
    ]);
    expect(body.response_format).toEqual({ type: "json_schema", json_schema: { name: "output", strict: true, schema: format } });
  });
});
