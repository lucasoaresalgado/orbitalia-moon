import { error, isHttpError } from "@sveltejs/kit";
import { call } from "#lib/server/ops/web.ts";
import type { OpOutput } from "#lib/server/ops/types.ts";

export const load = async ({ params, url, locals }) => {
  const path = url.searchParams.get("path");
  const version = url.searchParams.get("v");
  try {
    const tree = await call<OpOutput<"files.list">>(locals, "files.list", { project: params.slug });
    const file = path && tree.entries.some((e) => e.path === path && e.type === "file") || (path && version)
      ? await call<OpOutput<"files.get">>(locals, "files.get", { project: params.slug, path, ...(version ? { version } : {}) })
      : null;
    const history = path ? await call<OpOutput<"files.history">>(locals, "files.history", { project: params.slug, path, limit: 30 }) : [];
    return { tree, file, path, version, history, pending: null as string | null };
  } catch (e) {
    // a GitHub-linked project whose folder is still being cloned
    if (isHttpError(e) && e.status === 409) return { tree: { head: "", entries: [] }, file: null, path, version, history: [], pending: e.body.message };
    if (isHttpError(e)) error(e.status, e.body.message);
    throw e;
  }
};
