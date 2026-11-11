import { describe, expect, it } from "vitest";
import { alertLevel, cacheHitRatio, check, costOf, crossed, isRunaway, maxCostOf, periodStart, priceAt, type BudgetRow } from "../src/index.ts";

const opus = { inputPerMtok: 4, outputPerMtok: 20, cacheWritePerMtok: 5, cacheReadPerMtok: 0.2 };

describe("pricing", () => {
  it("prices every token kind", () => {
    expect(costOf({ input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0 }, opus)).toBe(4);
    expect(costOf({ input: 1000, output: 2000, cacheRead: 10_000, cacheWrite: 4000 }, opus)).toBeCloseTo(0.004 + 0.04 + 0.002 + 0.02, 6);
  });

  it("estimates the most a call can cost", () => {
    // 10k input at the higher of input/cache-write price, with a 10% margin, plus max_tokens of output
    expect(maxCostOf(10_000, 4000, opus)).toBeCloseTo((11_000 * 5 + 4000 * 20) / 1e6, 6);
  });

  it("computes the cache hit ratio", () => {
    expect(cacheHitRatio({ input: 100, output: 0, cacheRead: 900, cacheWrite: 0 })).toBe(0.9);
    expect(cacheHitRatio({ input: 0, output: 5, cacheRead: 0, cacheWrite: 0 })).toBe(0);
  });

  it("picks the price effective at the call", () => {
    const rows = [{ id: 1, effectiveFrom: "2026-01-01" }, { id: 2, effectiveFrom: "2026-06-01" }];
    expect(priceAt(rows, new Date("2026-03-01"))?.id).toBe(1);
    expect(priceAt(rows, new Date("2026-07-01"))?.id).toBe(2);
    expect(priceAt(rows, new Date("2025-07-01"))).toBeUndefined();
  });
});

describe("budgets", () => {
  const row = (spent: number, reserved = 0, limit = 2): BudgetRow => ({ id: 1, scope: "card", scopeId: "x", limitUsd: limit, warnPct: [50, 80], spentUsd: spent, reservedUsd: reserved });

  it("refuses a call that would pass any budget, counting reservations", () => {
    expect(check([row(1)], 0.5)).toEqual({ ok: true });
    expect(check([row(1, 0.6)], 0.5).ok).toBe(false);
    expect(check([row(0), row(1.9, 0, 2)], 0.2).ok).toBe(false);
    expect(check([row(1.5)], 0.5)).toEqual({ ok: true }); // exactly at the limit is allowed
  });

  it("reports thresholds crossed, 100 included", () => {
    expect(crossed(2, [50, 80], 0.9, 1.7)).toEqual([50, 80]);
    expect(crossed(2, [50, 80], 1.7, 2.1)).toEqual([100]);
    expect(crossed(2, [50, 80], 1.1, 1.2)).toEqual([]);
    expect(alertLevel(100)).toEqual({ level: "critical", ntfy: "high" });
    expect(alertLevel(50).ntfy).toBe(false);
  });

  it("starts periods at the local day and month", () => {
    const at = new Date("2026-11-12T01:30:00Z"); // still the 11th in São Paulo
    expect(periodStart("global_day", "America/Sao_Paulo", at)).toBe("2026-11-11");
    expect(periodStart("global_month", "America/Sao_Paulo", at)).toBe("2026-11-01");
    expect(periodStart("card", "America/Sao_Paulo", at)).toBeNull();
  });

  it("detects runaway call rates", () => {
    const now = new Date();
    const calls = Array.from({ length: 31 }, (_, i) => new Date(now.getTime() - i * 1000));
    expect(isRunaway(calls, now)).toBe(true);
    expect(isRunaway(calls.slice(0, 30), now)).toBe(false);
  });
});
