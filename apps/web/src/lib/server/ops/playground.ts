// The project playground: a test area for a project's code inside the platform.
// Preview its web pages in a sandboxed frame, and run commands against a copy of
// it in a sandbox (the worker's PlaygroundRunner).
import { z } from "zod";
import { runs, and, desc, eq } from "@miniasys/db";
import { db } from "../db.ts";
import { sendJob } from "../jobs.ts";
import { folder, repos } from "../repos.ts";
import { previewToken } from "../preview.ts";
import { audit, defineOp } from "./define.ts";
import { projectBySlug, ProjectRef } from "./common.ts";

export const info = defineOp({
  name: "playground.info",
  summary: "A project's playground: the web pages it can preview (HTML files), a signed preview base URL (valid 12 h), and the latest playground commands.",
  access: "read",
  input: z.object({ project: ProjectRef }),
  run: async (_c, i) => {
    const p = await projectBySlug(i.project);
    await folder(p);
    const files = await repos().list(p.slug);
    const pages = files.filter((f) => f.type === "file" && /\.html?$/i.test(f.path) && !/(^|\/)node_modules\//.test(f.path)).map((f) => f.path)
      .sort((a, b) => (a === "index.html" ? -1 : b === "index.html" ? 1 : a.split("/").length - b.split("/").length || a.localeCompare(b)));
    const recent = await db().select({ id: runs.id, status: runs.status, input: runs.input, error: runs.error, createdAt: runs.createdAt, finishedAt: runs.finishedAt })
      .from(runs).where(and(eq(runs.kind, "playground"), eq(runs.projectId, p.id))).orderBy(desc(runs.createdAt)).limit(20);
    return {
      pages,
      previewBase: `/preview/${previewToken(p.slug)}/${p.slug}/`,
      recent: recent.map((r) => ({ ...r, command: (r.input as { command?: string } | null)?.command ?? "" })),
      files: files.filter((f) => f.type === "file").length,
    };
  },
});

export const run = defineOp({
  name: "playground.run",
  summary: "Run a shell command against a copy of a project's code in a sandbox (the copy persists between commands; reset: true copies the code again). The project's variables are environment variables, secrets masked; storage at /storage. Returns the run id; follow it with runs.events.",
  access: "write",
  input: z.object({ project: ProjectRef, command: z.string().trim().min(1).max(4000), network: z.boolean().default(false), reset: z.boolean().default(false) }),
  run: async (ctx, i) => {
    const p = await projectBySlug(i.project);
    await folder(p);
    const [r] = await db().insert(runs).values({ kind: "playground", projectId: p.id, status: "queued", input: { command: i.command, network: i.network, reset: i.reset, by: ctx.actor } }).returning({ id: runs.id });
    await sendJob("playground.run", { runId: r!.id });
    await audit(ctx, "playground.run", { type: "project", id: p.slug }, { runId: r!.id, command: i.command.slice(0, 500), network: i.network });
    return { runId: r!.id };
  },
});
