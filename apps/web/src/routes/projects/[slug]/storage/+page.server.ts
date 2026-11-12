import { error, isHttpError } from "@sveltejs/kit";
import { call } from "#lib/server/ops/web.ts";
import type { OpOutput } from "#lib/server/ops/types.ts";

export const load = async ({ params, url, locals, parent }) => {
  const { project } = await parent();
  const s3 = (project.storage ?? null) as { endpoint?: string | null; bucket: string; prefix?: string; region?: string; accessKeyVar: string; secretKeyVar: string; pathStyle?: boolean } | null;
  const backend = url.searchParams.get("backend") === "s3" && s3 ? "s3" : "folder";
  try {
    return { backend, s3, items: await call<OpOutput<"storage.list">>(locals, "storage.list", { project: params.slug, backend }), error: null as string | null };
  } catch (e) {
    // an S3 bucket that can't be reached still shows the page, with the reason
    if (isHttpError(e) && backend === "s3") return { backend, s3, items: [], error: e.body.message };
    if (isHttpError(e)) error(e.status, e.body.message);
    throw e;
  }
};
