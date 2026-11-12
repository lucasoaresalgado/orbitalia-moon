// The kill switch (scope §8.8): no new leases; active runs cancel at their next turn boundary.
import { json } from "@sveltejs/kit";
import { call } from "#lib/server/ops/web.ts";

export const POST = async ({ request, locals }) => json(await call(locals, "system.pause", { paused: !!((await request.json()) as { paused?: boolean }).paused }));
