// Integration tests for the tester stage of the card pipeline (scope §27): after
// the checks pass, the tester runs; its verdict sends the card to review or back
// to the worker. Skipped unless TEST_DATABASE_URL points at a database that may be wiped.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pino from "pino";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Envelope, loadConfig } from "@miniasys/core";
import { cards, connect, createCard, projects, runs, and, eq, setSetting, SETTINGS, type Database } from "@miniasys/db";
import { runMigrations } from "@miniasys/db/migrate";
import { seed } from "@miniasys/db/seed";
import { Decider } from "@miniasys/llm";
import { defaultRegistry } from "@miniasys/tools";
import { ProjectRepos } from "@miniasys/projects";
import type { RunRow } from "../src/agent/loop.ts";
import { Budgets } from "../src/budgets.ts";
import { Journal } from "../src/journal.ts";
import { Models } from "../src/models.ts";
import { Notifier } from "../src/notifier.ts";
import { Pipeline } from "../src/pipeline.ts";
import { QUEUES, type Services } from "../src/services.ts";
import { Workspaces } from "../src/workspaces.ts";

const url = process.env.TEST_DATABASE_URL;
const d: Database | null = url ? connect(url, 4) : null;
let tmp: string;
let sent: { name: string; data: Record<string, unknown> }[] = [];

function services(): Services {
  const log = pino({ level: "silent" });
  const notifier = new Notifier(d!, null, "http://127.0.0.1:3000", log);
  return {
    config: { ...loadConfig({ DATABASE_URL: url! }), workspacesDir: tmp, skillsDir: join(tmp, "skills") },
    d: d!, log,
    boss: { send: async (name: string, data: Record<string, unknown>) => (sent.push({ name, data }), null) } as unknown as Services["boss"],
    models: new Models({ apiKey: null }, null), decider: new Decider(null, null), sandbox: null, notifier,
    budgets: new Budgets(d!, "America/Sao_Paulo", notifier), journal: new Journal(d!),
    registry: defaultRegistry(), github: null,
    embeddings: { embed: async () => [], model: "none" } as unknown as Services["embeddings"],
    envelope: new Envelope(null), repos: new ProjectRepos(join(tmp, "projects")),
  };
}

/** a card whose worker just finished: in progress, assigned to a/dev */
async function finishedCard() {
  const [project] = await d!.db.insert(projects).values({ slug: `q${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name: "QA" }).returning();
  const card = await createCard(d!, project!.id, { title: "Parse dates", acceptanceCriteria: ["accepts ISO dates"] }, "user");
  const [dev] = await d!.sql<{ id: string }[]>`SELECT id FROM agents WHERE slug = 'dev'`;
  await d!.db.update(cards).set({ status: "in_progress", assigneeAgentId: dev!.id }).where(eq(cards.id, card!.id));
  return card!;
}

const status = async (id: string) => (await d!.db.select({ s: cards.status }).from(cards).where(eq(cards.id, id)))[0]!.s;
const qaRun = async (cardId: string) => (await d!.db.select().from(runs).where(and(eq(runs.cardId, cardId), eq(runs.kind, "qa"))))[0] as RunRow | undefined;
/** the tester's run ends with this report */
async function finishQa(p: Pipeline, run: RunRow, report: string, final: "succeeded" | "failed" = "succeeded") {
  await d!.db.update(runs).set({ status: final, summary: final === "succeeded" ? report : null, error: final === "failed" ? report : null, finishedAt: new Date() }).where(eq(runs.id, run.id));
  await p.onRunFinished(run, final);
}

describe.skipIf(!url)("tester stage (Postgres)", () => {
  beforeAll(async () => {
    tmp = await mkdtemp(join(tmpdir(), "miniasys-qa-"));
    await d!.sql`DROP SCHEMA IF EXISTS public CASCADE`;
    await d!.sql`DROP SCHEMA IF EXISTS drizzle CASCADE`;
    await d!.sql`CREATE SCHEMA public`;
    await runMigrations(d!);
    await seed(d!.db);
  });
  beforeEach(async () => {
    sent = [];
    await setSetting(d!.db, SETTINGS.agentMode, { mode: "multi", agent: "dev" });
    await d!.sql`UPDATE agents SET deleted_at = NULL WHERE role = 'tester'`;
  });
  afterAll(async () => {
    await d?.close();
    if (tmp) await rm(tmp, { recursive: true, force: true });
  });

  const pipeline = () => new Pipeline(services(), new Workspaces(tmp, null, new ProjectRepos(join(tmp, "projects"))));

  it("is seeded as a/tester with the tester role", async () => {
    const [t] = await d!.sql<{ role: string; active: boolean }[]>`SELECT role, active_version_id IS NOT NULL AS active FROM agents WHERE slug = 'tester'`;
    expect(t).toEqual({ role: "tester", active: true });
  });

  it("tests after the checks pass, then sends a passing card to review with its report", async () => {
    const p = pipeline();
    const card = await finishedCard();
    await p.checks(card.id, card.id);
    expect(await status(card.id)).toBe("checks");
    const run = await qaRun(card.id);
    expect(run?.status).toBe("queued");
    expect(sent.find((s) => s.name === QUEUES.cardReview)).toBeUndefined();

    await finishQa(p, run!, "All criteria met; added tests/test_dates.py.\nVERDICT: pass");
    expect(await status(card.id)).toBe("in_review");
    const review = sent.find((s) => s.name === QUEUES.cardReview);
    expect(review?.data.testReport).toContain("added tests/test_dates.py");
  });

  it("sends a failing card back to its worker with the report, and blocks it after three failures", async () => {
    const p = pipeline();
    const card = await finishedCard();
    for (let i = 1; i <= 3; i++) {
      await p.checks(card.id, card.id);
      const run = (await d!.db.select().from(runs).where(and(eq(runs.cardId, card.id), eq(runs.kind, "qa"), eq(runs.status, "queued"))))[0] as RunRow;
      await finishQa(p, run, `Empty input crashes parse().\nVERDICT: fail`);
      if (i < 3) {
        expect(await status(card.id)).toBe("in_progress");
        const [work] = await d!.sql<{ input: { feedback: string }; status: string }[]>`SELECT input, status FROM runs WHERE card_id = ${card.id} AND kind = 'agent' ORDER BY created_at DESC LIMIT 1`;
        expect(work!.input.feedback).toContain("Empty input crashes");
        // the worker "fixes" it
        await d!.sql`UPDATE runs SET status = 'succeeded' WHERE card_id = ${card.id} AND kind = 'agent'`;
      }
    }
    expect(await status(card.id)).toBe("blocked");
  });

  it("goes to review anyway when the tester couldn't finish", async () => {
    const p = pipeline();
    const card = await finishedCard();
    await p.checks(card.id, card.id);
    await finishQa(p, (await qaRun(card.id))!, "model overloaded", "failed");
    expect(await status(card.id)).toBe("in_review");
    expect(String(sent.find((s) => s.name === QUEUES.cardReview)?.data.testReport)).toContain("couldn't finish");
  });

  it("is skipped when no tester is deployed, and in single-agent mode", async () => {
    const p = pipeline();
    await d!.sql`UPDATE agents SET deleted_at = now() WHERE role = 'tester'`;
    const a = await finishedCard();
    await p.checks(a.id, a.id);
    expect(await qaRun(a.id)).toBeUndefined();
    expect(await status(a.id)).toBe("in_review");

    await d!.sql`UPDATE agents SET deleted_at = NULL WHERE role = 'tester'`;
    await setSetting(d!.db, SETTINGS.agentMode, { mode: "single", agent: "dev" });
    const b = await finishedCard();
    await p.checks(b.id, b.id);
    expect(await qaRun(b.id)).toBeUndefined();
    expect(await status(b.id)).toBe("in_review");
  });
});
