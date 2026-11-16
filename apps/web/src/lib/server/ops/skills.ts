// Skills (scope §27): folders of instructions agents load on demand. Lucas's own
// live in the skills folder; others are imported from GitHub: the worker fetches
// and checks them into a staging folder (skills.import), Lucas reads the preview,
// and installing copies the reviewed files, pinned to their commit (skills.install).
// Installing and removing are admin: an agent's token can't add instructions for agents.
import { cp, readFile, readdir, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { parseGithubSkillUrl, skillFrontmatter, SKILL_NAME } from "@miniasys/core";
import { confine } from "@miniasys/tools";
import { skillImports, skillSources, eq } from "@miniasys/db";
import { db, server, sql } from "../db.ts";
import { sendJob } from "../jobs.ts";
import { audit, defineOp, OpError } from "./define.ts";

const skillsDir = () => server().config.skillsDir;
const stagingOf = (id: string, key: number) => join(server().config.workspacesDir, ".skill-imports", id, "skills", String(key));
const SkillName = z.string().regex(SKILL_NAME, "lowercase letters, digits and dashes");

interface FoundSkill { key: number; name: string; path: string; description: string; skillMd: string; files: { path: string; size: number; script: boolean; skipped?: string }[]; warnings: unknown[]; domains: string[]; exists: unknown; hash: string }

/** which deployed agents carry each skill */
async function attachments(): Promise<Map<string, string[]>> {
  const rows = await sql()<{ slug: string; skills: string[] }[]>`
    SELECT a.slug, v.skills FROM agents a JOIN agent_versions v ON v.id = a.active_version_id WHERE a.deleted_at IS NULL AND a.runtime = 'internal'`;
  const out = new Map<string, string[]>();
  for (const r of rows) for (const s of r.skills ?? []) out.set(s, [...(out.get(s) ?? []), r.slug]);
  return out;
}

export const list = defineOp({
  name: "skills.list",
  summary: "Every skill: name, description, where it came from (local, or a GitHub repo pinned to a commit) and the agents it's attached to. Local skills are available to every agent with load_skill; imported ones only to the agents they're attached to.",
  access: "read",
  input: z.object({}),
  run: async () => {
    const sources = new Map((await db().select().from(skillSources)).map((r) => [r.name, r]));
    const attached = await attachments();
    const out = [];
    for (const name of (await readdir(skillsDir()).catch(() => [] as string[])).sort()) {
      const text = await readFile(join(skillsDir(), name, "SKILL.md"), "utf8").catch(() => null);
      if (text === null) continue;
      const src = sources.get(name);
      out.push({
        name, description: skillFrontmatter(text).description ?? "", agents: attached.get(name) ?? [],
        source: src ? { kind: "github" as const, repo: src.repo, path: src.path, ref: src.ref, sha: src.sha, url: src.url, installedAt: src.installedAt, installedBy: src.installedBy } : { kind: "local" as const },
      });
    }
    return out;
  },
});

export const view = defineOp({
  name: "skills.view",
  summary: "A skill's SKILL.md and its files (or one file's text with file).",
  access: "read",
  input: z.object({ name: SkillName, file: z.string().max(300).optional() }),
  run: async (_c, i) => {
    const base = join(skillsDir(), i.name);
    if (!(await stat(join(base, "SKILL.md")).catch(() => null))) throw new OpError(404, `no skill ${i.name}`);
    if (i.file) {
      const path = await confine(base, i.file).catch(() => null);
      const buf = path ? await readFile(path).catch(() => null) : null;
      if (!buf) throw new OpError(404, `no file ${i.file} in ${i.name}`);
      return { name: i.name, file: i.file, text: buf.subarray(0, 8000).includes(0) ? "(binary file)" : buf.toString("utf8").slice(0, 200_000) };
    }
    const files: { path: string; size: number }[] = [];
    const walk = async (d: string, prefix: string) => {
      for (const e of await readdir(d, { withFileTypes: true })) {
        if (e.isDirectory()) await walk(join(d, e.name), `${prefix}${e.name}/`);
        else if (e.isFile()) files.push({ path: `${prefix}${e.name}`, size: (await stat(join(d, e.name))).size });
      }
    };
    await walk(base, "");
    return { name: i.name, file: "SKILL.md", text: await readFile(join(base, "SKILL.md"), "utf8"), files };
  },
});

export const importOp = defineOp({
  name: "skills.import",
  summary: "Fetch skills from GitHub for review: a repository (every folder with a SKILL.md), or one folder (…/tree/<branch>/<folder>). Optional ref (branch, tag or commit). Returns an import id: follow it with skills.import_get until ready, read the preview, then skills.install.",
  access: "admin",
  input: z.object({ url: z.string().min(8).max(500), ref: z.string().trim().max(200).optional() }),
  run: async (ctx, i) => {
    let g;
    try {
      g = parseGithubSkillUrl(i.url);
    } catch (e) {
      throw new OpError(400, (e as Error).message);
    }
    const ref = i.ref || g.ref;
    if (ref && !/^[A-Za-z0-9_./-]{1,200}$/.test(ref)) throw new OpError(400, "the branch or tag has invalid characters");
    const [row] = await db().insert(skillImports).values({ url: i.url.trim(), repo: `${g.owner}/${g.repo}`, path: g.path, ref: ref ?? null, createdBy: ctx.actor }).returning({ id: skillImports.id });
    await sendJob("skills.fetch", { importId: row!.id });
    await audit(ctx, "skills.import", { type: "skill_import", id: row!.id }, { repo: `${g.owner}/${g.repo}`, path: g.path, ref });
    return { id: row!.id, repo: `${g.owner}/${g.repo}`, path: g.path, ref: ref ?? null };
  },
});

export const importGet = defineOp({
  name: "skills.import_get",
  summary: "An import's state: fetching, ready (with the commit and each skill found: SKILL.md, files, flagged lines, domains, whether the name is taken), failed (why) or installed.",
  access: "read",
  input: z.object({ id: z.uuid() }),
  run: async (_c, i) => {
    const [row] = await db().select().from(skillImports).where(eq(skillImports.id, i.id));
    if (!row) throw new OpError(404, "no such import");
    return row;
  },
});

export const install = defineOp({
  name: "skills.install",
  summary: "Install reviewed skills from a ready import: picks are the found skills to install (by key), each under its name or a new one. replace: true updates a skill imported earlier from the same repository folder. attach: agents to give the installed skills to right away (a new version of each is deployed).",
  access: "admin",
  input: z.object({
    id: z.uuid(),
    picks: z.array(z.object({ key: z.number().int().min(0), name: SkillName.optional() })).min(1).max(40),
    replace: z.boolean().default(false),
    attach: z.array(z.string().min(1).max(64)).max(30).default([]),
  }),
  run: async (ctx, i) => {
    const [imp] = await db().select().from(skillImports).where(eq(skillImports.id, i.id));
    if (!imp) throw new OpError(404, "no such import");
    if (imp.status !== "ready") throw new OpError(409, `this import is ${imp.status}${imp.status === "fetching" ? ": wait for it" : ""}`);
    const found = imp.found as FoundSkill[];
    const sources = new Map((await db().select().from(skillSources)).map((r) => [r.name, r]));
    const plan: { skill: FoundSkill; name: string }[] = [];
    for (const p of i.picks) {
      const skill = found.find((f) => f.key === p.key);
      if (!skill) throw new OpError(400, `no skill ${p.key} in this import`);
      const name = p.name ?? skill.name;
      if (plan.some((x) => x.name === name)) throw new OpError(400, `two skills would be named ${name}`);
      const taken = await stat(join(skillsDir(), name)).catch(() => null);
      if (taken) {
        const src = sources.get(name);
        const same = src && src.repo === imp.repo && src.path === skill.path;
        if (!same) throw new OpError(409, `a skill named ${name} exists already (${src ? `from ${src.repo}` : "one of yours"}): pick another name`);
        if (!i.replace) throw new OpError(409, `${name} is installed from this folder already: pass replace to update it`);
      }
      if (!(await stat(stagingOf(imp.id, skill.key)).catch(() => null))) throw new OpError(410, "the reviewed files expired (a day after the fetch): import again");
      if (!(await stat(join(stagingOf(imp.id, skill.key), "SKILL.md")).catch(() => null))) throw new OpError(422, `${skill.path}: its SKILL.md didn't pass the checks, so it can't be installed`);
      plan.push({ skill, name });
    }
    for (const { skill, name } of plan) {
      const target = join(skillsDir(), name);
      const tmp = join(skillsDir(), `.${name}.installing-${imp.id.slice(0, 8)}`);
      await rm(tmp, { recursive: true, force: true });
      await cp(stagingOf(imp.id, skill.key), tmp, { recursive: true });
      await rm(target, { recursive: true, force: true });
      await rename(tmp, target);
      const value = {
        repo: imp.repo, path: skill.path, ref: imp.ref, sha: imp.sha!, url: imp.url, description: skill.description,
        files: skill.files.filter((f) => !f.skipped).map(({ path, size, script }) => ({ path, size, script })), installedBy: ctx.actor, installedAt: new Date(),
      };
      await db().insert(skillSources).values({ name, ...value }).onConflictDoUpdate({ target: skillSources.name, set: value });
      await audit(ctx, "skills.install", { type: "skill", id: name }, { repo: imp.repo, path: skill.path, sha: imp.sha, hash: skill.hash, replaced: i.replace });
    }
    await db().update(skillImports).set({ status: "installed" }).where(eq(skillImports.id, imp.id));
    // give them to agents right away
    const attached: string[] = [];
    if (i.attach.length) {
      const { attachSkills } = await import("./agents.ts");
      for (const agent of i.attach) {
        await attachSkills(ctx, agent, plan.map((p) => p.name), []);
        attached.push(agent);
      }
    }
    return { installed: plan.map((p) => p.name), sha: imp.sha, attached };
  },
});

export const checkUpdate = defineOp({
  name: "skills.check_update",
  summary: "Fetch the newest version of an imported skill (same repository folder, its branch or the default) for review; returns an import id. Installing it with replace updates the skill.",
  access: "admin",
  input: z.object({ name: SkillName }),
  run: async (ctx, i) => {
    const [src] = await db().select().from(skillSources).where(eq(skillSources.name, i.name));
    if (!src) throw new OpError(400, `${i.name} isn't imported from GitHub`);
    const [row] = await db().insert(skillImports).values({ url: src.url, repo: src.repo, path: src.path, ref: src.ref, createdBy: ctx.actor }).returning({ id: skillImports.id });
    await sendJob("skills.fetch", { importId: row!.id });
    return { id: row!.id, current: src.sha };
  },
});

export const remove = defineOp({
  name: "skills.remove",
  summary: "Delete a skill's folder (local or imported). Agents it was attached to simply stop seeing it.",
  access: "admin",
  destructive: true,
  input: z.object({ name: SkillName }),
  run: async (ctx, i) => {
    const target = join(skillsDir(), i.name);
    if (!(await stat(target).catch(() => null))) throw new OpError(404, `no skill ${i.name}`);
    await rm(target, { recursive: true, force: true });
    await db().delete(skillSources).where(eq(skillSources.name, i.name));
    await audit(ctx, "skills.remove", { type: "skill", id: i.name });
    return { ok: true, wasAttachedTo: (await attachments()).get(i.name) ?? [] };
  },
});
