// The Cortex: an agent's read-only map of the knowledge it may use. A parquet
// file on the storage, `<agent>_ctx.parquet`, holds one row per markdown or
// parquet file the agent has access to: an index, its location, what it is
// about, and an embedding of that description. The agent searches the map,
// then reads a file it found. It can read nothing that isn't on the map.
import { readFile, readdir, realpath, stat, mkdir, rename } from "node:fs/promises";
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { DuckDBInstance, type DuckDBConnection } from "@duckdb/node-api";

export type CortexKind = "markdown" | "parquet";

export interface CortexEntry {
  index: number;
  path: string;
  kind: CortexKind;
  about: string;
  embedding: number[] | null;
}

export interface CortexHit extends Omit<CortexEntry, "embedding"> {
  score: number;
}

export const cortexFile = (dir: string, agentSlug: string) => join(dir, `${agentSlug}_ctx.parquet`);

async function withDb<T>(f: (c: DuckDBConnection) => Promise<T>): Promise<T> {
  const db = await DuckDBInstance.create(":memory:", { memory_limit: "512MB", threads: "2" });
  const c = await db.connect();
  try {
    return await f(c);
  } finally {
    c.closeSync();
    db.closeSync();
  }
}

const sqlString = (s: string) => `'${s.replaceAll("'", "''")}'`;

/** Reads the map. Column names are matched loosely (path/location, about/description/summary, index/id). */
export async function readIndex(file: string): Promise<CortexEntry[]> {
  try {
    await stat(file);
  } catch {
    return [];
  }
  return withDb(async (c) => {
    const rows = (await c.runAndReadAll(`SELECT * FROM read_parquet(${sqlString(file)})`)).getRowObjectsJS() as Record<string, unknown>[];
    const pick = (r: Record<string, unknown>, ...names: string[]) => {
      for (const n of names) for (const k of Object.keys(r)) if (k.toLowerCase() === n && r[k] != null) return r[k];
      return null;
    };
    return rows.map((r, i) => {
      const path = String(pick(r, "path", "location", "file") ?? "");
      const kind = String(pick(r, "kind", "type") ?? (/\.parquet$/i.test(path) ? "parquet" : "markdown")).toLowerCase().includes("parquet") ? "parquet" : "markdown";
      const emb = pick(r, "embedding", "vector");
      return {
        index: Number(pick(r, "index", "idx", "id") ?? i),
        path,
        kind,
        about: String(pick(r, "about", "description", "summary", "what") ?? ""),
        embedding: Array.isArray(emb) ? (emb as unknown[]).map(Number) : null,
      } satisfies CortexEntry;
    }).filter((e) => e.path);
  });
}

function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

const words = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").split(/[^a-z0-9]+/).filter((w) => w.length > 2);

/**
 * Finds the entries closest to a query: by meaning when the map has embeddings
 * and a query embedding is given, else by the words the query shares with
 * each entry's description and path.
 */
export function search(entries: CortexEntry[], query: string, o: { embedding?: number[] | null; limit?: number } = {}): CortexHit[] {
  const limit = o.limit ?? 8;
  const q = words(query);
  const scored = entries.map((e) => {
    let score: number;
    if (o.embedding && e.embedding?.length) score = cosine(o.embedding, e.embedding);
    else {
      const text = new Set(words(`${e.about} ${e.path}`));
      score = q.length ? q.filter((w) => text.has(w)).length / q.length : 0;
    }
    const { embedding: _e, ...rest } = e;
    return { ...rest, score };
  });
  return scored.filter((h) => h.score > 0 || !q.length).sort((a, b) => b.score - a.score).slice(0, limit);
}

export class CortexDenied extends Error {}

/** The file of an entry, resolved under the storage root (symlinks included); refused when it would leave it. */
async function locate(root: string, path: string): Promise<string> {
  const base = await realpath(root);
  const target = isAbsolute(path) ? path : resolve(base, path);
  let real: string;
  try {
    real = await realpath(target);
  } catch {
    throw new CortexDenied(`${path} is on the map but doesn't exist on the storage`);
  }
  if (real !== base && !real.startsWith(base + sep)) throw new CortexDenied(`${path} is outside the storage`);
  return real;
}

const FORBIDDEN = /\b(attach|copy|export|import|install|load|pragma|set|create|insert|update|delete|drop|alter|call)\b/i;

/**
 * Reads one entry of the map (by path or index). A markdown file comes back as
 * text; a parquet file as its schema and rows, or the result of `sql` run over
 * it as table `t`. The parquet is loaded into memory first and file access is
 * then switched off, so the query can't reach any other file.
 */
export async function readEntry(
  entries: CortexEntry[],
  root: string,
  ref: { path?: string; index?: number },
  o: { sql?: string; limit?: number; maxChars?: number } = {},
): Promise<{ entry: CortexEntry; text: string }> {
  const entry = entries.find((e) => (ref.index != null && e.index === ref.index) || (ref.path && e.path === ref.path));
  if (!entry) throw new CortexDenied(`${ref.path ?? `#${ref.index}`} isn't on this agent's cortex map`);
  const file = await locate(root, entry.path);
  const maxChars = o.maxChars ?? 100_000;
  if (entry.kind === "markdown") {
    const text = await readFile(file, "utf8");
    return { entry, text: text.length > maxChars ? `${text.slice(0, maxChars)}\n…[truncated]` : text };
  }
  const limit = Math.min(o.limit ?? 50, 500);
  return withDb(async (c) => {
    await c.run(`CREATE TABLE t AS SELECT * FROM read_parquet(${sqlString(file)})`);
    await c.run("SET enable_external_access = false");
    await c.run("SET lock_configuration = true");
    const schema = (await c.runAndReadAll("DESCRIBE t")).getRowObjectsJS() as { column_name: string; column_type: string }[];
    const count = Number(((await c.runAndReadAll("SELECT count(*) AS n FROM t")).getRowObjectsJS()[0] as { n: bigint | number }).n);
    let query = "SELECT * FROM t";
    if (o.sql?.trim()) {
      const sql = o.sql.trim().replace(/;\s*$/, "");
      if (!/^(select|with)\b/i.test(sql) || sql.includes(";") || FORBIDDEN.test(sql.replace(/'[^']*'/g, "''")))
        throw new CortexDenied("only a single SELECT (or WITH … SELECT) over table t is allowed");
      query = sql;
    }
    const result = await c.runAndReadAll(`SELECT * FROM (${query}) LIMIT ${limit}`);
    const rows = result.getRowObjectsJson();
    const head = `Parquet ${entry.path}: ${count} rows\nColumns: ${schema.map((s) => `${s.column_name} ${s.column_type}`).join(", ")}`;
    const body = JSON.stringify(rows, null, 0);
    return { entry, text: `${head}\n${o.sql ? "Query result" : "First rows"} (${rows.length}):\n${body.length > maxChars ? `${body.slice(0, maxChars)}…[truncated]` : body}` };
  });
}

/** What a file is about, without a model: a markdown's title and first paragraph, a parquet's shape. */
async function describe(c: DuckDBConnection, file: string, kind: CortexKind): Promise<string> {
  if (kind === "markdown") {
    const text = await readFile(file, "utf8");
    const title = /^#\s+(.+)$/m.exec(text)?.[1]?.trim();
    const para = text.replace(/^---[\s\S]*?---\s*/, "").split(/\n\s*\n/).map((p) => p.replace(/^#+\s.*$/gm, "").trim()).find((p) => p.length > 20) ?? "";
    return [title, para.replace(/\s+/g, " ").slice(0, 400)].filter(Boolean).join(": ");
  }
  const schema = (await c.runAndReadAll(`DESCRIBE SELECT * FROM read_parquet(${sqlString(file)})`)).getRowObjectsJS() as { column_name: string; column_type: string }[];
  const n = Number(((await c.runAndReadAll(`SELECT count(*) AS n FROM read_parquet(${sqlString(file)})`)).getRowObjectsJS()[0] as { n: bigint }).n);
  return `Table with ${n} rows; columns: ${schema.map((s) => `${s.column_name} (${s.column_type})`).join(", ")}`.slice(0, 600);
}

async function scan(dir: string, out: string[], depth = 0) {
  if (depth > 12) return;
  for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    // symlinks are skipped: one could point outside the storage, and its description would leak it onto the map
    if (e.name.startsWith(".") || e.name === "node_modules" || e.isSymbolicLink()) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) await scan(p, out, depth + 1);
    else if (/\.(md|markdown|parquet)$/i.test(e.name) && !/_ctx\.parquet$/.test(e.name)) out.push(p);
  }
}

/**
 * Builds (or rebuilds) an agent's map from folders on the storage: every
 * markdown and parquet file under them, described and, when `embed` is given,
 * embedded. Written atomically next to the old one.
 */
export async function buildIndex(o: { file: string; root: string; sources: string[]; embed?: ((texts: string[]) => Promise<number[][]>) | null }): Promise<{ entries: number; embedded: boolean }> {
  const base = await realpath(o.root);
  const files: string[] = [];
  for (const s of o.sources) {
    const dir = await locate(base, s).catch(() => null);
    if (dir) await scan(dir, files);
  }
  const unique = [...new Set(files)].sort();
  return withDb(async (c) => {
    const rows: { path: string; kind: CortexKind; about: string }[] = [];
    for (const f of unique) {
      const kind: CortexKind = extname(f).toLowerCase() === ".parquet" ? "parquet" : "markdown";
      const about = await describe(c, f, kind).catch((e) => `(unreadable: ${(e as Error).message.slice(0, 120)})`);
      rows.push({ path: relative(base, f), kind, about });
    }
    let vectors: number[][] | null = null;
    if (o.embed && rows.length) {
      try {
        vectors = [];
        for (let i = 0; i < rows.length; i += 32) vectors.push(...(await o.embed(rows.slice(i, i + 32).map((r) => `${r.path}\n${r.about}`))));
      } catch {
        vectors = null; // no embedding service: the map still works by keywords
      }
    }
    await c.run(`CREATE TABLE ctx ("index" INTEGER, path VARCHAR, kind VARCHAR, about VARCHAR, embedding FLOAT[])`);
    for (const [i, r] of rows.entries()) {
      const v = vectors?.[i];
      const emb = v?.length ? `[${v.map((x) => (Number.isFinite(x) ? x : 0)).join(",")}]::FLOAT[]` : "NULL";
      await c.run(`INSERT INTO ctx VALUES (${i}, ${sqlString(r.path)}, ${sqlString(r.kind)}, ${sqlString(r.about)}, ${emb})`);
    }
    await mkdir(dirname(o.file), { recursive: true });
    const tmp = `${o.file}.tmp-${process.pid}`;
    await c.run(`COPY ctx TO ${sqlString(tmp)} (FORMAT parquet)`);
    await rename(tmp, o.file);
    return { entries: rows.length, embedded: !!vectors };
  });
}
