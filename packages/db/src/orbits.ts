// Orbits (scope §27): named sets of agents; a project's orbit decides which agents
// work on it. Shared by the web app and the worker.
import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "./index.ts";
import { agents, agentVersions, orbitAgents, orbits, projects } from "./schema.ts";

/** The default orbit's id (created when missing): projects without an orbit use it, new agents join it. */
export async function defaultOrbitId(db: Db): Promise<string> {
  const [o] = await db.select({ id: orbits.id }).from(orbits).where(eq(orbits.isDefault, true));
  if (o) return o.id;
  await db.insert(orbits).values({ slug: "default", name: "Default", description: "Every agent: the orbit of projects without one of their own.", isDefault: true }).onConflictDoNothing();
  const [again] = await db.select({ id: orbits.id }).from(orbits).where(eq(orbits.isDefault, true));
  return again!.id;
}

export async function joinDefaultOrbit(db: Db, agentId: string): Promise<void> {
  await db.insert(orbitAgents).values({ orbitId: await defaultOrbitId(db), agentId }).onConflictDoNothing();
}

export type OrbitMember = { agent: typeof agents.$inferSelect; version: typeof agentVersions.$inferSelect | null };

/** A project's orbit and its live members (with their deployed versions); the default orbit when the project has none. */
export async function projectOrbit(db: Db, projectId: string | null): Promise<{ orbit: typeof orbits.$inferSelect; members: OrbitMember[] }> {
  const [p] = projectId ? await db.select({ orbitId: projects.orbitId }).from(projects).where(eq(projects.id, projectId)) : [];
  const id = p?.orbitId ?? (await defaultOrbitId(db));
  const [orbit] = await db.select().from(orbits).where(eq(orbits.id, id));
  const rows = await db.select({ agent: agents, version: agentVersions }).from(orbitAgents)
    .innerJoin(agents, eq(agents.id, orbitAgents.agentId))
    .leftJoin(agentVersions, eq(agentVersions.id, agents.activeVersionId))
    .where(and(eq(orbitAgents.orbitId, id), isNull(agents.deletedAt)))
    .orderBy(agents.slug);
  return { orbit: orbit!, members: rows };
}

/**
 * The orbit's agent for a role: an internal one with a deployed version, the one
 * named `prefer` if it's there, else the first by name. Null when the orbit has none.
 */
export function pickMember(members: OrbitMember[], role: string, prefer?: string | null): (OrbitMember & { version: NonNullable<OrbitMember["version"]> }) | null {
  const ok = members.filter((m): m is OrbitMember & { version: NonNullable<OrbitMember["version"]> } => m.agent.role === role && m.agent.runtime === "internal" && !!m.version);
  return ok.find((m) => m.agent.slug === prefer) ?? ok[0] ?? null;
}
