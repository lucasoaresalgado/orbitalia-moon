// Azure Foundry (Azure OpenAI) through the OpenAI-compatible chat completions
// wire format (adapted from perguntai-v2's server/models/client.ts). Specifics:
// - the provider-neutral turn is translated to OpenAI chat completions
//   (system, messages, tools, structured output via response_format);
// - streaming deltas map to the neutral ModelEvent stream;
// - usage and finish_reason map to the neutral result.
import { emptyUsage, type Usage } from "@miniasys/core";
import type { AssistantBlock, Message, ModelClient, ModelEvent, ModelInfo, StopReason, TextBlock, ToolResultBlock, ToolUseBlock, TurnRequest } from "./client.ts";

export interface AzureOptions {
  endpoint: string;
  apiKey: string;
  /** the Foundry deployment serving the model */
  deployment: string;
  apiVersion?: string;
  maxRetries?: number;
}

const DEFAULT_API_VERSION = "2025-04-01-preview";

export interface OpenAIMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_call_id?: string;
  tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
}

interface AzureChoice {
  delta?: { content?: string; reasoning?: string; tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[]; finish_reason?: string | null };
  finish_reason?: string | null;
}

interface AzureChunk {
  choices?: AzureChoice[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } };
}

export function azureParams(info: ModelInfo, req: TurnRequest, opts: { deployment: string; apiVersion?: string } = { deployment: info.model }) {
  const system = req.system.map((b) => b.text).filter(Boolean).join("\n\n");
  const messages: OpenAIMessage[] = [];
  if (system) messages.push({ role: "system", content: system });
  for (const m of req.messages as Message[]) {
    if (m.role === "user") {
      const text = m.content.filter((b): b is TextBlock => b.type === "text").map((b) => b.text).join("\n\n");
      const toolResults = m.content.filter((b): b is ToolResultBlock => b.type === "tool_result");
      if (text) messages.push({ role: "user", content: text });
      for (const t of toolResults) messages.push({ role: "tool", tool_call_id: t.toolUseId, content: t.content });
    } else {
      const text = m.content.filter((b): b is TextBlock => b.type === "text").map((b) => b.text).join("\n\n");
      const toolCalls = m.content.filter((b): b is ToolUseBlock => b.type === "tool_use").map((b) => ({ id: b.id, type: "function" as const, function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) } }));
      messages.push({ role: "assistant", content: text || "", ...(toolCalls.length ? { tool_calls: toolCalls } : {}) });
    }
  }
  const body: Record<string, unknown> = { model: opts.deployment, messages, stream: true, stream_options: { include_usage: true } };
  if (req.tools.length) body.tools = req.tools.map((t) => ({ type: "function" as const, function: { name: t.name, description: t.description, parameters: t.schema } }));
  if (req.maxOutputTokens) body.max_completion_tokens = req.maxOutputTokens;
  if (req.format) body.response_format = { type: "json_schema", json_schema: { name: "output", strict: true, schema: req.format } };
  return { body, apiVersion: opts.apiVersion };
}

function toStop(r: string | null | undefined): StopReason {
  switch (r) {
    case "stop":
    case "stop_sequence":
      return "end";
    case "tool_calls":
      return "tool_use";
    case "length":
      return "max_tokens";
    case "content_filter":
      return "refusal";
    default:
      return "error";
  }
}

export class AzureClient implements ModelClient {
  constructor(
    readonly info: ModelInfo,
    private opts: AzureOptions,
  ) {}

  async *stream(req: TurnRequest, signal?: AbortSignal): AsyncIterable<ModelEvent> {
    const { body, apiVersion } = azureParams(this.info, req, { deployment: this.opts.deployment, apiVersion: this.opts.apiVersion });
    const res = await fetch(`${this.opts.endpoint.replace(/\/+$/, "")}/openai/deployments/${encodeURIComponent(this.opts.deployment)}/chat/completions?api-version=${apiVersion ?? DEFAULT_API_VERSION}`, {
      method: "POST",
      headers: { "content-type": "application/json", "api-key": this.opts.apiKey },
      body: JSON.stringify({ ...body, stream: true }),
      signal,
    });
    if (!res.ok) throw new Error(`azure ${res.status}: ${await res.text()}`);
    if (!res.body) throw new Error("azure: the response had no body to stream");

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const events: ModelEvent[] = [];
    let text = "";
    let reasoning = "";
    let stop: StopReason | null = null;
    let usage: Usage | null = null;
    const calls = new Map<number, { id: string; name: string; args: string }>();
    const startedIds = new Set<string>();

    const handle = (data: string): boolean => {
      if (data === "[DONE]") return false;
      const json = JSON.parse(data) as AzureChunk;
      const choice = json.choices?.[0];
      const delta = choice?.delta;
      if (delta?.reasoning) {
        reasoning += delta.reasoning;
        events.push({ type: "reasoning_summary", delta: delta.reasoning });
      }
      if (delta?.content) {
        text += delta.content;
        events.push({ type: "text", delta: delta.content });
      }
      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index ?? 0;
          const cur = calls.get(idx) ?? { id: "", name: "", args: "" };
          const call = { id: tc.id ?? cur.id, name: tc.function?.name ?? cur.name, args: tc.function?.arguments ?? cur.args };
          calls.set(idx, call);
          if (call.id && !startedIds.has(call.id)) {
            startedIds.add(call.id);
            events.push({ type: "tool_call_start", id: call.id, name: call.name });
          }
        }
      }
      if (choice?.finish_reason) stop = toStop(choice.finish_reason);
      if (json.usage) usage = { input: json.usage.prompt_tokens ?? 0, output: json.usage.completion_tokens ?? 0, cacheRead: json.usage.prompt_tokens_details?.cached_tokens ?? 0, cacheWrite: 0 };
      return true;
    };

    let finished = false;
    while (!finished) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf("\n\n")) >= 0) {
        const raw = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const data = raw.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(6)).join("\n");
        if (!data || data === "[DONE]") continue;
        const keepGoing = handle(data);
        for (const ev of events.splice(0)) yield ev;
        if (!keepGoing) {
          finished = true;
          break;
        }
      }
    }
    const tail = buffer;
    buffer = "";
    if (tail.trim()) {
      const data = tail.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(6)).join("\n");
      if (data && data !== "[DONE]") {
        const keepGoing = handle(data);
        for (const ev of events.splice(0)) yield ev;
        if (!keepGoing) finished = true;
      }
    }

    const content: AssistantBlock[] = [];
    if (text) content.push({ type: "text", text });
    const toolBlocks: ToolUseBlock[] = [];
    for (const [, c] of [...calls.entries()].sort((a, b) => a[0] - b[0])) {
      if (!c.id || !c.name) continue;
      toolBlocks.push({ type: "tool_use", id: c.id, name: c.name, input: JSON.parse(c.args || "{}") });
    }
    content.push(...toolBlocks);
    if (reasoning) content.push({ type: "reasoning", provider: "azure", model: this.info.model, data: reasoning, summary: reasoning });
    yield { type: "done", message: { role: "assistant", content }, stop: stop ?? "end", usage: usage ?? emptyUsage() };
  }
}
