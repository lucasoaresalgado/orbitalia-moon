// Variables (scope §26): what a project's scripts get as environment variables.
// A project's own variables override global ones of the same name. Secrets are
// sealed with the master key; only the worker opens them, to start a run.
import type { Envelope } from "@miniasys/core";
import { and, eq, isNull, or } from "drizzle-orm";
import type { Database } from "./index.ts";
import { variables } from "./schema.ts";

export const VARIABLE_NAME = /^[A-Z][A-Z0-9_]{0,63}$/;
/** names the platform sets in a run; a variable can't take them */
export const RESERVED_VARIABLES = /^(MINIASYS_|PATH$|HOME$|PYTHONPATH$|NODE_PATH$|LD_)/;

export class VariableError extends Error {}

export async function setVariable(
  d: Database,
  envelope: Envelope,
  v: { projectId: string | null; name: string; value: string; secret: boolean; description?: string | null; actor: string },
) {
  if (!VARIABLE_NAME.test(v.name)) throw new VariableError("variable names are UPPER_SNAKE_CASE");
  if (RESERVED_VARIABLES.test(v.name)) throw new VariableError(`${v.name} is set by the platform`);
  if (v.secret && !envelope.ready) throw new VariableError("set MASTER_KEY_FILE first: secrets are sealed with it");
  const row = {
    projectId: v.projectId, name: v.name, isSecret: v.secret,
    value: v.secret ? null : v.value, ciphertext: v.secret ? envelope.seal(v.value) : null,
    description: v.description ?? null, updatedBy: v.actor, updatedAt: new Date(),
  };
  await d.db.insert(variables).values(row).onConflictDoUpdate({ target: [variables.projectId, variables.name], set: row });
}

/** Names, kinds and plain values; a secret's value never leaves here. */
export async function listVariables(d: Database, projectId: string | null) {
  const rows = await d.db.select().from(variables).where(projectId ? eq(variables.projectId, projectId) : isNull(variables.projectId)).orderBy(variables.name);
  return rows.map((r) => ({ name: r.name, secret: r.isSecret, value: r.isSecret ? null : r.value, description: r.description, updatedBy: r.updatedBy, updatedAt: r.updatedAt, scope: r.projectId ? ("project" as const) : ("global" as const) }));
}

export async function deleteVariable(d: Database, projectId: string | null, name: string) {
  const r = await d.db.delete(variables).where(and(projectId ? eq(variables.projectId, projectId) : isNull(variables.projectId), eq(variables.name, name))).returning({ id: variables.id });
  return r.length > 0;
}

/** A run's environment: global, then the project's variables (secrets opened), and the secret values to mask. */
export async function resolveVariables(d: Database, envelope: Envelope, projectId: string): Promise<{ env: Record<string, string>; secrets: string[] }> {
  const rows = await d.db.select().from(variables).where(or(isNull(variables.projectId), eq(variables.projectId, projectId)));
  const env: Record<string, string> = {};
  const secrets: string[] = [];
  for (const r of [...rows.filter((x) => !x.projectId), ...rows.filter((x) => x.projectId)]) {
    if (r.isSecret) {
      if (!r.ciphertext) continue;
      const v = envelope.open(r.ciphertext);
      env[r.name] = v;
      secrets.push(v);
    } else env[r.name] = r.value ?? "";
  }
  return { env, secrets };
}
