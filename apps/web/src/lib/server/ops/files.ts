// A project's code (scope §26): its folder in Orbitalia Moon, a git repository the
// platform creates, changes and deletes. Every change is a commit by its actor.
import { z } from "zod";
import { PathDenied } from "@miniasys/tools";
import { RepoError } from "@miniasys/projects";
import { changed, folder, repos } from "../repos.ts";
import { audit, defineOp, OpError } from "./define.ts";
import { projectBySlug, ProjectRef } from "./common.ts";

const FilePath = z.string().min(1).max(500).describe("path inside the project, e.g. scripts/etl.py");
const Sha = z.string().regex(/^[0-9a-f]{4,40}$/, "a commit id");

/** the repo's errors as operation errors: bad paths and stale writes are the caller's to fix */
async function fs<T>(f: () => Promise<T>): Promise<T> {
  try {
    return await f();
  } catch (e) {
    if (e instanceof PathDenied) throw new OpError(400, e.message);
    if (e instanceof RepoError) throw new OpError(/changed since/.test(e.message) ? 409 : 400, e.message);
    if ((e as NodeJS.ErrnoException).code === "ENOENT" || /does not exist|exists on disk, but not in/.test((e as Error).message)) throw new OpError(404, (e as Error).message.split("\n")[0]!);
    throw e;
  }
}

export const list = defineOp({
  name: "files.list",
  summary: "List a project's code: files and folders under a path (the whole tree by default), with sizes, and the current commit.",
  access: "read",
  input: z.object({ project: ProjectRef, path: z.string().max(500).default(""), recursive: z.boolean().default(true) }),
  run: async (_c, i) => {
    const p = await projectBySlug(i.project);
    await folder(p);
    return fs(async () => ({ head: await repos().head(p.slug), entries: await repos().list(p.slug, i.path, { recursive: i.recursive }) }));
  },
});

export const get = defineOp({
  name: "files.get",
  summary: "Read a file of a project's code (text, or base64 for binary files), now or at an older commit; returns the commit to pass as base when writing.",
  access: "read",
  input: z.object({ project: ProjectRef, path: FilePath, version: Sha.optional().describe("a commit id from files.history") }),
  run: async (_c, i) => {
    const p = await projectBySlug(i.project);
    await folder(p);
    return fs(async () => ({ ...(await repos().read(p.slug, i.path, i.version)), base: i.version ?? (await repos().log(p.slug, i.path, 1))[0]?.sha ?? null }));
  },
});

export const put = defineOp({
  name: "files.put",
  summary: "Create or overwrite a file in a project's code, as a commit. Pass base (from files.get) to refuse overwriting someone else's newer change. Folders are created as needed.",
  access: "write",
  input: z.object({
    project: ProjectRef,
    path: FilePath,
    content: z.string().max(5_000_000),
    encoding: z.enum(["utf8", "base64"]).default("utf8"),
    message: z.string().max(500).optional().describe("the commit message"),
    base: Sha.optional(),
  }),
  run: async (ctx, i) => {
    const p = await projectBySlug(i.project);
    await folder(p);
    const r = await fs(() => repos().write(p.slug, i.path, i.encoding === "base64" ? Buffer.from(i.content, "base64") : i.content, { actor: ctx.actor, ...(i.message ? { message: i.message } : {}), ...(i.base ? { baseSha: i.base } : {}) }));
    if (r.sha) {
      await audit(ctx, "file.put", { type: "file", id: `${p.slug}/${i.path}` }, { sha: r.sha });
      await changed(p, { path: i.path, sha: r.sha });
    }
    return { path: i.path, sha: r.sha, unchanged: !r.sha };
  },
});

export const remove = defineOp({
  name: "files.delete",
  summary: "Delete a file or a folder (recursively) from a project's code, as a commit (it stays in the history).",
  access: "write",
  destructive: true,
  input: z.object({ project: ProjectRef, path: FilePath, message: z.string().max(500).optional() }),
  run: async (ctx, i) => {
    const p = await projectBySlug(i.project);
    await folder(p);
    const r = await fs(() => repos().remove(p.slug, i.path, { actor: ctx.actor, ...(i.message ? { message: i.message } : {}) }));
    if (r.sha) {
      await audit(ctx, "file.delete", { type: "file", id: `${p.slug}/${i.path}` }, { sha: r.sha });
      await changed(p, { path: i.path, sha: r.sha, deleted: true });
    }
    return { sha: r.sha };
  },
});

export const move = defineOp({
  name: "files.move",
  summary: "Move or rename a file or folder in a project's code, as a commit.",
  access: "write",
  input: z.object({ project: ProjectRef, from: FilePath, to: FilePath, message: z.string().max(500).optional() }),
  run: async (ctx, i) => {
    const p = await projectBySlug(i.project);
    await folder(p);
    const r = await fs(() => repos().move(p.slug, i.from, i.to, { actor: ctx.actor, ...(i.message ? { message: i.message } : {}) }));
    if (r.sha) {
      await audit(ctx, "file.move", { type: "file", id: `${p.slug}/${i.from}` }, { to: i.to, sha: r.sha });
      await changed(p, { path: i.to, from: i.from, sha: r.sha });
    }
    return { sha: r.sha };
  },
});

export const history = defineOp({
  name: "files.history",
  summary: "The commits of a project's code (or of one path), newest first: who changed what, when.",
  access: "read",
  input: z.object({ project: ProjectRef, path: z.string().max(500).optional(), limit: z.number().int().min(1).max(500).default(50) }),
  run: async (_c, i) => {
    const p = await projectBySlug(i.project);
    await folder(p);
    return fs(() => repos().log(p.slug, i.path, i.limit));
  },
});

export const show = defineOp({
  name: "files.show",
  summary: "One commit of a project's code: its message and its diff (optionally for one path).",
  access: "read",
  input: z.object({ project: ProjectRef, sha: Sha, path: z.string().max(500).optional() }),
  run: async (_c, i) => {
    const p = await projectBySlug(i.project);
    await folder(p);
    return { diff: await fs(() => repos().show(p.slug, i.sha, i.path)) };
  },
});
