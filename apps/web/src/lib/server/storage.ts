// A project's storage (scope §26): its folder (STORAGE_DIR/<slug>, /storage in
// script runs), and optionally an S3-compatible bucket whose keys are secret variables.
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { DeleteObjectCommand, GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Envelope, parseMasterKey } from "@miniasys/core";
import { resolveVariables, type projects } from "@miniasys/db";
import { confine } from "@miniasys/tools";
import { database, server } from "./db.ts";
import { OpError } from "./ops/define.ts";

type Project = typeof projects.$inferSelect;

export interface S3Config {
  endpoint?: string | null;
  bucket: string;
  prefix?: string;
  region?: string;
  accessKeyVar: string;
  secretKeyVar: string;
  /** MinIO and most self-hosted servers need path-style URLs */
  pathStyle?: boolean;
}

export interface Item {
  key: string;
  size: number;
  modified: Date | null;
}

const MAX_GET = 10 * 1024 * 1024;

export const envelope = () => new Envelope(parseMasterKey(server().config.masterKey ?? undefined));
export const folderRoot = async (p: Project) => {
  const dir = join(server().config.storageDir, p.slug);
  await mkdir(dir, { recursive: true });
  return dir;
};
export const s3Of = (p: Project) => (p.storage as S3Config | null) ?? null;

async function s3(p: Project): Promise<{ client: S3Client; cfg: S3Config }> {
  const cfg = s3Of(p);
  if (!cfg) throw new OpError(400, `p/${p.slug} has no S3 storage (storage.config)`);
  const { env } = await resolveVariables(database(), envelope(), p.id);
  const accessKeyId = env[cfg.accessKeyVar];
  const secretAccessKey = env[cfg.secretKeyVar];
  if (!accessKeyId || !secretAccessKey) throw new OpError(400, `set the variables ${cfg.accessKeyVar} and ${cfg.secretKeyVar} (secrets) for p/${p.slug}'s S3 keys`);
  const client = new S3Client({
    region: cfg.region || "us-east-1", credentials: { accessKeyId, secretAccessKey },
    ...(cfg.endpoint ? { endpoint: cfg.endpoint } : {}), forcePathStyle: cfg.pathStyle ?? !!cfg.endpoint,
  });
  return { client, cfg };
}
const s3Key = (cfg: S3Config, key: string) => `${(cfg.prefix ?? "").replace(/^\/+|\/+$/g, "")}${cfg.prefix ? "/" : ""}${key.replace(/^\/+/, "")}`;

export async function list(p: Project, backend: "folder" | "s3", prefix: string): Promise<Item[]> {
  if (backend === "folder") {
    const root = await folderRoot(p);
    const start = prefix ? await confine(root, prefix) : root;
    const out: Item[] = [];
    const walk = async (d: string) => {
      for (const e of await readdir(d, { withFileTypes: true })) {
        if (out.length >= 5000) return;
        const full = join(d, e.name);
        if (e.isDirectory()) await walk(full);
        else if (e.isFile()) {
          const st = await stat(full);
          out.push({ key: relative(root, full).split(sep).join("/"), size: st.size, modified: st.mtime });
        }
      }
    };
    if ((await stat(start)).isDirectory()) await walk(start);
    return out.sort((a, b) => a.key.localeCompare(b.key));
  }
  const { client, cfg } = await s3(p);
  const out: Item[] = [];
  let token: string | undefined;
  const base = s3Key(cfg, "");
  do {
    const r = await client.send(new ListObjectsV2Command({ Bucket: cfg.bucket, Prefix: s3Key(cfg, prefix), ContinuationToken: token, MaxKeys: 1000 }));
    for (const o of r.Contents ?? []) out.push({ key: (o.Key ?? "").slice(base.length), size: o.Size ?? 0, modified: o.LastModified ?? null });
    token = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (token && out.length < 5000);
  return out;
}

export async function get(p: Project, backend: "folder" | "s3", key: string): Promise<Buffer> {
  if (backend === "folder") {
    const real = await confine(await folderRoot(p), key);
    if ((await stat(real)).size > MAX_GET) throw new OpError(400, `${key} is larger than 10 MB: read it from a script`);
    return readFile(real);
  }
  const { client, cfg } = await s3(p);
  const r = await client.send(new GetObjectCommand({ Bucket: cfg.bucket, Key: s3Key(cfg, key) }));
  if ((r.ContentLength ?? 0) > MAX_GET) throw new OpError(400, `${key} is larger than 10 MB: read it from a script`);
  return Buffer.from(await r.Body!.transformToByteArray());
}

export async function put(p: Project, backend: "folder" | "s3", key: string, body: Buffer) {
  if (backend === "folder") {
    const real = await confine(await folderRoot(p), key, { write: true });
    await mkdir(dirname(real), { recursive: true });
    await writeFile(real, body);
    return;
  }
  const { client, cfg } = await s3(p);
  await client.send(new PutObjectCommand({ Bucket: cfg.bucket, Key: s3Key(cfg, key), Body: body }));
}

export async function remove(p: Project, backend: "folder" | "s3", key: string) {
  if (backend === "folder") {
    const root = await folderRoot(p);
    const real = await confine(root, key, { write: true });
    if (real === root) throw new OpError(400, "can't delete the storage folder itself");
    await rm(real, { recursive: true, force: true });
    return;
  }
  const { client, cfg } = await s3(p);
  await client.send(new DeleteObjectCommand({ Bucket: cfg.bucket, Key: s3Key(cfg, key) }));
}
