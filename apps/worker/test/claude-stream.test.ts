import { describe, expect, it } from "vitest";
import { remaining, usageTokens } from "@miniasys/core";
import { ClaudeStream } from "../src/claudecode/stream.ts";

// the event shapes Claude Code 2.1 writes with --output-format stream-json --verbose
const lines = [
  { type: "system", subtype: "init", session_id: "s-1", model: "claude-sonnet-5-5", tools: [] },
  { type: "assistant", message: { id: "m1", content: [{ type: "text", text: "Looking at the code." }], usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 1000, cache_read_input_tokens: 0 } } },
  // the same message again, with its tool call and usage so far: counted once
  { type: "assistant", message: { id: "m1", content: [{ type: "tool_use", name: "Bash", input: { command: "pnpm test" } }], usage: { input_tokens: 10, output_tokens: 40, cache_creation_input_tokens: 1000, cache_read_input_tokens: 0 } } },
  { type: "user", message: { content: [{ type: "tool_result", content: "ok" }] } },
  { type: "assistant", message: { id: "m2", content: [{ type: "text", text: "Done." }], usage: { input_tokens: 3, output_tokens: 7, cache_creation_input_tokens: 0, cache_read_input_tokens: 2000 } } },
  { type: "rate_limit_event", rate_limit_info: {} },
].map((l) => JSON.stringify(l));

describe("Claude Code stream parser", () => {
  it("reads the session, text and tool calls, and counts usage once per message", () => {
    const p = new ClaudeStream();
    const events = lines.flatMap((l) => p.feed(l));
    expect(events.map((e) => e.kind)).toEqual(["init", "text", "tool", "text"]);
    expect(p.sessionId).toBe("s-1");
    expect(p.usage).toEqual({ input: 13, output: 47, cacheWrite: 1000, cacheRead: 2000 });
    expect(usageTokens(p.usage)).toBe(13 + 47 + 1000 + 200);
  });

  it("takes the final result, its errors, and its structured output", () => {
    const p = new ClaudeStream();
    p.feed(lines[0]!);
    const [r] = p.feed(JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "ok", num_turns: 2, session_id: "s-1", total_cost_usd: 0.01, usage: { input_tokens: 1, output_tokens: 2 }, structured_output: { verdict: "approve" } }));
    expect(r).toMatchObject({ kind: "result", ok: true, text: "ok", turns: 2, structured: { verdict: "approve" }, error: null });
    const [bad] = new ClaudeStream().feed(JSON.stringify({ type: "result", subtype: "error_max_turns", is_error: true, num_turns: 30 }));
    expect(bad).toMatchObject({ ok: false, error: "error_max_turns" });
  });

  it("ignores lines that aren't JSON", () => {
    expect(new ClaudeStream().feed("npm warn something")).toEqual([]);
  });
});

describe("token budgets", () => {
  it("finds what the tightest budget has left; a budget without a token limit never binds", () => {
    const row = (limit: number, spent: number, reserved = 0) => ({ id: 1, scope: "card" as const, scopeId: null, limitUsd: limit, warnPct: [50, 80], spentUsd: spent, reservedUsd: reserved });
    expect(remaining([row(1_000_000, 200_000, 100_000), row(5_000_000, 4_500_000)])).toBe(500_000);
    expect(remaining([row(Infinity, 10)])).toBe(Infinity);
    expect(remaining([row(100, 150)])).toBe(0);
  });
});
