// Orbits (scope §27): named sets of agents. Each project has one orbit; an orbit can
// serve many projects; an agent can be in many orbits. The project's orbit decides
// who routes cards to, briefs, works, tests, reviews and chats there.
import { z } from "zod";
import { agents, orbitAgents, orbits, projects, and, desc, eq, inArray, isNull, defaultOrbitId } from "@miniasys/db";
import { db, sql } from "../db.ts";
import { audit, defineOp, OpError } from "./define.ts";

export const OrbitRef = z.string().min(1).max(64).describe("orbit slug");

/** The roles an orbit can cover, what each does, and what happens without it. */
export const ORBIT_ROLES = [
  { role: "manager", label: "Manager", missing: "the chat uses Luna" },
  { role: "worker", label: "Workers", missing: "cards can't be worked: add at least one" },
  { role: "brief_writer", label: "Brief writer", missing: "the default brief writer is used" },
  { role: "tester", label: "Tester", missing: "cards aren't tested before review" },
  { role: "reviewer", label: "Reviewer", missing: "the default reviewer is used" },
] as const;

const slugify = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "orbit";

export async function orbitBySlug(slug: string) {
  const [o] = await db().select().from(orbits).where(eq(orbits.slug, slug));
  if (!o) throw new OpError(404, `no orbit ${slug}`);
  return o;
}

async function agentIds(slugs: string[]) {
  if (!slugs.length) return [];
  const rows = await db().select({ id: agents.id, slug: agents.slug }).from(agents).where(and(inArray(agents.slug, slugs), isNull(agents.deletedAt)));
  const missing = slugs.filter((s) => !rows.some((r) => r.slug === s));
  if (missing.length) throw new OpError(400, `no agent ${missing.map((m) => `a/${m}`).join(", ")}`);
  return rows.map((r) => r.id);
}

async function projectIds(slugs: string[]) {
  if (!slugs.length) return [];
  const rows = await db().select({ id: projects.id, slug: projects.slug }).from(projects).where(inArray(projects.slug, slugs));
  const missing = slugs.filter((s) => !rows.some((r) => r.slug === s));
  if (missing.length) throw new OpError(400, `no project ${missing.map((m) => `p/${m}`).join(", ")}`);
  return rows.map((r) => r.id);
}

/** every orbit with its members (live agents) and the projects it serves */
async function overview() {
  const defaultId = await defaultOrbitId(db());
  const rows = await db().select().from(orbits).orderBy(desc(orbits.isDefault), orbits.name);
  const members = await sql()<{ orbit_id: string; slug: string; name: string; role: string; runtime: string; deployed: boolean }[]>`
    SELECT m.orbit_id, a.slug, a.name, a.role, a.runtime, a.active_version_id IS NOT NULL AS deployed
    FROM orbit_agents m JOIN agents a ON a.id = m.agent_id WHERE a.deleted_at IS NULL ORDER BY a.role, a.slug`;
  const used = await sql()<{ orbit_id: string; slug: string; name: string }[]>`
    SELECT COALESCE(orbit_id, ${defaultId}::uuid) AS orbit_id, slug, name FROM projects WHERE status <> 'deleted' ORDER BY name`;
  return rows.map((o) => {
    const m = members.filter((x) => x.orbit_id === o.id).map(({ orbit_id: _o, ...rest }) => rest);
    return {
      ...o,
      agents: m,
      projects: used.filter((p) => p.orbit_id === o.id).map(({ orbit_id: _o, ...rest }) => rest),
      coverage: ORBIT_ROLES.map((r) => ({ ...r, agents: m.filter((a) => a.role === r.role && (a.runtime === "external" || a.deployed)).map((a) => a.slug) })),
    };
  });
}

export const list = defineOp({
  name: "orbits.list",
  summary: "Every orbit: its agents, the projects it serves, and which roles it covers (manager, workers, brief writer, tester, reviewer) with what happens for a missing one.",
  access: "read",
  input: z.object({}),
  run: async () => overview(),
});

export const get = defineOp({
  name: "orbits.get",
  summary: "One orbit: its agents, projects and role coverage.",
  access: "read",
  input: z.object({ orbit: OrbitRef }),
  run: async (_c, i) => {
    const o = (await overview()).find((x) => x.slug === i.orbit);
    if (!o) throw new OpError(404, `no orbit ${i.orbit}`);
    return o;
  },
});

const Members = z.array(z.string().min(1).max(64)).max(100);

export const create = defineOp({
  name: "orbits.create",
  summary: "Create an orbit: a name (anything you like), the agents in it, and optionally the projects it serves from now on.",
  access: "write",
  input: z.object({ name: z.string().trim().min(1).max(60), description: z.string().max(500).nullable().optional(), agents: Members.default([]), projects: z.array(z.string()).max(100).default([]) }),
  run: async (ctx, i) => {
    const ids = await agentIds(i.agents);
    const pids = await projectIds(i.projects);
    let slug = slugify(i.name);
    for (let n = 2; (await db().select({ id: orbits.id }).from(orbits).where(eq(orbits.slug, slug))).length; n++) slug = `${slugify(i.name)}-${n}`;
    const [o] = await db().insert(orbits).values({ slug, name: i.name, description: i.description || null }).returning();
    if (ids.length) await db().insert(orbitAgents).values(ids.map((agentId) => ({ orbitId: o!.id, agentId }))).onConflictDoNothing();
    if (pids.length) await db().update(projects).set({ orbitId: o!.id }).where(inArray(projects.id, pids));
    await audit(ctx, "orbit.create", { type: "orbit", id: slug }, { agents: i.agents, projects: i.projects });
    return (await overview()).find((x) => x.id === o!.id)!;
  },
});

export const update = defineOp({
  name: "orbits.update",
  summary: "Change an orbit: rename it, edit its description, set its agents (the full list), and/or move projects onto it. Only the fields given change.",
  access: "write",
  input: z.object({
    orbit: OrbitRef, name: z.string().trim().min(1).max(60).optional(), description: z.string().max(500).nullable().optional(),
    agents: Members.optional(), projects: z.array(z.string()).max(100).optional().describe("projects to move onto this orbit (others keep theirs)"),
  }),
  run: async (ctx, i) => {
    const o = await orbitBySlug(i.orbit);
    if (i.name !== undefined || i.description !== undefined)
      await db().update(orbits).set({ ...(i.name !== undefined ? { name: i.name } : {}), ...(i.description !== undefined ? { description: i.description || null } : {}) }).where(eq(orbits.id, o.id));
    if (i.agents) {
      const ids = await agentIds(i.agents);
      await db().delete(orbitAgents).where(eq(orbitAgents.orbitId, o.id));
      if (ids.length) await db().insert(orbitAgents).values(ids.map((agentId) => ({ orbitId: o.id, agentId })));
    }
    if (i.projects?.length) await db().update(projects).set({ orbitId: o.id }).where(inArray(projects.id, await projectIds(i.projects)));
    await audit(ctx, "orbit.update", { type: "orbit", id: o.slug }, { name: i.name, agents: i.agents, projects: i.projects });
    return (await overview()).find((x) => x.id === o.id)!;
  },
});

export const remove = defineOp({
  name: "orbits.delete",
  summary: "Delete an orbit (not the default one). Its projects move to move_to, or to the default orbit. The agents themselves stay.",
  access: "write",
  destructive: true,
  input: z.object({ orbit: OrbitRef, move_to: OrbitRef.optional() }),
  run: async (ctx, i) => {
    const o = await orbitBySlug(i.orbit);
    if (o.isDefault) throw new OpError(409, "the default orbit can't be deleted");
    const to = i.move_to ? await orbitBySlug(i.move_to) : { id: await defaultOrbitId(db()), slug: "default" };
    if (to.id === o.id) throw new OpError(400, "move its projects to another orbit");
    const moved = await db().update(projects).set({ orbitId: to.id }).where(eq(projects.orbitId, o.id)).returning({ slug: projects.slug });
    await db().delete(orbits).where(eq(orbits.id, o.id));
    await audit(ctx, "orbit.delete", { type: "orbit", id: o.slug }, { movedTo: to.slug, projects: moved.map((p) => p.slug) });
    return { ok: true, movedTo: to.slug, projects: moved.map((p) => p.slug) };
  },
});
