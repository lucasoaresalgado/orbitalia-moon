// Integration tests (scope §21): the agent loop end to end on a real Postgres
// with a scripted model. Skipped unless TEST_DATABASE_URL points at a database
// that may be wiped (e.g. a throwaway pgvector container).
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { buildIndex, cortexFile } from "@miniasys/cortex";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pino from "pino";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Envelope, loadConfig } from "@miniasys/core";
import { approvals, budgetDefaults, cardNotes, cards, connect, createCard, projects, runs, toolCalls, eq, setSetting, SETTINGS, type Database } from "@miniasys/db";
import { runMigrations } from "@miniasys/db/migrate";
import { seed } from "@miniasys/db/seed";
import { Decider, MockClient, type ScriptedTurn } from "@miniasys/llm";
import { defaultRegistry } from "@miniasys/tools";
import { executeRun, type RunRow } from "../src/agent/loop.ts";
import { Budgets } from "../src/budgets.ts";
import { Journal } from "../src/journal.ts";
import { Models } from "../src/models.ts";
import { Notifier } from "../src/notifier.ts";
import type { Services } from "../src/services.ts";
import { Workspaces } from "../src/workspaces.ts";

const url = process.env.TEST_DATABASE_URL;
const d: Database | null = url ? connect(url, 4) : null;
let tmp: string;
let script: ScriptedTurn[] = [];
let mock: MockClient;

function services(): Services {
  const log = pino({ level: "silent" });
  const notifier = new Notifier(d!, null, "http://127.0.0.1:3000", log);
  return {
    config: { ...loadConfig({ DATABASE_URL: url! }), workspacesDir: tmp, skillsDir: join(tmp, "skills") },
    d: d!, log, boss: { send: async () => null } as unknown as Services["boss"],
    models: new Models({ apiKey: null }, () => mock),
    decider: new Decider(null, null), sandbox: null, notifier,
    budgets: new Budgets(d!, "America/Sao_Paulo", notifier), journal: new Journal(d!),
    registry: defaultRegistry(), github: null,
    embeddings: { embed: async () => [], model: "none" } as unknown as Services["embeddings"],
    envelope: new Envelope(null),
  };
}

async function newRun(o: { tools?: { name: string; requires_approval: boolean }[] } = {}) {
  const [project] = await d!.db.insert(projects).values({ slug: `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name: "Test" }).returning();
  const card = await createCard(d!, project!.id, { title: "Write a hello file", acceptanceCriteria: ["hello.txt exists"] }, "user");
  await d!.db.update(cards).set({ status: "in_progress" }).where(eq(cards.id, card!.id));
  const [dev] = await d!.sql<{ v: string }[]>`SELECT active_version_id AS v FROM agents WHERE slug = 'dev'`;
  if (o.tools) await d!.sql`UPDATE agent_versions SET tools = ${JSON.stringify(o.tools)}::jsonb WHERE id = ${dev!.v}`;
  const [run] = await d!.db.insert(runs).values({ kind: "agent", cardId: card!.id, projectId: project!.id, agentVersionId: dev!.v, status: "running", model: "claude-haiku-5-5" }).returning();
  return { run: run as RunRow, card: card!, project: project!, devVersion: dev!.v };
}

const reload = async (id: string) => (await d!.db.select().from(runs).where(eq(runs.id, id)))[0] as RunRow;
const toolUse = (id: string, name: string, input: unknown): ScriptedTurn => ({ content: [{ type: "tool_use", id, name, input }] });
const say = (text: string): ScriptedTurn => ({ content: [{ type: "text", text }] });

describe.skipIf(!url)("agent loop (Postgres + scripted model)", () => {
  let savedTools: unknown;
  beforeAll(async () => {
    tmp = await mkdtemp(join(tmpdir(), "miniasys-it-"));
    await d!.sql`DROP SCHEMA IF EXISTS public CASCADE`;
    await d!.sql`DROP SCHEMA IF EXISTS drizzle CASCADE`;
    await d!.sql`CREATE SCHEMA public`;
    await runMigrations(d!);
    await seed(d!.db);
    [{ tools: savedTools }] = await d!.sql`SELECT v.tools FROM agents a JOIN agent_versions v ON v.id = a.active_version_id WHERE a.slug = 'dev'`;
  });
  beforeEach(async () => {
    await d!.sql`UPDATE agent_versions v SET tools = ${JSON.stringify(savedTools)}::jsonb FROM agents a WHERE a.active_version_id = v.id AND a.slug = 'dev'`;
    await d!.sql`DELETE FROM budgets`;
    await d!.db.update(budgetDefaults).set({ limitUsd: 3, limitTokens: 5_000_000 }).where(eq(budgetDefaults.scope, "global_day"));
    await setSetting(d!.db, SETTINGS.budgetUnit, "usd");
  });
  afterAll(async () => {
    await d?.close();
    if (tmp) await rm(tmp, { recursive: true, force: true });
  });

  it("runs tools, records everything, and finishes", async () => {
    const s = services();
    const { run, card } = await newRun();
    script = [toolUse("t1", "write_file", { path: "hello.txt", content: "hi" }), toolUse("t2", "git_commit", { message: "Add hello" }), say("Done: wrote hello.txt.")];
    mock = new MockClient(script);
    const status = await executeRun(s, new Workspaces(tmp, null), run, new AbortController().signal);
    expect(status).toBe("succeeded");
    expect(await readFile(join(tmp, card.id, "hello.txt"), "utf8")).toBe("hi");
    const r = await reload(run.id);
    expect(r.summary).toContain("Done");
    expect(r.costUsd).toBeGreaterThan(0);
    const calls = await d!.db.select().from(toolCalls).where(eq(toolCalls.runId, run.id));
    expect(calls.map((c) => [c.name, c.status])).toEqual([["write_file", "ok"], ["git_commit", "ok"]]);
    const n = (await d!.sql<{ n: number }[]>`SELECT count(*)::int AS n FROM llm_calls WHERE run_id = ${run.id}`)[0]!.n;
    expect(n).toBe(3);
    // tool output went back wrapped as untrusted data only for tools that read outside content
    expect(JSON.stringify(mock.requests[1]!.messages.at(-1))).not.toContain("untrusted_data");
  });

  it("refuses a path outside the workspace without crashing the run", async () => {
    const s = services();
    const { run } = await newRun();
    mock = new MockClient([toolUse("t1", "read_file", { path: "../../etc/passwd" }), say("Could not read it.")]);
    expect(await executeRun(s, new Workspaces(tmp, null), run, new AbortController().signal)).toBe("succeeded");
    const last = mock.requests[1]!.messages.at(-1)!;
    expect(JSON.stringify(last)).toMatch(/outside the workspace|denied/);
  });

  it("pauses for an approval and resumes with the decision", async () => {
    const s = services();
    const { run, card } = await newRun({ tools: [{ name: "write_file", requires_approval: true }] });
    mock = new MockClient([toolUse("t1", "write_file", { path: "a.txt", content: "x" }), say("Wrote it after approval.")]);
    const ws = new Workspaces(tmp, null);
    expect(await executeRun(s, ws, run, new AbortController().signal)).toBe("waiting_approval");
    const [ap] = await d!.db.select().from(approvals).where(eq(approvals.runId, run.id));
    expect(ap?.kind).toBe("tool");
    expect((await d!.db.select().from(cards).where(eq(cards.id, card.id)))[0]!.status).toBe("blocked");

    // still pending: resuming waits again, no second approval
    expect(await executeRun(s, ws, await reload(run.id), new AbortController().signal)).toBe("waiting_approval");
    expect(await d!.db.select().from(approvals).where(eq(approvals.runId, run.id))).toHaveLength(1);

    await d!.db.update(approvals).set({ status: "approved", decidedAt: new Date() }).where(eq(approvals.id, ap!.id));
    expect(await executeRun(s, ws, await reload(run.id), new AbortController().signal)).toBe("succeeded");
    expect(await readFile(join(tmp, card.id, "a.txt"), "utf8")).toBe("x");
    expect((await d!.db.select().from(cards).where(eq(cards.id, card.id)))[0]!.status).toBe("in_progress");
  });

  it("blocks before the call when a budget would be passed", async () => {
    const s = services();
    await d!.db.update(budgetDefaults).set({ limitUsd: 0.0001 }).where(eq(budgetDefaults.scope, "global_day"));
    const { run, card } = await newRun();
    mock = new MockClient([say("never sent")]);
    expect(await executeRun(s, new Workspaces(tmp, null), run, new AbortController().signal)).toBe("waiting_approval");
    expect(mock.requests).toHaveLength(0);
    const [ap] = await d!.db.select().from(approvals).where(eq(approvals.runId, run.id));
    expect(ap?.kind).toBe("budget_raise");
    const c = (await d!.db.select().from(cards).where(eq(cards.id, card.id)))[0]!;
    expect([c.status, c.blockedReason]).toEqual(["blocked", "budget"]);
    const reserved = (await d!.sql<{ reserved: number }[]>`SELECT COALESCE(sum(reserved_usd), 0)::float8 AS reserved FROM budgets`)[0]!.reserved;
    expect(reserved).toBe(0);
  });

  it("counts tokens when the switch says so: dollars to spare don't help", async () => {
    await setSetting(d!.db, SETTINGS.budgetUnit, "tokens");
    await d!.db.update(budgetDefaults).set({ limitUsd: 1000, limitTokens: 50 }).where(eq(budgetDefaults.scope, "global_day"));
    const s = services();
    const { run } = await newRun();
    mock = new MockClient([say("never sent")]);
    await new Promise((r) => setTimeout(r, 5100)); // the unit is cached for 5 s
    expect(await executeRun(s, new Workspaces(tmp, null), run, new AbortController().signal)).toBe("waiting_approval");
    expect(mock.requests).toHaveLength(0);
    const [ap] = await d!.db.select().from(approvals).where(eq(approvals.runId, run.id));
    expect((ap!.request as { unit: string }).unit).toBe("tokens");
  });

  it("records tokens next to dollars on every call", async () => {
    const s = services();
    const { run } = await newRun();
    mock = new MockClient([say("hello")]);
    expect(await executeRun(s, new Workspaces(tmp, null), run, new AbortController().signal)).toBe("succeeded");
    const row = (await d!.sql<{ usd: number; tokens: number }[]>`SELECT spent_usd::float8 AS usd, spent_tokens::int AS tokens FROM budgets WHERE scope = 'global_day'`)[0]!;
    expect(row.usd).toBeGreaterThan(0);
    expect(row.tokens).toBe(150); // the mock's 100 in + 50 out
  });

  it("acts on Lucas's notes: before the run, and mid-run at the next turn; it may rewrite the card", async () => {
    const s = services();
    const { run, card } = await newRun();
    await d!.db.insert(cardNotes).values({ cardId: card.id, text: "Use a .txt file, and make the brief say so." });
    mock = new MockClient([
      toolUse("t1", "update_card", { brief: "Write hello.txt", acceptance_criteria: ["hello.txt exists", "it says hi"] }),
      toolUse("t2", "write_file", { path: "hello.txt", content: "hi" }),
      say("done"),
    ]);
    // a second note arrives while the agent works: after its first tool call
    const orig = mock.stream.bind(mock);
    let calls = 0;
    mock.stream = async function* (req) {
      if (++calls === 2) await d!.db.insert(cardNotes).values({ cardId: card.id, text: "Also add a newline at the end." });
      yield* orig(req);
    };
    const ws = new Workspaces(tmp, null);
    // the mid-run note is inserted during call 2 and delivered with call 3
    expect(await executeRun(s, ws, run, new AbortController().signal)).toBe("succeeded");
    expect(JSON.stringify(mock.requests[0]!.messages[0])).toContain("Use a .txt file");
    expect(JSON.stringify(mock.requests[2]!.messages.at(-1))).toContain("Also add a newline");
    const c = (await d!.db.select().from(cards).where(eq(cards.id, card.id)))[0]!;
    expect(c.brief).toBe("Write hello.txt");
    expect((c.acceptanceCriteria as { text: string }[]).map((x) => x.text)).toEqual(["hello.txt exists", "it says hi"]);
    const left = await d!.sql<{ n: number }[]>`SELECT count(*)::int AS n FROM card_notes WHERE card_id = ${card.id} AND handled_at IS NULL`;
    expect(left[0]!.n).toBe(0);
  });

  it("remembers in its limbic and reads its cortex, but only what is on the map", async () => {
    const s = services();
    s.config.lakehouseDir = join(tmp, "storage");
    s.config.cortexDir = join(tmp, "storage", "cortex");
    await mkdir(join(tmp, "storage", "docs"), { recursive: true });
    // the map covers only/; docs/private.md is on the storage but not on the map
    await writeFile(join(tmp, "storage", "docs", "private.md"), "# Not mapped\n\nsecret");
    await mkdir(join(tmp, "storage", "only"), { recursive: true });
    await writeFile(join(tmp, "storage", "only", "style.md"), "# Style guide\n\nAll files end with a newline and use two-space indentation.\n");
    await buildIndex({ file: cortexFile(s.config.cortexDir, "dev"), root: s.config.lakehouseDir, sources: ["only"], embed: null });
    const { run } = await newRun();
    mock = new MockClient([
      toolUse("t1", "cortex_search", { query: "style guide indentation" }),
      toolUse("t2", "cortex_read", { path: "only/style.md" }),
      toolUse("t3", "cortex_read", { path: "docs/private.md" }),
      toolUse("t4", "limbic_remember", { memory: "Files in this project use two-space indentation." }),
      say("done"),
    ]);
    expect(await executeRun(s, new Workspaces(tmp, null), run, new AbortController().signal)).toBe("succeeded");
    const results = mock.requests.slice(1).map((r) => JSON.stringify(r.messages.at(-1)));
    expect(results[0]).toContain("only/style.md");
    expect(results[1]).toContain("two-space indentation");
    expect(results[2]).toMatch(/isn't on this agent's cortex map/);
    expect(results[2]).not.toContain("secret");
    // the memory is in the next run's prompt
    const next = await newRun();
    mock = new MockClient([say("ok")]);
    await executeRun(s, new Workspaces(tmp, null), next.run, new AbortController().signal);
    expect(JSON.stringify(mock.requests[0]!.system)).toContain("two-space indentation");
  });

  it("resumes from its checkpoint after an interruption without repeating turns", async () => {
    const s = services();
    const { run } = await newRun();
    const ac = new AbortController();
    mock = new MockClient([toolUse("t1", "write_file", { path: "b.txt", content: "1" }), say("finished")]);
    // stop the run right after the first model turn has been checkpointed
    const orig = mock.stream.bind(mock);
    let calls = 0;
    mock.stream = async function* (req) {
      calls++;
      yield* orig(req);
      if (calls === 1) ac.abort();
    };
    expect(await executeRun(s, new Workspaces(tmp, null), run, ac.signal)).toBe("interrupted");
    const mid = await reload(run.id);
    expect((mid.checkpoint as { turn: number }).turn).toBe(1);
    expect(await executeRun(s, new Workspaces(tmp, null), mid, new AbortController().signal)).toBe("succeeded");
    expect(calls).toBe(2);
  });
});
