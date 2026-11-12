// Indexes text for agents' search_notes (scope §8.13): a notes row, embedded by
// the worker (queue notes.embed). A source indexed again replaces its old note.
import { notes, and, eq } from "@miniasys/db";
import { db } from "./db.ts";
import { sendJob } from "./jobs.ts";

export async function indexNote(n: { projectId: string; sourceType: string; sourceId: string | null; content: string; replace?: boolean }) {
  if (!n.content.trim()) return;
  if (n.replace && n.sourceId) await db().delete(notes).where(and(eq(notes.sourceType, n.sourceType), eq(notes.sourceId, n.sourceId)));
  const [row] = await db().insert(notes).values({ projectId: n.projectId, sourceType: n.sourceType, sourceId: n.sourceId, content: n.content }).returning({ id: notes.id });
  await sendJob("notes.embed", { noteId: row!.id });
}
