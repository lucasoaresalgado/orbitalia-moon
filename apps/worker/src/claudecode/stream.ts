// Parses Claude Code's `--output-format stream-json --verbose` lines: the
// session id, text and tool calls as they happen, and usage as it accumulates
// (one assistant message can arrive as several lines with the same id, each
// carrying that message's usage so far, so usage is kept per message id).
import { emptyUsage, type Usage } from "@miniasys/core";

export type StreamEvent =
  | { kind: "init"; sessionId: string; model: string }
  | { kind: "text"; text: string }
  | { kind: "tool"; name: string; input: unknown }
  | { kind: "result"; ok: boolean; text: string; sessionId: string | null; turns: number; usage: Usage; apiEquivalentUsd: number | null; structured: unknown; error: string | null };

interface ApiUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

export const fromApiUsage = (u: ApiUsage | undefined | null): Usage => ({
  input: u?.input_tokens ?? 0,
  output: u?.output_tokens ?? 0,
  cacheWrite: u?.cache_creation_input_tokens ?? 0,
  cacheRead: u?.cache_read_input_tokens ?? 0,
});

export class ClaudeStream {
  private perMessage = new Map<string, Usage>();
  sessionId: string | null = null;
  final: Extract<StreamEvent, { kind: "result" }> | null = null;

  /** Usage of every assistant message so far. */
  get usage(): Usage {
    const total = emptyUsage();
    for (const u of this.perMessage.values()) {
      total.input += u.input;
      total.output += u.output;
      total.cacheWrite += u.cacheWrite;
      total.cacheRead += u.cacheRead;
    }
    return total;
  }

  feed(line: string): StreamEvent[] {
    let e: Record<string, any>;
    try {
      e = JSON.parse(line);
    } catch {
      return [];
    }
    if (e.type === "system" && e.subtype === "init") {
      this.sessionId = e.session_id ?? null;
      return [{ kind: "init", sessionId: e.session_id, model: e.model }];
    }
    if (e.type === "assistant" && e.message) {
      const m = e.message as { id?: string; content?: { type: string; text?: string; name?: string; input?: unknown }[]; usage?: ApiUsage };
      if (m.usage) this.perMessage.set(m.id ?? `m${this.perMessage.size}`, fromApiUsage(m.usage));
      const out: StreamEvent[] = [];
      for (const b of m.content ?? []) {
        if (b.type === "text" && b.text) out.push({ kind: "text", text: b.text });
        else if (b.type === "tool_use") out.push({ kind: "tool", name: b.name ?? "?", input: b.input });
      }
      return out;
    }
    if (e.type === "result") {
      const usage = e.usage ? fromApiUsage(e.usage) : this.usage;
      this.final = {
        kind: "result",
        ok: e.subtype === "success" && !e.is_error,
        text: typeof e.result === "string" ? e.result : "",
        sessionId: e.session_id ?? this.sessionId,
        turns: e.num_turns ?? 0,
        usage,
        apiEquivalentUsd: typeof e.total_cost_usd === "number" ? e.total_cost_usd : null,
        structured: e.structured_output ?? null,
        error: e.is_error || e.subtype !== "success" ? String(e.result ?? e.subtype ?? "error") : null,
      };
      return [this.final];
    }
    return [];
  }
}
