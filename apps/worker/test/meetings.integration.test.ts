// Integration tests (scope §9, §21, §25): meetings driven by the worker, docs and the
// journal, on a real Postgres with a scripted model. Skipped unless
// TEST_DATABASE_URL points at a database that may be wiped.
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pino from "pino";
import { beforeAll, describe, expect, it } from "vitest";
import { Envelope, loadConfig } from "@miniasys/core";
import {
  addJournalEntry, agents, cards, connect, deleteDoc, DocConflict, expectedSpeakers, journalEntries, meetingView, postTurn, projects, putDoc, readDoc, startMeeting, eq, type Database, type Indexer,
} from "@miniasys/db";
import { runMigrations } from "@miniasys/db/migrate";
import { seed } from "@miniasys/db/seed";
import { Decider, MockClient, type ScriptedTurn } from "@miniasys/llm";
import { defaultRegistry } from "@miniasys/tools";
import { Budgets } from "../src/budgets.ts";
import { Journal } from "../src/journal.ts";
import { Meetings } from "../src/meetings.ts";
import { Models } from "../src/models.ts";
import { Notifier } from "../src/notifier.ts";
import type { Services } from "../src/services.ts";
import { ProjectRepos } from "@miniasys/projects";

const url = process.env.TEST_DATABASE_URL;
const d: Database | null = url ? connect(url, 4) : null;
let script: ScriptedTurn[] = [];
const indexed: string[] = [];
const index: Indexer = async (n) => void indexed.push(`${n.sourceType}:${n.content.slice(0, 40)}`);
const sent: { name: string; data: unknown }[] = [];

async function services(): Promise<Services> {
  const log = pino({ level: "silent" });
  const notifier = new Notifier(d!, null, "http://127.0.0.1:3000", log);
  const tmp = await mkdtemp(join(tmpdir(), "miniasys-mt-"));
  return {
    config: { ...loadConfig({ DATABASE_URL: url! }), workspacesDir: tmp, skillsDir: join(tmp, "skills") },
    d: d!, log, boss: { send: async (name: string, data: unknown) => void sent.push({ name, data }) } as unknown as Services["boss"],
    models: new Models({ apiKey: "test" }, () => new MockClient(script)),
    decider: new Decider(null, null), sandbox: null, notifier,
    budgets: new Budgets(d!, "America/Sao_Paulo", notifier), journal: new Journal(d!),
    registry: defaultRegistry(), github: null,
    embeddings: { embed: async () => [], model: "none" } as unknown as Services["embeddings"],
    envelope: new Envelope(null),
    repos: new ProjectRepos(join(tmp, "projects")),
  };
}

const json = (v: unknown): ScriptedTurn => ({ content: [{ type: "text", text: JSON.stringify(v) }] });
const uniq = () => `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

async function project() {
  const [p] = await d!.db.insert(projects).values({ slug: uniq(), name: "Test" }).returning();
  return p!;
}
async function external(slug = uniq()) {
  const [a] = await d!.db.insert(agents).values({ slug, name: slug, role: "worker", runtime: "external" }).returning();
  return a!;
}

describe.skipIf(!url)("docs and journal", () => {
  beforeAll(async () => {
    await runMigrations(d!);
    await seed(d!.db);
  });

  it("versions docs, refuses stale writes, and keeps counting after a delete", async () => {
    const p = await project();
    expect((await putDoc(d!, { projectId: p.id, slug: "overview", body: "v1", baseVersion: 0, actor: "user" }, index)).version).toBe(1);
    expect((await putDoc(d!, { projectId: p.id, slug: "overview", body: "v1", actor: "user" }, index)).unchanged).toBe(true);
    expect((await putDoc(d!, { projectId: p.id, slug: "overview", body: "v2", baseVersion: 1, actor: "agent:x" }, index)).version).toBe(2);
    await expect(putDoc(d!, { projectId: p.id, slug: "overview", body: "lost", baseVersion: 1, actor: "user" }, index)).rejects.toThrow(DocConflict);
    expect((await readDoc(d!, p.id, "overview", 1))?.body).toBe("v1");
    expect(await deleteDoc(d!, p.id, "overview", "user")).toBe(true);
    expect(await readDoc(d!, p.id, "overview")).toBeNull();
    expect((await putDoc(d!, { projectId: p.id, slug: "overview", body: "again", baseVersion: 0, actor: "user" }, index)).version).toBe(3);
    expect(indexed.filter((x) => x.startsWith("doc:")).length).toBe(3);
  });

  it("logs journal entries with their actor and indexes them", async () => {
    const p = await project();
    const e = await addJournalEntry(d!, { projectId: p.id, actor: "agent:harness", kind: "decision", title: "Use DuckDB", body: "small" }, index);
    const [row] = await d!.db.select().from(journalEntries).where(eq(journalEntries.id, e.id));
    expect(row).toMatchObject({ actor: "agent:harness", kind: "decision", title: "Use DuckDB" });
    expect(indexed.some((x) => x.startsWith("journal:[decision] Use DuckDB"))).toBe(true);
  });
});

describe.skipIf(!url)("meetings", () => {
  beforeAll(async () => {
    await runMigrations(d!);
    await seed(d!.db);
  });

  it("opens round 1 at start, takes one turn per agent per round, and asks the questioned agents next", async () => {
    const p = await project();
    const [a, b] = [await external(), await external()];
    const m = await startMeeting(d!, { projectId: p.id, topic: "Error format", participantIds: [a.id, b.id], createdBy: "user" });
    expect(m.round).toBe(1);
    await postTurn(d!, m.id, { agentId: a.id, actor: `agent:${a.slug}` }, { done: "x", questions: [{ to: b.slug, question: "codes?" }] });
    await expect(postTurn(d!, m.id, { agentId: a.id, actor: `agent:${a.slug}` }, { done: "again" })).rejects.toThrow(/already posted/);
    await expect(postTurn(d!, m.id, { agentId: a.id, actor: `agent:${a.slug}` }, {})).rejects.toThrow(/empty/);
    const outsider = await external();
    await expect(postTurn(d!, m.id, { agentId: outsider.id, actor: `agent:${outsider.slug}` }, { done: "x" })).rejects.toThrow(/not a participant/);
    await postTurn(d!, m.id, { agentId: b.id, actor: `agent:${b.slug}` }, { done: "y", action_items: [{ title: "Add fuzz tests", assignee: b.slug }] });

    const s = await services();
    await new Meetings(s).step(m.id);
    const v = await meetingView(d!, m.id);
    expect(v.meeting.round).toBe(2);
    expect(expectedSpeakers(v).map((x) => x.slug)).toEqual([b.slug]);
  });

  it("closes when nobody is asked anything: minutes, action items as cards, a journal milestone", async () => {
    const p = await project();
    const [a, b] = [await external(), await external()];
    const m = await startMeeting(d!, { projectId: p.id, topic: "Release", participantIds: [a.id, b.id], createdBy: "user" });
    await postTurn(d!, m.id, { agentId: a.id, actor: `agent:${a.slug}` }, { done: "draft", action_items: [{ title: "Publish the checklist", kind: "ops", assignee: a.slug }] });
    await postTurn(d!, m.id, { agentId: b.id, actor: `agent:${b.slug}` }, { done: "review" });
    // the minutes writer (API engine here) answers with minutes and one more action item, plus a duplicate
    script = [json({ minutes: "## Decided\n- ship it", action_items: [{ title: "Tag the release", kind: "ops" }, { title: "publish the checklist", kind: "ops" }] })];
    const s = await services();
    await new Meetings(s).step(m.id);
    const v = await meetingView(d!, m.id);
    expect(v.meeting).toMatchObject({ status: "closed", closedBy: "system_one" });
    expect(v.meeting.minutes).toContain("ship it");
    const made = await d!.db.select().from(cards).where(eq(cards.meetingId, m.id));
    expect(made.map((c) => c.title).sort()).toEqual(["Publish the checklist", "Tag the release"]);
    expect(made.find((c) => c.title === "Publish the checklist")?.assigneeAgentId).toBe(a.id);
    expect(made.every((c) => c.source === "meeting")).toBe(true);
    const j = await d!.db.select().from(journalEntries).where(eq(journalEntries.meetingId, m.id));
    expect(j[0]).toMatchObject({ kind: "milestone", title: "Meeting: Release" });
  });

  it("waits for a harness until the deadline, then moves on without it", async () => {
    const p = await project();
    const [a, b] = [await external(), await external()];
    const m = await startMeeting(d!, { projectId: p.id, topic: "Waiting", participantIds: [a.id, b.id], roundMinutes: 1, createdBy: "user" });
    await postTurn(d!, m.id, { agentId: a.id, actor: `agent:${a.slug}` }, { done: "x" });
    const s = await services();
    sent.length = 0;
    await new Meetings(s).step(m.id, 1);
    expect(sent.some((j) => j.name === "meeting.step")).toBe(true); // a wake-up at the deadline
    expect((await meetingView(d!, m.id)).meeting.status).toBe("running");
    await d!.sql`UPDATE meetings SET round_deadline = now() - interval '1 second' WHERE id = ${m.id}`;
    script = [json({ minutes: "nothing", action_items: [] })];
    await new Meetings(s).step(m.id);
    const v = await meetingView(d!, m.id);
    expect(v.meeting.status).toBe("closed");
    expect(v.messages.some((x) => x.kind === "system" && JSON.stringify(x.content).includes(`No turn before the deadline from a/${b.slug}`))).toBe(true);
  });
});
