// Scripts (scope §26): Python, TypeScript, Bash or DuckDB SQL files under
// scripts/ in a project's code. Write and save them (each save a commit), run
// them with arguments read from their main(), and schedule them. Runs get the
// project's variables (secrets masked in all output) and storage (/storage, S3).
import { z } from "zod";
import { languageOf, scriptArgs, scriptDescription, type ArgsSchema } from "@miniasys/projects";
import { RepoError } from "@miniasys/projects";
import { PathDenied } from "@miniasys/tools";
import { runs, scripts, and, eq, type projects } from "@miniasys/db";
import { db, sql } from "../db.ts";
import { sendJob } from "../jobs.ts";
import { changed, folder, repos } from "../repos.ts";
import { audit, defineOp, OpError } from "./define.ts";
import { projectBySlug, ProjectRef } from "./common.ts";

type Project = typeof projects.$inferSelect;

const ScriptRef = z.string().min(1).max(300).describe('the script: its path ("scripts/etl.py") or name ("etl.py")');
const Sha = z.string().regex(/^[0-9a-f]{4,40}$/);
const FINAL = ["succeeded", "failed", "canceled", "timed_out"];

/** "etl.py" → "scripts/etl.py"; only supported languages under scripts/. */
function scriptPath(ref: string): string {
  const p = ref.replace(/^\/+/, "").replace(/^project\//, "");
  const path = p.startsWith("scripts/") ? p : `scripts/${p}`;
  if (path.includes("..")) throw new OpError(400, "a script path can't go up with ..");
  if (!languageOf(path)) throw new OpError(400, `${path}: scripts are .py, .ts, .sh or .sql files`);
  return path;
}

async function fsGuard<T>(f: () => Promise<T>): Promise<T> {
  try {
    return await f();
  } catch (e) {
    if (e instanceof PathDenied) throw new OpError(/does not exist/.test(e.message) ? 404 : 400, e.message);
    if (e instanceof RepoError) throw new OpError(/changed since/.test(e.message) ? 409 : 400, e.message);
    throw e;
  }
}

/** The script's row, created or refreshed from its code (language, arguments, description). */
async function upsert(p: Project, path: string, source: string) {
  const language = languageOf(path)!;
  const argsSchema = scriptArgs(language, source);
  const description = scriptDescription(language, source);
  const [row] = await db()
    .insert(scripts)
    .values({ projectId: p.id, path, language, argsSchema, description })
    .onConflictDoUpdate({ target: [scripts.projectId, scripts.path], set: { language, argsSchema, description, updatedAt: new Date() } })
    .returning();
  return row!;
}

async function rowOf(p: Project, path: string) {
  const [row] = await db().select().from(scripts).where(and(eq(scripts.projectId, p.id), eq(scripts.path, path)));
  if (row) return row;
  // a script written straight into the folder (by a card, a harness, git): registered on first use
  const file = await fsGuard(() => repos().read(p.slug, path));
  return upsert(p, path, file.content);
}

export const list = defineOp({
  name: "scripts.list",
  summary: "A project's scripts (files under scripts/): language, description, arguments, schedule, and the last run's status.",
  access: "read",
  input: z.object({ project: ProjectRef }),
  run: async (_c, i) => {
    const p = await projectBySlug(i.project);
    await folder(p);
    const files = (await repos().list(p.slug).catch(() => [])).filter((e) => e.type === "file" && e.path.startsWith("scripts/") && languageOf(e.path));
    const rows = await sql()<{ path: string; description: string | null; args_schema: ArgsSchema; network: boolean; schedule: string | null; schedule_enabled: boolean; last_status: string | null; last_at: Date | null }[]>`
      SELECT s.path, s.description, s.args_schema, s.network, s.schedule, s.schedule_enabled, r.status AS last_status, COALESCE(r.finished_at, r.created_at) AS last_at
      FROM scripts s LEFT JOIN runs r ON r.id = s.last_run_id WHERE s.project_id = ${p.id}`;
    const byPath = new Map(rows.map((r) => [r.path, r]));
    return files.map((f) => {
      const r = byPath.get(f.path);
      return {
        path: f.path, language: languageOf(f.path), size: f.size, description: r?.description ?? null, args: r ? Object.keys(r.args_schema.properties ?? {}) : null,
        network: r?.network ?? false, schedule: r?.schedule ?? null, scheduleEnabled: r?.schedule_enabled ?? false, lastStatus: r?.last_status ?? null, lastAt: r?.last_at ?? null,
      };
    });
  },
});

export const get = defineOp({
  name: "scripts.get",
  summary: "A script: its code (and the commit to pass as base when saving), arguments (JSON Schema), settings, schedule and its latest runs.",
  access: "read",
  input: z.object({ project: ProjectRef, script: ScriptRef }),
  run: async (_c, i) => {
    const p = await projectBySlug(i.project);
    await folder(p);
    const path = scriptPath(i.script);
    const file = await fsGuard(() => repos().read(p.slug, path));
    const row = await rowOf(p, path);
    const recent = await sql()<{ id: string; status: string; input: { trigger?: string; args?: unknown } | null; summary: string | null; error: string | null; createdAt: Date; finishedAt: Date | null }[]>`
      SELECT id, status, input, summary, left(error, 500) AS error, created_at AS "createdAt", finished_at AS "finishedAt"
      FROM runs WHERE kind = 'script' AND project_id = ${p.id} AND input->>'scriptId' = ${row.id} ORDER BY created_at DESC LIMIT 20`;
    return {
      path, code: file.content, base: (await repos().log(p.slug, path, 1))[0]?.sha ?? null,
      script: { id: row.id, language: row.language, description: row.description, args: row.argsSchema as ArgsSchema, network: row.network, timeoutS: row.timeoutS, memMb: row.memMb, schedule: row.schedule, scheduleArgs: row.scheduleArgs, scheduleEnabled: row.scheduleEnabled },
      runs: recent.map(({ input, ...r }) => ({ ...r, trigger: input?.trigger ?? "manual", args: input?.args ?? {} })),
    };
  },
});

export const save = defineOp({
  name: "scripts.save",
  summary: "Create or update a script (a commit in the project's code). Its arguments are read from main(): Python def main(day: str, n: int = 1), TypeScript export async function main(day: string, n = 1), Bash/SQL '# arg: name type default' header lines. Pass base (from scripts.get) to refuse overwriting a newer change.",
  access: "write",
  input: z.object({ project: ProjectRef, script: ScriptRef, code: z.string().max(1_000_000), message: z.string().max(500).optional(), base: Sha.optional() }),
  run: async (ctx, i) => {
    const p = await projectBySlug(i.project);
    await folder(p);
    const path = scriptPath(i.script);
    const w = await fsGuard(() => repos().write(p.slug, path, i.code, { actor: ctx.actor, message: i.message ?? `save ${path}`, ...(i.base ? { baseSha: i.base } : {}) }));
    const row = await upsert(p, path, i.code);
    if (w.sha) {
      await audit(ctx, "script.save", { type: "script", id: `${p.slug}/${path}` }, { sha: w.sha });
      await changed(p, { path, sha: w.sha });
    }
    return { path, sha: w.sha, unchanged: !w.sha, args: row.argsSchema };
  },
});

const CRON = /^(\S+\s+){4}\S+$/;

export const settings = defineOp({
  name: "scripts.settings",
  summary: "A script's settings: network access, timeout, memory, description, and its schedule (cron, e.g. '0 6 * * *', in the platform's time zone; schedule_args; schedule_enabled). Only the fields given change.",
  access: "write",
  input: z.object({
    project: ProjectRef,
    script: ScriptRef,
    network: z.boolean().optional(),
    timeout_s: z.number().int().min(5).max(3600).optional(),
    mem_mb: z.number().int().min(256).max(2048).optional(),
    description: z.string().max(500).nullable().optional(),
    schedule: z.string().regex(CRON, "a cron expression with 5 fields, e.g. 0 6 * * *").nullable().optional(),
    schedule_args: z.record(z.string(), z.unknown()).optional(),
    schedule_enabled: z.boolean().optional(),
  }),
  run: async (ctx, i) => {
    const p = await projectBySlug(i.project);
    await folder(p);
    const row = await rowOf(p, scriptPath(i.script));
    const set = {
      ...(i.network !== undefined ? { network: i.network } : {}), ...(i.timeout_s !== undefined ? { timeoutS: i.timeout_s } : {}),
      ...(i.mem_mb !== undefined ? { memMb: i.mem_mb } : {}), ...(i.description !== undefined ? { description: i.description } : {}),
      ...(i.schedule !== undefined ? { schedule: i.schedule } : {}), ...(i.schedule_args !== undefined ? { scheduleArgs: i.schedule_args } : {}),
      ...(i.schedule_enabled !== undefined ? { scheduleEnabled: i.schedule_enabled } : {}),
    };
    if ((set.scheduleEnabled ?? row.scheduleEnabled) && !(set.schedule ?? row.schedule)) throw new OpError(400, "set a schedule (cron) before enabling it");
    const [next] = await db().update(scripts).set({ ...set, updatedAt: new Date() }).where(eq(scripts.id, row.id)).returning();
    await sendJob("script.schedule", { scriptId: row.id });
    const { project: _p, script: _s, ...details } = i;
    await audit(ctx, "script.settings", { type: "script", id: `${p.slug}/${row.path}` }, details);
    return { network: next!.network, timeoutS: next!.timeoutS, memMb: next!.memMb, schedule: next!.schedule, scheduleArgs: next!.scheduleArgs, scheduleEnabled: next!.scheduleEnabled };
  },
});

export const run = defineOp({
  name: "scripts.run",
  summary: "Run a script with arguments (an object by name). Returns the run id at once, or with wait: true, waits for it and returns its status, result (what main() returned) and the end of its output. Secrets are masked as ***.",
  access: "write",
  input: z.object({ project: ProjectRef, script: ScriptRef, args: z.record(z.string(), z.unknown()).default({}), wait: z.boolean().default(false), wait_s: z.number().int().min(1).max(900).default(300) }),
  run: async (ctx, i) => {
    const p = await projectBySlug(i.project);
    await folder(p);
    const row = await rowOf(p, scriptPath(i.script));
    const schema = row.argsSchema as ArgsSchema;
    const missing = (schema.required ?? []).filter((k) => i.args[k] === undefined && (schema.properties[k] as { default?: unknown })?.default === undefined);
    if (missing.length) throw new OpError(400, `missing arguments: ${missing.join(", ")}`);
    const unknown = Object.keys(i.args).filter((k) => !(k in schema.properties));
    if (unknown.length && row.language !== "sql") throw new OpError(400, `unknown arguments: ${unknown.join(", ")} (main takes ${Object.keys(schema.properties).join(", ") || "none"})`);
    // defaults the code declared fill what wasn't given (TypeScript and Bash take arguments by position)
    const args = Object.fromEntries(Object.entries(schema.properties).filter(([k, s]) => i.args[k] !== undefined || (s as { default?: unknown }).default !== undefined).map(([k, s]) => [k, i.args[k] ?? (s as { default?: unknown }).default]));
    if (row.language === "sql") Object.assign(args, i.args);
    const [r] = await db().insert(runs).values({ kind: "script", projectId: p.id, status: "queued", input: { scriptId: row.id, path: row.path, args, trigger: ctx.agent ? `agent:${ctx.agent.slug}` : "manual", by: ctx.actor } }).returning({ id: runs.id });
    await db().update(scripts).set({ lastRunId: r!.id }).where(eq(scripts.id, row.id));
    await sendJob("script.run", { runId: r!.id });
    await audit(ctx, "script.run", { type: "script", id: `${p.slug}/${row.path}` }, { runId: r!.id });
    if (!i.wait) return { runId: r!.id, status: "queued" };
    const until = Date.now() + i.wait_s * 1000;
    for (;;) {
      const [now] = await db().select().from(runs).where(eq(runs.id, r!.id));
      if (now && FINAL.includes(now.status)) {
        const logs = await sql()<{ data: { text: string; stream: string } }[]>`SELECT data FROM run_events WHERE run_id = ${r!.id} AND type = 'log' ORDER BY seq DESC LIMIT 20`;
        const output = logs.reverse().map((l) => l.data.text).join("\n");
        return { runId: r!.id, status: now.status, result: now.result, error: now.error, output: output.slice(-8000) };
      }
      if (Date.now() > until) return { runId: r!.id, status: now?.status ?? "queued", note: `still running after ${i.wait_s} s: follow it with runs.get / runs.events` };
      await new Promise((res) => setTimeout(res, 500));
    }
  },
});

export const runsOf = defineOp({
  name: "scripts.runs",
  summary: "Runs of a project's scripts (or of one script), newest first: trigger, arguments, status, result summary, error.",
  access: "read",
  input: z.object({ project: ProjectRef, script: ScriptRef.optional(), limit: z.number().int().min(1).max(200).default(50) }),
  run: async (_c, i) => {
    const p = await projectBySlug(i.project);
    const path = i.script ? scriptPath(i.script) : null;
    return sql()<{ id: string; path: string; trigger: string; status: string; summary: string | null; error: string | null; created_at: Date; finished_at: Date | null }[]>`
      SELECT id, input->>'path' AS path, COALESCE(input->>'trigger', 'manual') AS trigger, status, summary, left(error, 300) AS error, created_at, finished_at
      FROM runs WHERE kind = 'script' AND project_id = ${p.id} AND (${path}::text IS NULL OR input->>'path' = ${path})
      ORDER BY created_at DESC LIMIT ${i.limit}`;
  },
});

export const remove = defineOp({
  name: "scripts.delete",
  summary: "Delete a script: its file (a commit; it stays in the history), its settings and its schedule.",
  access: "write",
  destructive: true,
  input: z.object({ project: ProjectRef, script: ScriptRef }),
  run: async (ctx, i) => {
    const p = await projectBySlug(i.project);
    await folder(p);
    const path = scriptPath(i.script);
    const [row] = await db().select().from(scripts).where(and(eq(scripts.projectId, p.id), eq(scripts.path, path)));
    const w = await fsGuard(() => repos().remove(p.slug, path, { actor: ctx.actor, message: `delete ${path}` }));
    if (row) {
      await db().delete(scripts).where(eq(scripts.id, row.id));
      await sendJob("script.schedule", { scriptId: row.id });
    }
    if (w.sha) await changed(p, { path, sha: w.sha, deleted: true });
    await audit(ctx, "script.delete", { type: "script", id: `${p.slug}/${path}` });
    return { ok: true };
  },
});
