// The journal and project docs, shared by the web app (operations) and the worker
// (agents' tools), like cards.ts. Text is indexed for search_notes through the
// caller's indexer: the web app and the worker each queue the embedding their way.
import { CHANNELS } from "@miniasys/core";
import { and, desc, eq, isNull } from "drizzle-orm";
import { publish, type Database } from "./index.ts";
import { docs, docVersions, journalEntries } from "./schema.ts";
import type { Actor } from "./cards.ts";

export const JOURNAL_KINDS = ["step", "decision", "milestone", "issue", "note"] as const;
export type JournalKind = (typeof JOURNAL_KINDS)[number];

export type Indexer = (n: { projectId: string; sourceType: string; sourceId: string | null; content: string; replace?: boolean }) => Promise<void>;

export async function addJournalEntry(
  d: Database,
  e: { projectId: string; actor: Actor; kind: JournalKind; title: string; body?: string; data?: Record<string, unknown>; cardId?: string | null; meetingId?: string | null; runId?: string | null },
  index: Indexer,
) {
  const [row] = await d.db
    .insert(journalEntries)
    .values({ projectId: e.projectId, actor: e.actor, kind: e.kind, title: e.title, body: e.body ?? "", data: e.data ?? {}, cardId: e.cardId ?? null, meetingId: e.meetingId ?? null, runId: e.runId ?? null })
    .returning({ id: journalEntries.id, createdAt: journalEntries.createdAt });
  await index({ projectId: e.projectId, sourceType: "journal", sourceId: null, content: `[${e.kind}] ${e.title} (journal #${row!.id}, ${e.actor})\n\n${e.body ?? ""}` });
  await publish(d.sql, { topic: CHANNELS.journal(e.projectId), type: "added", data: { id: row!.id, kind: e.kind } });
  return row!;
}

export class DocConflict extends Error {}

export async function docBySlug(d: Database, projectId: string, slug: string) {
  const [doc] = await d.db.select().from(docs).where(and(eq(docs.projectId, projectId), eq(docs.slug, slug), isNull(docs.deletedAt)));
  return doc ?? null;
}

/** A doc's current text, or one of its versions; null when it doesn't exist. */
export async function readDoc(d: Database, projectId: string, slug: string, version?: number) {
  const doc = await docBySlug(d, projectId, slug);
  if (!doc) return null;
  if (!version || version === doc.version) return { slug: doc.slug, title: doc.title, body: doc.body, version: doc.version, updatedBy: doc.updatedBy, updatedAt: doc.updatedAt };
  const [v] = await d.db.select().from(docVersions).where(and(eq(docVersions.docId, doc.id), eq(docVersions.version, version)));
  return v ? { slug: doc.slug, title: v.title, body: v.body, version: v.version, updatedBy: v.actor, updatedAt: v.createdAt } : null;
}

export async function listDocs(d: Database, projectId: string) {
  const rows = await d.db.select({ slug: docs.slug, title: docs.title, version: docs.version, updatedBy: docs.updatedBy, updatedAt: docs.updatedAt }).from(docs)
    .where(and(eq(docs.projectId, projectId), isNull(docs.deletedAt))).orderBy(docs.slug);
  return rows;
}

export async function docHistory(d: Database, docId: string) {
  return d.db.select({ version: docVersions.version, title: docVersions.title, actor: docVersions.actor, note: docVersions.note, createdAt: docVersions.createdAt }).from(docVersions)
    .where(eq(docVersions.docId, docId)).orderBy(desc(docVersions.version));
}

/**
 * Creates or updates a doc as a new version. With baseVersion, refuses (DocConflict)
 * when the doc moved on since the caller read it (0: it must not exist yet).
 */
export async function putDoc(
  d: Database,
  p: { projectId: string; slug: string; title?: string; body: string; baseVersion?: number; note?: string | null; actor: Actor },
  index: Indexer,
) {
  const cur = await docBySlug(d, p.projectId, p.slug);
  if (p.baseVersion !== undefined && (cur?.version ?? 0) !== p.baseVersion)
    throw new DocConflict(`${p.slug} is at version ${cur?.version ?? 0}, not ${p.baseVersion}: read it again and merge`);
  const title = p.title ?? cur?.title ?? p.slug;
  if (cur && cur.body === p.body && cur.title === title) return { slug: cur.slug, version: cur.version, unchanged: true };
  let doc: { id: string; version: number };
  if (cur) {
    [doc] = (await d.db.update(docs).set({ title, body: p.body, version: cur.version + 1, updatedBy: p.actor, updatedAt: new Date() }).where(eq(docs.id, cur.id)).returning({ id: docs.id, version: docs.version })) as [typeof doc];
  } else {
    // a deleted doc with the same slug gives its place (and its version count) to the new one
    const [gone] = await d.db.select().from(docs).where(and(eq(docs.projectId, p.projectId), eq(docs.slug, p.slug)));
    if (gone)
      [doc] = (await d.db.update(docs).set({ title, body: p.body, version: gone.version + 1, updatedBy: p.actor, updatedAt: new Date(), deletedAt: null }).where(eq(docs.id, gone.id)).returning({ id: docs.id, version: docs.version })) as [typeof doc];
    else [doc] = (await d.db.insert(docs).values({ projectId: p.projectId, slug: p.slug, title, body: p.body, updatedBy: p.actor }).returning({ id: docs.id, version: docs.version })) as [typeof doc];
  }
  await d.db.insert(docVersions).values({ docId: doc.id, version: doc.version, title, body: p.body, actor: p.actor, note: p.note ?? null });
  await index({ projectId: p.projectId, sourceType: "doc", sourceId: doc.id, content: `# ${title} (doc ${p.slug}, v${doc.version})\n\n${p.body}`, replace: true });
  await publish(d.sql, { topic: CHANNELS.docs(p.projectId), type: "saved", data: { slug: p.slug, version: doc.version } });
  return { slug: p.slug, version: doc.version, unchanged: false };
}

export async function deleteDoc(d: Database, projectId: string, slug: string, actor: Actor) {
  const doc = await docBySlug(d, projectId, slug);
  if (!doc) return false;
  await d.db.update(docs).set({ deletedAt: new Date(), updatedBy: actor }).where(eq(docs.id, doc.id));
  await d.sql`DELETE FROM notes WHERE source_type = 'doc' AND source_id = ${doc.id}`;
  await publish(d.sql, { topic: CHANNELS.docs(projectId), type: "deleted", data: { slug } });
  return true;
}
