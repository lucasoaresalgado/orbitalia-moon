import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DuckDBInstance } from "@duckdb/node-api";
import { buildIndex, CortexDenied, cortexFile, readEntry, readIndex, search } from "../src/index.ts";

let root: string;
let outside: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "cortex-"));
  outside = await mkdtemp(join(tmpdir(), "cortex-out-"));
  await mkdir(join(root, "docs/sales"), { recursive: true });
  await mkdir(join(root, "gold"), { recursive: true });
  await writeFile(join(root, "docs/sales/README.md"), "# Sales glossary\n\nDefinitions of revenue, gross margin and churn used by the sales dashboards.\n");
  await writeFile(join(root, "docs/hiring.md"), "# Hiring process\n\nHow candidates move from screening to offer, and who approves each step.\n");
  await writeFile(join(outside, "secret.md"), "# Secret\n\nnot for agents");
  await symlink(join(outside, "secret.md"), join(root, "docs/escape.md"));
  const db = await DuckDBInstance.create(":memory:");
  const c = await db.connect();
  await c.run(`COPY (SELECT range AS id, 'r' || range AS region, range * 10.5 AS revenue FROM range(25)) TO '${join(root, "gold/revenue.parquet")}' (FORMAT parquet)`);
  c.closeSync();
  db.closeSync();
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
});

describe("cortex", () => {
  it("builds a map of the markdown and parquet files under the sources, with fake embeddings", async () => {
    const file = cortexFile(join(root, "cortex"), "dev");
    const r = await buildIndex({ file, root, sources: ["docs", "gold"], embed: async (texts) => texts.map((t) => [t.includes("revenue") ? 1 : 0, t.includes("Hiring") ? 1 : 0, 0.1]) });
    expect(r).toEqual({ entries: 3, embedded: true });
    const entries = await readIndex(file);
    // the symlink to a file outside the storage is not on the map, nor is its content
    expect(entries.map((e) => [e.path, e.kind])).toEqual([
      ["docs/hiring.md", "markdown"], ["docs/sales/README.md", "markdown"], ["gold/revenue.parquet", "parquet"],
    ]);
    expect(JSON.stringify(entries)).not.toContain("not for agents");
    expect(entries.find((e) => e.kind === "parquet")!.about).toMatch(/25 rows.*revenue/);
    expect(entries[0]!.embedding).toHaveLength(3);
  });

  it("searches by meaning, and by words without embeddings", async () => {
    const entries = await readIndex(cortexFile(join(root, "cortex"), "dev"));
    expect(search(entries, "q", { embedding: [0, 1, 0.1], limit: 1 })[0]!.path).toBe("docs/hiring.md");
    expect(search(entries.map((e) => ({ ...e, embedding: null })), "gross margin churn")[0]!.path).toBe("docs/sales/README.md");
  });

  it("reads markdown and queries parquet, but only what is on the map and inside the storage", async () => {
    const entries = await readIndex(cortexFile(join(root, "cortex"), "dev"));
    expect((await readEntry(entries, root, { path: "docs/hiring.md" })).text).toContain("Hiring process");
    const q = await readEntry(entries, root, { path: "gold/revenue.parquet" }, { sql: "SELECT sum(revenue) AS total FROM t WHERE id < 3" });
    expect(q.text).toContain("31.5");
    // a map written by someone else may still list a symlink that leaves the storage: refused at read time
    await expect(readEntry([...entries, { index: 9, path: "docs/escape.md", kind: "markdown", about: "", embedding: null }], root, { path: "docs/escape.md" })).rejects.toThrow(/outside the storage/);
    await expect(readEntry(entries, root, { path: "../etc/passwd" })).rejects.toThrow(CortexDenied);
    await expect(readEntry(entries, root, { path: "gold/revenue.parquet" }, { sql: "SELECT * FROM read_text('/etc/passwd')" })).rejects.toThrow();
    await expect(readEntry(entries, root, { path: "gold/revenue.parquet" }, { sql: "COPY t TO '/tmp/x.csv'" })).rejects.toThrow(/single SELECT/);
  });
});
