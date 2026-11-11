// A run's events, numbered and stored, so the run drawer can replay a transcript
// from any point and follow it live (SSE topic run:<id>).
import { CHANNELS } from "@miniasys/core";
import { publish, type Database } from "@miniasys/db";

export type RunEvent =
  | { type: "status"; status: string; detail?: string }
  | { type: "turn_start"; turn: number; model: string }
  | { type: "text"; turn: number; text: string }
  | { type: "reasoning"; turn: number; text: string }
  | { type: "tool_start"; turn: number; id: string; name: string; input: unknown }
  | { type: "tool_end"; turn: number; id: string; name: string; ok: boolean; summary: string; ms: number }
  | { type: "approval"; turn: number; id: string; approvalId: string; kind: string }
  | { type: "usage"; turn: number; model: string; input: number; output: number; cacheRead: number; cacheWrite: number; costUsd: number }
  | { type: "compaction"; turn: number; tokensBefore: number }
  | { type: "error"; message: string };

export class Journal {
  constructor(private d: Database) {}

  async append(runId: string, ev: RunEvent): Promise<void> {
    await this.d.sql`
      INSERT INTO run_events (run_id, seq, type, data)
      SELECT ${runId}, COALESCE(MAX(seq), 0) + 1, ${ev.type}, ${JSON.stringify(ev)}::jsonb FROM run_events WHERE run_id = ${runId}`;
    await publish(this.d.sql, { topic: CHANNELS.run(runId), type: ev.type, data: ev });
  }
}
