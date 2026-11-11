// Skills (folders of instructions loaded on demand) and project notes
// (embedded with bge-m3 for search_notes), scope §8.2 and §15.
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { chunkText } from "@miniasys/llm";
import { noteChunks, notes, eq } from "@miniasys/db";
import type { Services } from "./services.ts";
import { QUEUES } from "./services.ts";

export async function loadSkill(dir: string, name: string): Promise<string | null> {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) return null;
  try {
    const base = join(dir, name);
    const main = await readFile(join(base, "SKILL.md"), "utf8");
    const files = (await readdir(base)).filter((f) => f !== "SKILL.md");
    return files.length ? `${main}\n\nOther files in this skill (ask Lucas to add them to your context if needed): ${files.join(", ")}` : main;
  } catch {
    return null;
  }
}

export async function listSkills(dir: string): Promise<{ name: string; description: string }[]> {
  try {
    const out = [];
    for (const name of await readdir(dir)) {
      const text = await readFile(join(dir, name, "SKILL.md"), "utf8").catch(() => null);
      if (!text) continue;
      const desc = /^description:\s*(.+)$/m.exec(text)?.[1] ?? text.split("\n").find((l) => l.trim() && !l.startsWith("#") && !l.startsWith("---")) ?? "";
      out.push({ name, description: desc.trim().slice(0, 200) });
    }
    return out;
  } catch {
    return [];
  }
}

export async function addNote(s: Services, n: { projectId: string | null; sourceType: string; sourceId: string | null; content: string }) {
  if (!n.content.trim()) return;
  const [row] = await s.d.db.insert(notes).values(n).returning({ id: notes.id });
  await s.boss.send(QUEUES.notesEmbed, { noteId: row!.id });
}

export async function embedNote(s: Services, noteId: string) {
  const [note] = await s.d.db.select().from(notes).where(eq(notes.id, noteId));
  if (!note) return;
  const chunks = chunkText(note.content);
  const vectors = await s.embeddings.embed(chunks);
  await s.d.db.delete(noteChunks).where(eq(noteChunks.noteId, noteId));
  if (chunks.length)
    await s.d.db.insert(noteChunks).values(chunks.map((content, i) => ({ noteId, chunkIndex: i, content, embedding: vectors[i]!, embeddingModel: s.embeddings.model })));
}

export async function searchNotes(s: Services, projectId: string | null, query: string, limit: number) {
  const [v] = await s.embeddings.embed([query]);
  if (!v) return [];
  const vec = `[${v.join(",")}]`;
  const rows = await s.d.sql<{ source_type: string; source_id: string | null; content: string; score: number }[]>`
    SELECT n.source_type, n.source_id, c.content, 1 - (c.embedding <=> ${vec}::vector) AS score
    FROM note_chunks c JOIN notes n ON n.id = c.note_id
    WHERE ${projectId}::uuid IS NULL OR n.project_id = ${projectId}
    ORDER BY c.embedding <=> ${vec}::vector LIMIT ${limit}`;
  return rows.map((r) => ({ source: `${r.source_type}${r.source_id ? `:${r.source_id.slice(0, 8)}` : ""}`, content: r.content, score: Number(r.score) }));
}
