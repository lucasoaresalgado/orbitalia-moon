// A project's storage (scope §26): the folder its scripts write to (/storage),
// and optionally an S3-compatible bucket. Browse, read, write and delete from any door.
import { z } from "zod";
import { PathDenied } from "@miniasys/tools";
import { projects, eq } from "@miniasys/db";
import { db } from "../db.ts";
import * as store from "../storage.ts";
import { audit, defineOp, OpError } from "./define.ts";
import { projectBySlug, ProjectRef } from "./common.ts";

const Backend = z.enum(["folder", "s3"]).default("folder").describe("folder (/storage in runs) or s3");
const Key = z.string().min(1).max(1000).describe("path in the storage, e.g. out/report.csv");

async function guard<T>(f: () => Promise<T>): Promise<T> {
  try {
    return await f();
  } catch (e) {
    if (e instanceof PathDenied) throw new OpError(/does not exist/.test(e.message) ? 404 : 400, e.message);
    const name = (e as { name?: string }).name;
    if (name === "NoSuchKey" || name === "NotFound" || (e as NodeJS.ErrnoException).code === "ENOENT") throw new OpError(404, "no such object");
    if (name === "NoSuchBucket" || name === "AccessDenied" || name === "InvalidAccessKeyId" || name === "SignatureDoesNotMatch") throw new OpError(400, `S3: ${name}`);
    throw e;
  }
}

export const list = defineOp({
  name: "storage.list",
  summary: "List a project's storage (its folder, or its S3 bucket): keys under a prefix, with sizes and times.",
  access: "read",
  input: z.object({ project: ProjectRef, backend: Backend, prefix: z.string().max(1000).default("") }),
  run: async (_c, i) => guard(async () => store.list(await projectBySlug(i.project), i.backend, i.prefix)),
});

export const get = defineOp({
  name: "storage.get",
  summary: "Read an object from a project's storage (up to 10 MB): text, or base64 for binary.",
  access: "read",
  input: z.object({ project: ProjectRef, backend: Backend, key: Key }),
  run: async (_c, i) =>
    guard(async () => {
      const buf = await store.get(await projectBySlug(i.project), i.backend, i.key);
      const text = buf.toString("utf8");
      const binary = buf.includes(0) || text.includes("�");
      return { key: i.key, size: buf.length, encoding: binary ? "base64" : "utf8", content: binary ? buf.toString("base64") : text };
    }),
});

export const put = defineOp({
  name: "storage.put",
  summary: "Write an object to a project's storage (folders are created as needed).",
  access: "write",
  input: z.object({ project: ProjectRef, backend: Backend, key: Key, content: z.string().max(15_000_000), encoding: z.enum(["utf8", "base64"]).default("utf8") }),
  run: async (ctx, i) =>
    guard(async () => {
      const p = await projectBySlug(i.project);
      await store.put(p, i.backend, i.key, i.encoding === "base64" ? Buffer.from(i.content, "base64") : Buffer.from(i.content));
      await audit(ctx, "storage.put", { type: "storage", id: `${p.slug}/${i.backend}/${i.key}` });
      return { ok: true };
    }),
});

export const remove = defineOp({
  name: "storage.delete",
  summary: "Delete an object (or, in the folder, a whole subfolder) from a project's storage.",
  access: "write",
  destructive: true,
  input: z.object({ project: ProjectRef, backend: Backend, key: Key }),
  run: async (ctx, i) =>
    guard(async () => {
      const p = await projectBySlug(i.project);
      await store.remove(p, i.backend, i.key);
      await audit(ctx, "storage.delete", { type: "storage", id: `${p.slug}/${i.backend}/${i.key}` });
      return { ok: true };
    }),
});

export const config = defineOp({
  name: "storage.config",
  summary: "Set (or, with s3: null, remove) a project's S3-compatible storage: endpoint (empty for AWS), bucket, prefix, region, and the names of the secret variables holding the access and secret keys. Scripts then get AWS_* variables and MINIASYS_S3.",
  access: "write",
  input: z.object({
    project: ProjectRef,
    s3: z.object({
      endpoint: z.url().nullable().optional().describe("e.g. http://127.0.0.1:9000 for MinIO; omit for AWS"),
      bucket: z.string().min(3).max(63),
      prefix: z.string().max(500).default(""),
      region: z.string().default("us-east-1"),
      access_key_var: z.string().regex(/^[A-Z][A-Z0-9_]*$/).default("S3_ACCESS_KEY_ID"),
      secret_key_var: z.string().regex(/^[A-Z][A-Z0-9_]*$/).default("S3_SECRET_ACCESS_KEY"),
      path_style: z.boolean().optional(),
    }).nullable(),
  }),
  run: async (ctx, i) => {
    const p = await projectBySlug(i.project);
    const cfg: store.S3Config | null = i.s3
      ? { endpoint: i.s3.endpoint ?? null, bucket: i.s3.bucket, prefix: i.s3.prefix, region: i.s3.region, accessKeyVar: i.s3.access_key_var, secretKeyVar: i.s3.secret_key_var, ...(i.s3.path_style !== undefined ? { pathStyle: i.s3.path_style } : {}) }
      : null;
    await db().update(projects).set({ storage: cfg }).where(eq(projects.id, p.id));
    await audit(ctx, "storage.config", { type: "project", id: p.slug }, cfg);
    return { s3: cfg, folder: await store.folderRoot(p) };
  },
});
