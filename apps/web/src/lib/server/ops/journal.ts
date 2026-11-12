// The project journal (scope §25): every step of the work, logged by whoever did
// it. A harness logs as it goes; the Activity page shows it with the card activity.
import { z } from "zod";
import { addJournalEntry, JOURNAL_KINDS } from "@miniasys/db";
import { database, sql } from "../db.ts";
import { indexNote } from "../notes.ts";
import { defineOp, OpError } from "./define.ts";
import { cardByRef, CardRef, projectBySlug, ProjectRef } from "./common.ts";

export const add = defineOp({
  name: "journal.add",
  summary: "Log a step in a project's journal: what was done, decided, reached or found (kind step|decision|milestone|issue|note), with a markdown body and optionally the card it belongs to.",
  access: "write",
  input: z.object({
    project: ProjectRef,
    title: z.string().trim().min(1).max(200),
    body: z.string().max(50_000).default("").describe("markdown: what, why, result, links"),
    kind: z.enum(JOURNAL_KINDS).default("step"),
    card: CardRef.optional(),
    data: z.record(z.string(), z.unknown()).default({}).describe("anything structured to keep with it (commands, files, metrics)"),
  }),
  run: async (ctx, i) => {
    const project = await projectBySlug(i.project);
    const card = i.card ? await cardByRef(i.card) : null;
    if (card && card.projectId !== project.id) throw new OpError(400, `${i.card} is not in p/${project.slug}`);
    const row = await addJournalEntry(database(), { projectId: project.id, cardId: card?.id ?? null, actor: ctx.actor, kind: i.kind, title: i.title, body: i.body, data: i.data }, indexNote);
    return { id: row.id, createdAt: row.createdAt };
  },
});

export const list = defineOp({
  name: "journal.list",
  summary: "Read a project's journal, newest first; filter by card, kind, actor (e.g. agent:claude-harness) or since a time.",
  access: "read",
  input: z.object({
    project: ProjectRef,
    card: CardRef.optional(),
    kind: z.enum(JOURNAL_KINDS).optional(),
    actor: z.string().optional(),
    since: z.iso.datetime({ offset: true }).optional().describe("ISO time"),
    limit: z.number().int().min(1).max(1000).default(100),
  }),
  run: async (_c, i) => {
    const project = await projectBySlug(i.project);
    const cardId = i.card ? (await cardByRef(i.card)).id : null;
    return sql()<{ id: number; kind: string; title: string; body: string; actor: string; card: string | null; data: unknown; created_at: Date }[]>`
      SELECT j.id, j.kind, j.title, j.body, j.actor, CASE WHEN c.id IS NULL THEN NULL ELSE ${project.slug} || '#' || c.number END AS card, j.data, j.created_at
      FROM journal_entries j LEFT JOIN cards c ON c.id = j.card_id
      WHERE j.project_id = ${project.id} AND (${cardId}::uuid IS NULL OR j.card_id = ${cardId}) AND (${i.kind ?? null}::text IS NULL OR j.kind = ${i.kind ?? null})
        AND (${i.actor ?? null}::text IS NULL OR j.actor = ${i.actor ?? null}) AND (${i.since ?? null}::timestamptz IS NULL OR j.created_at >= ${i.since ?? null})
      ORDER BY j.id DESC LIMIT ${i.limit}`;
  },
});
