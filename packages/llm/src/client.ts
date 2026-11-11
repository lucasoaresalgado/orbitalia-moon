// The provider-neutral model layer (adapted from perguntai-v2's
// server/models/client.ts). The agent loop talks only to a ModelClient; each
// provider adapter keeps its specifics (caching, thinking replay, tool
// schemas, stop reasons, usage) to itself.
import { emptyUsage, type Usage } from "@miniasys/core";

export type Provider = "anthropic" | "colibri" | "mock";
export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

/** Opaque reasoning, replayed unchanged to the model that produced it and dropped elsewhere. */
export interface ReasoningBlock {
  type: "reasoning";
  provider: Provider;
  model: string;
  data: unknown;
  summary?: string;
}
export interface TextBlock {
  type: "text";
  text: string;
}
export interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: unknown;
}
export interface ToolResultBlock {
  type: "tool_result";
  toolUseId: string;
  content: string;
  isError?: boolean;
}

export type UserBlock = TextBlock | ToolResultBlock;
export type AssistantBlock = TextBlock | ToolUseBlock | ReasoningBlock;
export type Message = { role: "user"; content: UserBlock[] } | { role: "assistant"; content: AssistantBlock[] };

/** Cache tiers for system blocks: shared by every run (static), by a project (project), or this run's (run). */
export type CacheTier = "static" | "project" | "run";

export interface PromptBlock {
  text: string;
  tier: CacheTier;
}

export type JsonSchema = { type?: string | string[]; properties?: Record<string, JsonSchema>; required?: string[]; items?: JsonSchema; [k: string]: unknown };

export interface ToolSpec {
  name: string;
  description: string;
  schema: JsonSchema;
}

export interface TurnRequest {
  system: PromptBlock[];
  messages: Message[];
  tools: ToolSpec[];
  effort: Effort;
  maxOutputTokens: number;
  /** structured output: the final text is JSON matching this schema (output_config.format) */
  format?: JsonSchema;
}

export type StopReason = "end" | "tool_use" | "max_tokens" | "refusal" | "cancelled" | "error";

export type ModelEvent =
  | { type: "text"; delta: string }
  | { type: "reasoning_summary"; delta: string }
  | { type: "tool_call_start"; id: string; name: string }
  | {
      type: "done";
      message: { role: "assistant"; content: AssistantBlock[] };
      stop: StopReason;
      usage: Usage;
      detail?: string;
    };

export interface ModelInfo {
  id: string;
  provider: Provider;
  /** the name the provider's API expects */
  model: string;
}

export interface ModelClient {
  readonly info: ModelInfo;
  stream(req: TurnRequest, signal?: AbortSignal): AsyncIterable<ModelEvent>;
  /** input tokens of a request, for the pre-call budget estimate (§12) */
  countTokens?(req: TurnRequest): Promise<number>;
}

/** Collects a stream into its final event, for callers that don't render deltas. */
export async function complete(client: ModelClient, req: TurnRequest, signal?: AbortSignal): Promise<Extract<ModelEvent, { type: "done" }>> {
  let done: Extract<ModelEvent, { type: "done" }> | undefined;
  for await (const ev of client.stream(req, signal)) if (ev.type === "done") done = ev;
  if (!done) throw new Error("the model stream ended without a result");
  return done;
}

export const textOf = (m: { content: AssistantBlock[] }) =>
  m.content.filter((b): b is TextBlock => b.type === "text").map((b) => b.text).join("");

export { emptyUsage };
export type { Usage };
