// Claude through the first-party Messages API (adapted from perguntai-v2's
// server/models/anthropic.ts). Specifics kept here:
// - cache breakpoints at the end of each system tier (1h static/project, 5m run)
//   plus automatic caching of the conversation: 4 breakpoints at most;
// - adaptive thinking with effort (thinking can't be disabled on the 5.5 models);
//   reasoning blocks replayed unchanged to the same model, dropped for others;
// - strict tool schemas while the tool count fits one grammar; never a forced
//   tool_choice (refused on the 5.5 models);
// - server-side refusal fallback on Opus/Sonnet 5.5 (beta "server-side-fallback-2026-07-01").
import Anthropic from "@anthropic-ai/sdk";
import { emptyUsage, type Usage } from "@miniasys/core";
import type { AssistantBlock, CacheTier, Message, ModelClient, ModelEvent, ModelInfo, StopReason, TurnRequest } from "./client.ts";
import { closedSchema } from "./schema.ts";

export interface AnthropicOptions {
  apiKey: string;
  baseURL?: string;
  /** retries on 408/409/429/5xx and connection errors, with exponential backoff and jitter (§8.8) */
  maxRetries?: number;
  /** refusal fallback by category, on the models that support it */
  serverFallback?: boolean;
}

const TTL: Record<CacheTier, "1h" | "5m"> = { static: "1h", project: "1h", run: "5m" };
const STRICT_TOOLS_MAX = 12;
const FALLBACK_MODELS = /^claude-(opus|sonnet)-5-5$/;
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

export function anthropicParams(info: ModelInfo, req: TurnRequest, serverFallback = false) {
  const order: CacheTier[] = ["static", "project", "run"];
  const blocks = [...req.system].sort((a, b) => order.indexOf(a.tier) - order.indexOf(b.tier));
  const system = blocks.map((b, i) =>
    blocks[i + 1]?.tier !== b.tier ? { type: "text" as const, text: b.text, cache_control: { type: "ephemeral" as const, ttl: TTL[b.tier] } } : { type: "text" as const, text: b.text },
  );
  const strict = req.tools.length <= STRICT_TOOLS_MAX;
  const fallback = serverFallback && FALLBACK_MODELS.test(info.model);
  return {
    model: info.model,
    max_tokens: req.maxOutputTokens,
    system,
    messages: req.messages.map((m) => toParam(info, m)).filter((m) => m.content.length > 0),
    tools: req.tools.map((t) =>
      strict
        ? { name: t.name, description: t.description, input_schema: closedSchema(t.schema), strict: true }
        : { name: t.name, description: t.description, input_schema: closedSchema(t.schema) },
    ),
    thinking: { type: "adaptive", display: "summarized" },
    output_config: { effort: req.effort, ...(req.format ? { format: { type: "json_schema", schema: closedSchema(req.format) } } : {}) },
    cache_control: { type: "ephemeral" },
    ...(fallback ? { betas: [FALLBACK_BETA], fallbacks: "default" } : {}),
  };
}

type Param = { role: "user" | "assistant"; content: unknown[] };

function toParam(info: ModelInfo, m: Message): Param {
  if (m.role === "user")
    return {
      role: "user",
      content: m.content.map((b) =>
        b.type === "text" ? { type: "text", text: b.text } : { type: "tool_result", tool_use_id: b.toolUseId, content: b.content, ...(b.isError ? { is_error: true } : {}) },
      ),
    };
  const content: unknown[] = [];
  for (const b of m.content) {
    if (b.type === "text") content.push({ type: "text", text: b.text });
    else if (b.type === "tool_use") content.push({ type: "tool_use", id: b.id, name: b.name, input: b.input });
    // the API drops, unbilled, a block the current model can't read; we keep it to the same model
    else if (b.provider === "anthropic" && b.model === info.model) content.push(b.data);
  }
  return { role: "assistant", content };
}

interface ApiBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
  thinking?: string;
}

function toBlocks(info: ModelInfo, content: ApiBlock[]): AssistantBlock[] {
  const out: AssistantBlock[] = [];
  for (const b of content) {
    if (b.type === "text") out.push({ type: "text", text: b.text ?? "" });
    else if (b.type === "tool_use") out.push({ type: "tool_use", id: b.id!, name: b.name!, input: b.input });
    else if (b.type === "thinking" || b.type === "redacted_thinking")
      out.push({ type: "reasoning", provider: "anthropic", model: info.model, data: b, ...(b.thinking ? { summary: b.thinking } : {}) });
  }
  return out;
}

export function toUsage(u: Partial<Anthropic.Usage> | undefined | null): Usage {
  if (!u) return emptyUsage();
  return { input: u.input_tokens ?? 0, output: u.output_tokens ?? 0, cacheRead: u.cache_read_input_tokens ?? 0, cacheWrite: u.cache_creation_input_tokens ?? 0 };
}

export function toStop(r: string | null | undefined): StopReason {
  switch (r) {
    case "end_turn":
    case "stop_sequence":
    case "pause_turn":
      return "end";
    case "tool_use":
      return "tool_use";
    case "max_tokens":
      return "max_tokens";
    case "refusal":
      return "refusal";
    default:
      return "error";
  }
}

export class AnthropicClient implements ModelClient {
  readonly client: Anthropic;
  constructor(
    readonly info: ModelInfo,
    private opts: AnthropicOptions,
  ) {
    this.client = new Anthropic({ apiKey: opts.apiKey, ...(opts.baseURL ? { baseURL: opts.baseURL } : {}), maxRetries: opts.maxRetries ?? 5 });
  }

  async countTokens(req: TurnRequest): Promise<number> {
    const p = anthropicParams(this.info, req);
    const r = await this.client.messages.countTokens({ model: p.model, system: p.system, messages: p.messages, tools: p.tools } as unknown as Anthropic.MessageCountTokensParams);
    return r.input_tokens;
  }

  async *stream(req: TurnRequest, signal?: AbortSignal): AsyncIterable<ModelEvent> {
    const params = anthropicParams(this.info, req, this.opts.serverFallback ?? true);
    // the beta endpoint carries the fallback beta; the plain one otherwise
    const stream = "betas" in params
      ? this.client.beta.messages.stream(params as unknown as Anthropic.Beta.MessageCreateParamsStreaming, { signal })
      : this.client.messages.stream(params as unknown as Anthropic.MessageCreateParamsStreaming, { signal });
    let text = "";
    try {
      for await (const ev of stream as AsyncIterable<Anthropic.MessageStreamEvent>) {
        if (ev.type === "content_block_start" && ev.content_block.type === "tool_use")
          yield { type: "tool_call_start", id: ev.content_block.id, name: ev.content_block.name };
        if (ev.type !== "content_block_delta") continue;
        if (ev.delta.type === "text_delta") {
          text += ev.delta.text;
          yield { type: "text", delta: ev.delta.text };
        } else if (ev.delta.type === "thinking_delta") yield { type: "reasoning_summary", delta: ev.delta.thinking };
      }
      const msg = (await stream.finalMessage()) as unknown as { content: ApiBlock[]; stop_reason: string | null; usage: Anthropic.Usage; stop_details?: { category?: string | null; explanation?: string } | null };
      const stop = toStop(msg.stop_reason);
      yield {
        type: "done",
        message: { role: "assistant", content: toBlocks(this.info, msg.content) },
        stop,
        usage: toUsage(msg.usage),
        ...(stop === "refusal" ? { detail: [msg.stop_details?.category, msg.stop_details?.explanation].filter(Boolean).join(": ") || "refused" } : {}),
      };
    } catch (e) {
      if (signal?.aborted) {
        yield { type: "done", message: { role: "assistant", content: text ? [{ type: "text", text }] : [] }, stop: "cancelled", usage: emptyUsage() };
        return;
      }
      throw e;
    }
  }
}
