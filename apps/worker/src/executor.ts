// Runs runs (scope §8.8; adapted from perguntai-v2's server/runs/executor.ts).
// A run is held by this process through a lease it renews every 30 s; when the
// laptop sleeps or the process dies, the lease lapses and the next look puts
// the run back to work from its last checkpoint.
import { hostname } from "node:os";
import { cardPath } from "@miniasys/core";
import { cards, moveCard, projects, runs, eq, getSetting, publish, SETTINGS } from "@miniasys/db";
import { executeRun, finish, type FinalStatus, type RunRow } from "./agent/loop.ts";
import type { Services } from "./services.ts";
import type { Workspaces } from "./workspaces.ts";

const LEASE = "2 minutes";
const HEARTBEAT_MS = 30_000;
const WALL_TIME_MS = 30 * 60_000;
const MAX_ATTEMPTS = 5;

export class Executor {
  readonly owner = `${hostname()}:${process.pid}:${crypto.randomUUID().slice(0, 8)}`;
  private running = new Map<string, { ac: AbortController; why?: "cancel" | "timeout" | "shutdown" }>();
  private stopping = false;
  private watcher: NodeJS.Timeout | null = null;

  constructor(
    private s: Services,
    private ws: Workspaces,
    private onFinished: (run: RunRow, status: FinalStatus) => Promise<void>,
    private maxConcurrent = 3,
  ) {}

  get active() {
    return [...this.running.keys()];
  }

  async start(runId: string): Promise<boolean> {
    if (this.stopping || this.running.has(runId) || this.running.size >= this.maxConcurrent) return false;
    if (await getSetting(this.s.d.db, SETTINGS.paused, false)) return false;
    const [run] = await this.s.d.sql<RunRow[]>`
      UPDATE runs SET lease_owner = ${this.owner}, lease_expires_at = now() + ${LEASE}::interval, status = 'running',
        started_at = COALESCE(started_at, now()), attempt = attempt + 1
      WHERE id = ${runId} AND status IN ('queued', 'running')
        AND (lease_expires_at IS NULL OR lease_expires_at < now() OR lease_owner = ${this.owner})
      RETURNING id`;
    if (!run) return false;
    const [row] = await this.s.d.db.select().from(runs).where(eq(runs.id, runId));
    const entry: { ac: AbortController; why?: "cancel" | "timeout" | "shutdown" } = { ac: new AbortController() };
    this.running.set(runId, entry);
    const beat = setInterval(() => {
      void this.s.d.sql`UPDATE runs SET lease_expires_at = now() + ${LEASE}::interval WHERE id = ${runId} AND lease_owner = ${this.owner}`.catch(() => {});
    }, HEARTBEAT_MS);
    const wall = setTimeout(() => {
      entry.why = "timeout";
      entry.ac.abort();
    }, WALL_TIME_MS);
    await this.s.journal.append(runId, { type: "status", status: "running" });
    await publish(this.s.d.sql, { topic: "runs", type: "status", data: { id: runId, status: "running" } });

    void (async () => {
      let status: FinalStatus = "interrupted";
      try {
        status = await executeRun(this.s, this.ws, row!, entry.ac.signal);
        if (status === "interrupted") status = await this.afterAbort(row!, entry.why);
        else if (status === "waiting_approval" || status === "waiting_input") {
          await this.s.d.sql`UPDATE runs SET status = ${status}, lease_owner = NULL, lease_expires_at = NULL WHERE id = ${runId}`;
          await this.s.journal.append(runId, { type: "status", status });
          await publish(this.s.d.sql, { topic: "runs", type: "status", data: { id: runId, status } });
        }
      } catch (e) {
        status = await this.retryOrFail(row!, e as Error);
      } finally {
        clearInterval(beat);
        clearTimeout(wall);
        this.running.delete(runId);
      }
      await this.onFinished(row!, status).catch((e) => this.s.log.error({ run: runId, err: (e as Error).message }, "after-run hook failed"));
      void this.recover();
    })();
    return true;
  }

  /** Stopped by cancel (the run ends), a timeout, or shutdown (handed back for later). */
  private async afterAbort(run: RunRow, why?: "cancel" | "timeout" | "shutdown"): Promise<FinalStatus> {
    if (why === "cancel") return finish(this.s, run, "canceled", { error: "canceled" });
    if (why === "timeout") {
      await this.s.d.sql`UPDATE runs SET status = 'timed_out', error = 'wall time exceeded', finished_at = now(), lease_owner = NULL, lease_expires_at = NULL WHERE id = ${run.id}`;
      await this.s.journal.append(run.id, { type: "status", status: "timed_out" });
      await this.blockCard(run, "timed out after 30 minutes");
      return "failed";
    }
    await this.s.d.sql`UPDATE runs SET lease_owner = NULL, lease_expires_at = NULL WHERE id = ${run.id} AND lease_owner = ${this.owner}`;
    return "interrupted";
  }

  /** API errors and the like: back to the queue with exponential backoff and jitter, then failed. */
  private async retryOrFail(run: RunRow, e: Error): Promise<FinalStatus> {
    const [r] = await this.s.d.db.select({ attempt: runs.attempt }).from(runs).where(eq(runs.id, run.id));
    const attempt = r?.attempt ?? 1;
    this.s.log.warn({ run: run.id, attempt, err: e.message }, "run error");
    if (attempt < MAX_ATTEMPTS) {
      const delayS = Math.min(600, 2 ** attempt * 5) * (0.75 + Math.random() / 2);
      await this.s.d.sql`UPDATE runs SET status = 'queued', lease_owner = NULL, lease_expires_at = now() + make_interval(secs => ${delayS}), error = ${e.message} WHERE id = ${run.id}`;
      await this.s.journal.append(run.id, { type: "error", message: `${e.message} (retrying in ${Math.round(delayS)}s)` });
      return "interrupted";
    }
    await this.s.journal.append(run.id, { type: "error", message: e.message });
    await finish(this.s, run, "failed", { error: e.message });
    await this.blockCard(run, e.message);
    return "failed";
  }

  private async blockCard(run: RunRow, why: string) {
    if (!run.cardId) {
      await this.s.notifier.notify({ level: "warn", title: `Run failed: ${run.kind}`, body: why, link: `/runs/${run.id}`, ntfy: "default" });
      return;
    }
    await moveCard(this.s.d, run.cardId, "blocked", "system", { blockedReason: "failed", note: why }).catch(() => {});
    const [c] = await this.s.d.db.select({ number: cards.number, slug: projects.slug }).from(cards).innerJoin(projects, eq(projects.id, cards.projectId)).where(eq(cards.id, run.cardId));
    await this.s.notifier.notify({ level: "warn", title: `Run failed on ${c ? cardPath(c.slug, c.number) : "a card"}`, body: why, link: `/runs/${run.id}`, ntfy: "default" });
  }

  cancel(runId: string) {
    const e = this.running.get(runId);
    if (e) {
      e.why = "cancel";
      e.ac.abort();
    }
  }

  /** Runs nobody holds: queued ones whose backoff is over, and running ones whose lease lapsed. */
  async recover(): Promise<number> {
    if (this.stopping) return 0;
    const free = this.maxConcurrent - this.running.size;
    if (free <= 0) return 0;
    const rows = await this.s.d.sql<{ id: string }[]>`
      SELECT id FROM runs WHERE status IN ('queued', 'running') AND (lease_expires_at IS NULL OR lease_expires_at < now())
      ORDER BY created_at LIMIT ${free}`;
    let n = 0;
    for (const r of rows) if (await this.start(r.id)) n++;
    return n;
  }

  watch(everyMs = 15_000) {
    this.watcher ??= setInterval(() => void this.recover().catch((e) => this.s.log.error({ err: (e as Error).message }, "recover failed")), everyMs);
  }

  async stop() {
    this.stopping = true;
    if (this.watcher) clearInterval(this.watcher);
    for (const e of this.running.values()) {
      e.why = "shutdown";
      e.ac.abort();
    }
    const deadline = Date.now() + 10_000;
    while (this.running.size && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
  }
}
