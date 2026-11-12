// The budget unit switch (dollars or usage tokens): saved at once, audited.
import { json } from "@sveltejs/kit";
import { call } from "#lib/server/ops/web.ts";

export const POST = async ({ request, locals }) => json(await call(locals, "settings.budget_unit", await request.json()));
