// A project's web files, for the playground's preview frame (lib/server/preview.ts).
// Read-only, confined to the project folder (never .git), sandboxed by CSP.
import { readFile, stat } from "node:fs/promises";
import { extname, join } from "node:path";
import { error } from "@sveltejs/kit";
import { confine, PathDenied } from "@miniasys/tools";
import { repos } from "#lib/server/repos.ts";
import { validPreviewToken } from "#lib/server/preview.ts";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".htm": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8", ".md": "text/plain; charset=utf-8",
  ".woff2": "font/woff2", ".woff": "font/woff", ".wasm": "application/wasm", ".csv": "text/plain; charset=utf-8", ".xml": "text/plain; charset=utf-8",
};
const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;

export const GET = async ({ params }) => {
  if (!SLUG.test(params.slug) || !validPreviewToken(params.slug, params.token)) error(403, "this preview link expired: reopen the playground");
  if (!(await repos().exists(params.slug))) error(404, "no such project folder");
  const root = repos().dirOf(params.slug);
  let file: string;
  try {
    file = await confine(root, params.path || "index.html");
    if ((await stat(file)).isDirectory()) file = await confine(root, join(params.path, "index.html"));
  } catch (e) {
    if (e instanceof PathDenied) error(403, "path denied");
    error(404, "not found");
  }
  const body = await readFile(file).catch(() => null);
  if (!body) error(404, "not found");
  return new Response(new Uint8Array(body), {
    headers: {
      "content-type": TYPES[extname(file).toLowerCase()] ?? "application/octet-stream",
      // an opaque origin: no cookies, no storage, no same-origin API calls; framed only by the app
      "content-security-policy": "sandbox allow-scripts allow-forms allow-modals allow-popups; default-src 'self' data: blob: 'unsafe-inline' 'unsafe-eval'; frame-ancestors 'self'; base-uri 'self'; form-action 'self'",
      "x-frame-options": "SAMEORIGIN",
      "cache-control": "no-store",
      "cross-origin-resource-policy": "same-origin",
    },
  });
};
