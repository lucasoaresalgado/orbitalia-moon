// Every operation, by name. Adding a module here is all it takes for the HTTP
// API, the MCP server and the CLI to offer its operations.
import { z } from "zod";
import { allows, asOpError, OpError, type Ctx, type Op } from "./define.ts";
import * as agents from "./agents.ts";
import * as cards from "./cards.ts";
import * as inbox from "./inbox.ts";
import * as manager from "./manager.ts";
import * as projects from "./projects.ts";
import * as runs from "./runs.ts";
import * as settings from "./settings.ts";
import * as system from "./system.ts";
import * as tokens from "./tokens.ts";
import * as journal from "./journal.ts";
import * as docs from "./docs.ts";
import * as meetingsOps from "./meetings.ts";
import * as files from "./files.ts";
import * as variables from "./variables.ts";
import * as storage from "./storage.ts";
import * as scriptsOps from "./scripts.ts";

const MODULES = [projects, files, scriptsOps, storage, variables, cards, journal, docs, meetingsOps, manager, inbox, agents, runs, system, settings, tokens];

const isOp = (v: unknown): v is Op => !!v && typeof v === "object" && "name" in v && "run" in v && "input" in v;

export const OPS: ReadonlyMap<string, Op> = (() => {
  const m = new Map<string, Op>();
  for (const mod of MODULES)
    for (const v of Object.values(mod)) {
      if (!isOp(v)) continue;
      if (m.has(v.name)) throw new Error(`two operations are named ${v.name}`);
      m.set(v.name, v);
    }
  return m;
})();

export function getOp(name: string): Op {
  const op = OPS.get(name);
  if (!op) throw new OpError(404, `no operation ${name}`);
  return op;
}

/** Runs an operation as a caller: access check, input validation, then the handler. Errors come out as OpError. */
export async function invoke<T = unknown>(name: string, input: unknown, ctx: Ctx): Promise<T> {
  try {
    const op = getOp(name);
    if (!allows(ctx.access, op.access)) throw new OpError(403, `${name} needs ${op.access} access; this caller has ${ctx.access}`);
    const parsed = op.input.parse(input ?? {});
    return (await op.run(ctx, parsed)) as T;
  } catch (e) {
    throw asOpError(e);
  }
}

export interface OpInfo {
  name: string;
  summary: string;
  access: Op["access"];
  destructive: boolean;
  inputSchema: Record<string, unknown>;
}

/** The catalog the CLI and the MCP server are built from: names, summaries and JSON Schemas. */
export function catalog(access?: Op["access"]): OpInfo[] {
  return [...OPS.values()]
    .filter((op) => !access || allows(access, op.access))
    .map((op) => ({
      name: op.name,
      summary: op.summary,
      access: op.access,
      destructive: !!op.destructive,
      inputSchema: z.toJSONSchema(op.input, { io: "input", unrepresentable: "any" }) as Record<string, unknown>,
    }));
}
