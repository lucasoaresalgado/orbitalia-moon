// An agent's Limbic (start instructions + its own memories) and Cortex (its
// read-only map of the storage), as the services its tools and prompt use.
import { stat } from "node:fs/promises";
import { cortexFile, readEntry, readIndex, search, type CortexEntry } from "@miniasys/cortex";
import { limbic, eq, sql } from "@miniasys/db";
import type { Services } from "./services.ts";

const MAX_MEMORY_CHARS = 8000;

export async function getLimbic(s: Services, agentId: string): Promise<{ instructions: string; memories: string }> {
  const [row] = await s.d.db.select().from(limbic).where(eq(limbic.agentId, agentId));
  return { instructions: row?.instructions ?? "", memories: row?.memories ?? "" };
}

/** The Limbic as a prompt block; empty when there is nothing in it. */
export function limbicBlock(l: { instructions: string; memories: string }): string {
  const parts: string[] = [];
  if (l.instructions.trim()) parts.push(`# Your start instructions (from Lucas)\n${l.instructions.trim()}`);
  if (l.memories.trim()) parts.push(`# Your memories\nWhat you saved in earlier runs (limbic_remember adds, limbic_forget removes):\n${l.memories.trim()}`);
  return parts.join("\n\n");
}

/** Appends a dated memory line; the oldest lines go when the memory passes its size. */
export async function remember(s: Services, agentId: string, text: string): Promise<void> {
  const line = `- (${new Date().toISOString().slice(0, 10)}) ${text.replace(/\s+/g, " ").trim()}`;
  const { memories } = await getLimbic(s, agentId);
  let lines = [...memories.split("\n").filter((l) => l.trim()), line];
  while (lines.join("\n").length > MAX_MEMORY_CHARS && lines.length > 1) lines = lines.slice(1);
  await s.d.db.insert(limbic).values({ agentId, memories: lines.join("\n") })
    .onConflictDoUpdate({ target: limbic.agentId, set: { memories: lines.join("\n"), updatedAt: sql`now()` } });
}

export async function forget(s: Services, agentId: string, match: string): Promise<number> {
  const { memories } = await getLimbic(s, agentId);
  const lines = memories.split("\n");
  const keep = lines.filter((l) => !l.toLowerCase().includes(match.toLowerCase()));
  if (keep.length !== lines.length) await s.d.db.update(limbic).set({ memories: keep.join("\n"), updatedAt: new Date() }).where(eq(limbic.agentId, agentId));
  return lines.length - keep.length;
}

const maps = new Map<string, { mtime: number; entries: CortexEntry[] }>();

/** The agent's map, re-read when its file changes; null when the agent has none. */
export async function cortexOf(s: Services, agentSlug: string): Promise<CortexEntry[] | null> {
  const file = cortexFile(s.config.cortexDir, agentSlug);
  const st = await stat(file).catch(() => null);
  if (!st) return null;
  const cached = maps.get(file);
  if (cached?.mtime === st.mtimeMs) return cached.entries;
  const entries = await readIndex(file);
  maps.set(file, { mtime: st.mtimeMs, entries });
  return entries;
}

export async function cortexSearch(s: Services, entries: CortexEntry[], query: string, limit: number) {
  // by meaning when the map has embeddings and Ollama answers; by words otherwise
  let embedding: number[] | null = null;
  if (entries.some((e) => e.embedding?.length)) embedding = (await s.embeddings.embed([query]).catch(() => []))[0] ?? null;
  return search(entries, query, { embedding, limit });
}

export async function cortexRead(s: Services, entries: CortexEntry[], ref: { path?: string; index?: number }, o: { sql?: string; limit?: number }) {
  return (await readEntry(entries, s.config.lakehouseDir, ref, o)).text;
}
