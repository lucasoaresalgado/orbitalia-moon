// Orbits in the card pipeline (scope §27): a project's orbit decides who gets its
// cards, who tests and who reviews. Skipped unless TEST_DATABASE_URL points at a
// database that may be wiped.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pino from "pino";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Envelope, loadConfig } from "@miniasys/core";
import { cards, connect, createCard, orbitAgents, orbits, projects, runs, and, eq, setSetting, SETTINGS, projectOrbit, defaultOrbitId, type Database } from "@miniasys/db";
import { runMigrations } from "@miniasys/db/migrate";
import { seed } from "@miniasys/db/seed";
import { Decider } from "@miniasys/llm";
import { defaultRegistry } from "@miniasys/tools";
import { ProjectRepos } from "@miniasys/projects";
import { Budgets } from "../src/budgets.ts";
import { Journal } from "../src/journal.ts";
import { Models } from "../src/models.ts";
import { Notifier } from "../src/notifier.ts";
import { Pipeline } from "../src/pipeline.ts";
import type { Services } from "../src/services.ts";
import { Workspaces } from "../src/workspaces.ts";

const url = process.env.TEST_DATABASE_URL;
const d: Database | null = url ? connect(url, 4) : null;
let tmp: string;

function services(): Services {
  const log = pino({ level: "silent" });
  const notifier = new Notifier(d!, null, "http://127.0.0.1:3000", log);
  return {
    config: { ...loadConfig({ DATABASE_URL: url! }), workspacesDir: tmp, skillsDir: join(tmp, "skills") },
    d: d!, log, boss: { send: async () => null } as unknown as Services["boss"],
    models: new Models({ apiKey: null }, null), decider: new Decider(null, null), sandbox: null, notifier,
    budgets: new Budgets(d!, "America/Sao_Paulo", notifier), journal: new Journal(d!),
    registry: defaultRegistry(), github: null,
    embeddings: { embed: async () => [], model: "none" } as unknown as Services["embeddings"],
    envelope: new Envelope(null), repos: new ProjectRepos(join(tmp, "projects")),
  };
}
const pipeline = () => new Pipeline(services(), new Workspaces(tmp, null, new ProjectRepos(join(tmp, "projects"))));
const idOf = async (slug: string) => (await d!.sql<{ id: string }[]>`SELECT id FROM agents WHERE slug = ${slug}`)[0]!.id;

/** an orbit with these agents, and a project on it with a ready card */
async function setup(members: string[], name = "Squad") {
  const [o] = await d!.db.insert(orbits).values({ slug: `o${Math.random().toString(36).slice(2, 8)}`, name }).returning();
  for (const m of members) await d!.db.insert(orbitAgents).values({ orbitId: o!.id, agentId: await idOf(m) });
  const [p] = await d!.db.insert(projects).values({ slug: `p${Math.random().toString(36).slice(2, 8)}`, name: "P", orbitId: o!.id }).returning();
  const card = await createCard(d!, p!.id, { title: "Load the CSV", acceptanceCriteria: ["rows land in silver"] }, "user");
  await d!.db.update(cards).set({ status: "ready", brief: "Load the CSV." }).where(eq(cards.id, card!.id));
  return { orbit: o!, project: p!, card: card! };
}
const card = async (id: string) => (await d!.db.select().from(cards).where(eq(cards.id, id)))[0]!;

describe.skipIf(!url)("orbits in the pipeline (Postgres)", () => {
  beforeAll(async () => {
    tmp = await mkdtemp(join(tmpdir(), "miniasys-orbit-"));
    await d!.sql`DROP SCHEMA IF EXISTS public CASCADE`;
    await d!.sql`DROP SCHEMA IF EXISTS drizzle CASCADE`;
    await d!.sql`CREATE SCHEMA public`;
    await runMigrations(d!);
    await seed(d!.db);
    // a second worker, deployed (a copy of a/dev's version)
    await d!.sql`INSERT INTO agents (slug, name, role) VALUES ('data-bot', 'Data bot', 'worker')`;
    await d!.sql`INSERT INTO agent_versions (agent_id, version, status, model, system_prompt, tools, skills, permissions, limits)
      SELECT (SELECT id FROM agents WHERE slug = 'data-bot'), 1, 'deployed', model, system_prompt, tools, skills, permissions, limits FROM agent_versions v JOIN agents a ON a.active_version_id = v.id WHERE a.slug = 'dev'`;
    await d!.sql`UPDATE agents SET active_version_id = (SELECT id FROM agent_versions WHERE agent_id = agents.id) WHERE slug = 'data-bot'`;
  });
  beforeEach(async () => {
    await setSetting(d!.db, SETTINGS.agentMode, { mode: "multi", agent: "dev" });
  });
  afterAll(async () => {
    await d?.close();
    if (tmp) await rm(tmp, { recursive: true, force: true });
  });

  it("puts every seeded agent in the default orbit, which serves projects without one", async () => {
    const [p] = await d!.db.insert(projects).values({ slug: "loose", name: "Loose" }).returning();
    const { orbit, members } = await projectOrbit(d!.db, p!.id);
    expect(orbit.id).toBe(await defaultOrbitId(d!.db));
    expect(members.map((m) => m.agent.slug)).toEqual(expect.arrayContaining(["luna", "dev", "tester", "reviewer", "brief-writer"]));
  });

  it("routes a card only to a worker of the project's orbit", async () => {
    const { card: c } = await setup(["data-bot", "reviewer"]);
    await pipeline().route(c.id);
    const after = await card(c.id);
    expect(after.assigneeAgentId).toBe(await idOf("data-bot"));
    expect(after.status).toBe("in_progress");
  });

  it("skips testing when the orbit has no tester, and reviews with the default reviewer when it has none", async () => {
    const { card: c } = await setup(["dev"]);
    await d!.db.update(cards).set({ status: "in_progress", assigneeAgentId: await idOf("dev") }).where(eq(cards.id, c.id));
    await pipeline().checks(c.id, c.id);
    expect((await card(c.id)).status).toBe("in_review");
    expect((await d!.db.select().from(runs).where(and(eq(runs.cardId, c.id), eq(runs.kind, "qa")))).length).toBe(0);
  });

  it("tests with the orbit's tester when it has one", async () => {
    const { card: c } = await setup(["dev", "tester"]);
    await d!.db.update(cards).set({ status: "in_progress", assigneeAgentId: await idOf("dev") }).where(eq(cards.id, c.id));
    await pipeline().checks(c.id, c.id);
    expect((await card(c.id)).status).toBe("checks");
    expect((await d!.db.select().from(runs).where(and(eq(runs.cardId, c.id), eq(runs.kind, "qa")))).length).toBe(1);
  });

  it("says so when the orbit has no worker", async () => {
    const { card: c } = await setup(["luna", "reviewer"], "Talkers");
    await expect(pipeline().route(c.id)).rejects.toThrow(/orbit "Talkers" has no deployed worker/);
  });
});
