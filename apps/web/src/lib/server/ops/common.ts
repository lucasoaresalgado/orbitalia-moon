// Lookups shared by the operations. Callers name things the way people do:
// a project by slug, a card by id or "project#number", an agent by slug.
import { z } from "zod";
import { agents, cards, projects, and, eq } from "@miniasys/db";
import { db } from "../db.ts";
import { OpError } from "./define.ts";

export const ProjectRef = z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "a project slug").describe("project slug");
export const AgentRef = z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "an agent slug").describe("agent slug");
export const CardRef = z.string().min(1).describe('card id, or "project#number" (e.g. demo#12)');
export const Uuid = z.uuid();

export async function projectBySlug(slug: string) {
  const [p] = await db().select().from(projects).where(eq(projects.slug, slug));
  if (!p) throw new OpError(404, `no project p/${slug}`);
  return p;
}

export async function agentRow(slug: string) {
  const [a] = await db().select().from(agents).where(eq(agents.slug, slug));
  if (!a) throw new OpError(404, `no agent a/${slug}`);
  return a;
}

/** A live card by id or "project#number" (deleted cards are not found). */
export async function cardByRef(ref: string) {
  const m = /^([a-z0-9][a-z0-9-]*)#(\d+)$/.exec(ref.trim());
  let row: typeof cards.$inferSelect | undefined;
  if (m) {
    const p = await projectBySlug(m[1]!);
    [row] = await db().select().from(cards).where(and(eq(cards.projectId, p.id), eq(cards.number, Number(m[2]))));
  } else if (Uuid.safeParse(ref).success) {
    [row] = await db().select().from(cards).where(eq(cards.id, ref));
  }
  if (!row || row.deletedAt) throw new OpError(404, `no card ${ref}`);
  return row;
}
