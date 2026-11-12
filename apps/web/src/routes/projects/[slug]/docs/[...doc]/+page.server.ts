import { error, isHttpError } from "@sveltejs/kit";
import { call } from "#lib/server/ops/web.ts";
import type { OpOutput } from "#lib/server/ops/types.ts";

export const load = async ({ params, url, locals }) => {
  const v = Number(url.searchParams.get("v")) || undefined;
  try {
    const doc = await call<OpOutput<"docs.get">>(locals, "docs.get", { project: params.slug, doc: params.doc, ...(v ? { version: v } : {}) });
    const history = await call<OpOutput<"docs.history">>(locals, "docs.history", { project: params.slug, doc: params.doc });
    return { slug: params.doc, doc, history };
  } catch (e) {
    // a doc that doesn't exist yet opens empty, to be written
    if (isHttpError(e) && e.status === 404 && !v) return { slug: params.doc, doc: null, history: [] };
    if (isHttpError(e)) error(e.status, e.body.message);
    throw e;
  }
};
