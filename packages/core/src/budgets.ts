// Budget math (scope §12), kept pure so it is tested apart from the database.
// The worker locks every applicable row FOR UPDATE and calls `check` inside
// that transaction; nothing reaches the model unless every budget has room.

export const BUDGET_SCOPES = ["global_day", "global_month", "project", "card", "meeting", "agent_day"] as const;
export type BudgetScope = (typeof BUDGET_SCOPES)[number];

export interface BudgetRow {
  id: number;
  scope: BudgetScope;
  scopeId: string | null;
  limitUsd: number;
  warnPct: number[];
  spentUsd: number;
  reservedUsd: number;
}

export interface CallScope {
  projectId?: string | null;
  cardId?: string | null;
  meetingId?: string | null;
  agentId?: string | null;
}

export type CheckResult = { ok: true } | { ok: false; blocking: BudgetRow[] };

export function check(rows: BudgetRow[], estimateUsd: number): CheckResult {
  const blocking = rows.filter((r) => r.spentUsd + r.reservedUsd + estimateUsd > r.limitUsd + 1e-9);
  return blocking.length ? { ok: false, blocking } : { ok: true };
}

/** Period start for time-boxed scopes, in a timezone: the local midnight (day) or the first of the month. */
export function periodStart(scope: BudgetScope, timeZone: string, now = new Date()): string | null {
  if (scope !== "global_day" && scope !== "global_month" && scope !== "agent_day") return null;
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return scope === "global_month" ? `${get("year")}-${get("month")}-01` : `${get("year")}-${get("month")}-${get("day")}`;
}

/** Thresholds crossed by moving from `before` to `after` spent (percent of limit). 100 is always a threshold. */
export function crossed(limitUsd: number, warnPct: number[], before: number, after: number): number[] {
  if (limitUsd <= 0) return [];
  const marks = [...new Set([...warnPct, 100])].sort((a, b) => a - b);
  const pb = (before / limitUsd) * 100;
  const pa = (after / limitUsd) * 100;
  return marks.filter((m) => pb < m && pa >= m);
}

/** Alert level for a crossed threshold (§12 Alerts). */
export function alertLevel(pct: number): { level: "info" | "warn" | "critical"; ntfy: false | "default" | "high" } {
  if (pct >= 100) return { level: "critical", ntfy: "high" };
  if (pct >= 80) return { level: "warn", ntfy: "default" };
  return { level: "info", ntfy: false };
}

/** Runaway pattern: more than `max` calls in `windowMs` on one card. */
export function isRunaway(callTimes: Date[], now = new Date(), max = 30, windowMs = 10 * 60_000): boolean {
  return callTimes.filter((t) => now.getTime() - t.getTime() <= windowMs).length > max;
}
