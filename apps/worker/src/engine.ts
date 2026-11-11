// Which engine answers for a role (Settings → Models): the API (per-token
// billing) or the Claude subscription (Claude Code in a sandbox). Single calls
// (briefs, reviews, the daily report) go through `singleCall`, which picks.
import type { CallScope } from "@miniasys/core";
import { getSetting, SETTINGS, DEFAULT_ENGINES, type Engine, type EngineSettings } from "@miniasys/db";
import { textOf, type JsonSchema, type PromptBlock } from "@miniasys/llm";
import { runClaudeCode } from "./claudecode/runner.ts";
import { callModel } from "./modelcall.ts";
import type { Services } from "./services.ts";

const ROLE_KEY: Record<string, keyof EngineSettings> = { manager: "manager", worker: "worker", reviewer: "reviewer", brief_writer: "brief_writer", minutes: "brief_writer" };

export async function engineFor(s: Services, role: string): Promise<Engine> {
  const key = ROLE_KEY[role];
  if (!key) return "api";
  const engines = await getSetting<EngineSettings>(s.d.db, SETTINGS.engines, DEFAULT_ENGINES);
  return engines[key] === "claude_code" ? "claude_code" : "api";
}

export interface SingleCall {
  role: string;
  /** a run row to attach usage to (single calls on the subscription need one for their sandbox) */
  runId: string;
  scope: CallScope & { agentVersionId?: string | null };
  model: string;
  system: PromptBlock[];
  prompt: string;
  maxOutputTokens: number;
  effort: "low" | "medium" | "high";
  format?: JsonSchema;
}

/** One answer from the role's engine: its text, and the parsed JSON when a format was asked for. */
export async function singleCall(s: Services, c: SingleCall): Promise<{ text: string; json: unknown }> {
  if ((await engineFor(s, c.role)) === "claude_code") {
    const r = await runClaudeCode(s, {
      runId: c.runId, scope: c.scope, model: c.model, prompt: c.prompt, systemAppend: c.system.map((b) => b.text).join("\n\n"),
      workspace: null, homeKey: c.runId, tools: "none", maxTurns: 3, jsonSchema: c.format ?? null,
      capTokens: Math.max(150_000, c.maxOutputTokens * 20), timeoutS: 600, signal: AbortSignal.timeout(660_000),
    });
    if (!r.ok) throw new Error(r.error ?? (r.stopped === "budget" ? "token budget reached" : "Claude Code failed"));
    return { text: r.text, json: c.format ? (r.structured ?? JSON.parse(r.text)) : null };
  }
  const { done } = await callModel(s, {
    runId: c.runId, scope: c.scope, model: c.model,
    req: { system: c.system, messages: [{ role: "user", content: [{ type: "text", text: c.prompt }] }], tools: [], effort: c.effort, maxOutputTokens: c.maxOutputTokens, ...(c.format ? { format: c.format } : {}) },
  });
  const text = textOf(done.message);
  return { text, json: c.format ? JSON.parse(text) : null };
}
