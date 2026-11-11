import { json } from "@sveltejs/kit";
import { z } from "zod";
import { decide } from "#lib/server/approvals.ts";

const Body = z.object({ decision: z.enum(["approve", "reject"]), comment: z.string().max(4000).optional(), answer: z.string().max(20_000).optional(), raiseUsd: z.number().positive().max(1000).optional() });

export const POST = async ({ params, request }) => {
  await decide(params.id, Body.parse(await request.json()));
  return json({ ok: true });
};
