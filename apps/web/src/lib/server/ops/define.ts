// Operations: every capability of the platform as one named function with a zod
// input schema. The web UI, the HTTP API (/api/v1), the MCP server (/mcp) and the
// CLI all go through these, so whatever one door can do, every door can do
// (scope §25). Handlers use the same db()/sql() helpers the routes always used.
import { isHttpError } from "@sveltejs/kit";
import { z } from "zod";
import { InvalidTransition } from "@miniasys/core";
import { audit as writeAudit, type Actor } from "@miniasys/db";
import { db } from "../db.ts";

/** read < write < admin: a token may run every operation at or below its level */
export const ACCESS = ["read", "write", "admin"] as const;
export type Access = (typeof ACCESS)[number];
export const allows = (have: Access, need: Access) => ACCESS.indexOf(have) >= ACCESS.indexOf(need);

export interface Ctx {
  actor: Actor;
  access: Access;
  /** the agent this caller acts as (a token bound to an agent, or X-Orbitalia Moon-Agent), else null */
  agent: { id: string; slug: string } | null;
}

/** The web UI's own caller: Lucas, logged in, with every right. */
export const UI: Ctx = { actor: "user", access: "admin", agent: null };

export interface Op<I extends z.ZodType = z.ZodType, O = unknown, N extends string = string> {
  /** dotted: <domain>.<action>, e.g. cards.create (the MCP tool is cards_create, the CLI command `cards create`) */
  name: N;
  summary: string;
  access: Access;
  /** deletes or overwrites something that can't be recovered */
  destructive?: boolean;
  input: I;
  run(ctx: Ctx, input: z.output<I>): Promise<O>;
}

export const defineOp = <const N extends string, I extends z.ZodType, O>(op: Op<I, O, N>): Op<I, O, N> => op;

export class OpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly issues?: unknown,
  ) {
    super(message);
  }
  get code() {
    return ({ 400: "invalid", 401: "unauthorized", 403: "forbidden", 404: "not_found", 409: "conflict" } as Record<number, string>)[this.status] ?? "error";
  }
}

/** Any error from an operation, as an OpError: validation, state machine, SvelteKit `error()`, or a bug (500). */
export function asOpError(e: unknown): OpError {
  if (e instanceof OpError) return e;
  if (e instanceof z.ZodError) return new OpError(400, e.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; "), e.issues);
  if (e instanceof InvalidTransition) return new OpError(400, e.message);
  if (isHttpError(e)) return new OpError(e.status, e.body.message);
  console.error(e);
  return new OpError(500, (e as Error)?.message ?? "internal error");
}

/** Audits a mutation as whoever made it (scope §18.7). */
export const audit = (ctx: Ctx, action: string, target?: { type: string; id: string } | null, details?: unknown) =>
  writeAudit(db(), ctx.actor, action, target ?? null, details);
