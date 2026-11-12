// Variables (scope §26): environment variables for a project's scripts (or every
// project's: global). Secrets are sealed and never shown back by any door.
import { z } from "zod";
import { deleteVariable, listVariables, setVariable, VariableError } from "@miniasys/db";
import { database } from "../db.ts";
import { envelope } from "../storage.ts";
import { audit, defineOp, OpError } from "./define.ts";
import { projectBySlug, ProjectRef } from "./common.ts";

const Scope = z.object({ project: ProjectRef.nullable().optional().describe("project slug; omit for a global variable (every project)") });
const pid = async (slug: string | null | undefined) => (slug ? (await projectBySlug(slug)).id : null);

export const list = defineOp({
  name: "variables.list",
  summary: "A project's variables (or the global ones): names, whether each is a secret, plain values (never a secret's value), who changed it and when.",
  access: "read",
  input: Scope,
  run: async (_c, i) => listVariables(database(), await pid(i.project)),
});

export const set = defineOp({
  name: "variables.set",
  summary: "Set a variable scripts get as an environment variable: secret: true seals it (never shown again, masked as *** in every log and result). UPPER_SNAKE_CASE names.",
  access: "write",
  input: Scope.extend({ name: z.string(), value: z.string().max(100_000), secret: z.boolean().default(false), description: z.string().max(500).optional() }),
  run: async (ctx, i) => {
    try {
      await setVariable(database(), envelope(), { projectId: await pid(i.project), name: i.name, value: i.value, secret: i.secret, description: i.description ?? null, actor: ctx.actor });
    } catch (e) {
      if (e instanceof VariableError) throw new OpError(400, e.message);
      throw e;
    }
    await audit(ctx, "variable.set", { type: "variable", id: `${i.project ?? "global"}/${i.name}` }, { secret: i.secret });
    return { ok: true };
  },
});

export const remove = defineOp({
  name: "variables.delete",
  summary: "Delete a variable.",
  access: "write",
  destructive: true,
  input: Scope.extend({ name: z.string() }),
  run: async (ctx, i) => {
    if (!(await deleteVariable(database(), await pid(i.project), i.name))) throw new OpError(404, `no variable ${i.name}`);
    await audit(ctx, "variable.delete", { type: "variable", id: `${i.project ?? "global"}/${i.name}` });
    return { ok: true };
  },
});
