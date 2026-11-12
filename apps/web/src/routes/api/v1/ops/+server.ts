// The catalog: every operation this caller may run, with its JSON Schema. The CLI
// builds its commands from it (and caches it by version), and it documents the API.
import { createHash } from "node:crypto";
import { json } from "@sveltejs/kit";
import { catalog } from "#lib/server/ops/registry.ts";
import { UI } from "#lib/server/ops/define.ts";

export const GET = ({ locals }) => {
  const ctx = locals.ctx ?? UI;
  const ops = catalog(ctx.access);
  const version = createHash("sha256").update(JSON.stringify(ops)).digest("hex").slice(0, 12);
  return json({ version, caller: { actor: ctx.actor, access: ctx.access, agent: ctx.agent?.slug ?? null }, ops });
};
