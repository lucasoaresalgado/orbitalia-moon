// Skills (folders of instructions loaded on demand) and project notes
// (embedded with bge-m3 for search_notes), scope §8.2 and §15.
import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { chunkText } from "@miniasys/llm";
import { confine } from "@miniasys/tools";
import { noteChunks, notes, skillSources, eq } from "@miniasys/db";
import type { Services } from "./services.ts";
import { QUEUES } from "./services.ts";

/**
 * The skills an agent may use (scope §27): the ones attached to its version, plus
 * Lucas's own (local) skills, which every agent with load_skill sees. Imported
 * skills reach only the agents they are attached to.
 */
export async function allowedSkills(s: Services, attached: readonly string[]): Promise<Map<string, { imported: string | null }>> {
  const imported = new Map((await s.d.db.select({ name: skillSources.name, repo: skillSources.repo, sha: skillSources.sha }).from(skillSources)).map((r) => [r.name, `${r.repo}@${r.sha.slice(0, 7)}`]));
  const onDisk = await readdir(s.config.skillsDir).catch(() => [] as string[]);
  const out = new Map<string, { imported: string | null }>();
  for (const name of onDisk) {
    if (!(await stat(join(s.config.skillsDir, name, "SKILL.md")).catch(() => null))) continue;
    const from = imported.get(name) ?? null;
    if (!from || attached.includes(name)) out.set(name, { imported: from });
  }
  return out;
}

/** A skill's SKILL.md (with its other files listed), or one of its other files (text, confined to the skill's folder). */
export async function loadSkill(dir: string, name: string, o: { file?: string; imported?: string | null } = {}): Promise<string | null> {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) return null;
  try {
    const base = join(dir, name);
    const from = o.imported ? `[Skill ${name}, imported from github.com/${o.imported}]\n\n` : "";
    if (o.file) {
      const path = await confine(base, o.file);
      const buf = await readFile(path);
      if (buf.subarray(0, 8000).includes(0)) return `${o.file} is a binary file`;
      return `${from}# ${name}/${o.file}\n\n${buf.toString("utf8").slice(0, 64 * 1024)}`;
    }
    const main = await readFile(join(base, "SKILL.md"), "utf8");
    const files: string[] = [];
    const walk = async (d: string, prefix: string) => {
      for (const e of await readdir(d, { withFileTypes: true })) {
        if (e.name === ".git") continue;
        if (e.isDirectory()) await walk(join(d, e.name), `${prefix}${e.name}/`);
        else if (e.isFile() && `${prefix}${e.name}` !== "SKILL.md") files.push(`${prefix}${e.name}`);
      }
    };
    await walk(base, "");
    return `${from}${main}${files.length ? `\n\nOther files in this skill (read one with load_skill name="${name}" file="<path>"; scripts are references, nothing runs them for you): ${files.slice(0, 80).join(", ")}` : ""}`;
  } catch {
    return null;
  }
}

export async function listSkills(dir: string, only?: ReadonlySet<string>): Promise<{ name: string; description: string }[]> {
  try {
    const out = [];
    for (const name of await readdir(dir)) {
      if (only && !only.has(name)) continue;
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
