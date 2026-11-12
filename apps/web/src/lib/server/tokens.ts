// API tokens (scope §6): `msy_` + 32 random bytes. The database keeps only the
// SHA-256, like sessions, so a dump holds no live token.
import { createHash, randomBytes } from "node:crypto";
import { agents, apiTokens, and, eq, isNull } from "@miniasys/db";
import { db, sql } from "./db.ts";
import type { Access, Ctx } from "./ops/define.ts";

export const TOKEN_PREFIX = "msy_";
export const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

export function newToken() {
  const token = TOKEN_PREFIX + randomBytes(32).toString("base64url");
  return { token, hash: hashToken(token), prefix: token.slice(0, 10) };
}

/** The caller a bearer token stands for, or null when it's unknown or revoked. */
export async function tokenCaller(token: string): Promise<Ctx | null> {
  if (!token.startsWith(TOKEN_PREFIX)) return null;
  const [row] = await db()
    .select({ id: apiTokens.id, name: apiTokens.name, access: apiTokens.access, agentId: agents.id, agentSlug: agents.slug })
    .from(apiTokens)
    .leftJoin(agents, eq(agents.id, apiTokens.agentId))
    .where(and(eq(apiTokens.tokenHash, hashToken(token)), isNull(apiTokens.revokedAt)));
  if (!row) return null;
  // last use, at most once a minute, off the request's path
  void sql()`UPDATE api_tokens SET last_used_at = now() WHERE id = ${row.id} AND (last_used_at IS NULL OR last_used_at < now() - interval '1 minute')`.catch(() => {});
  const agent = row.agentId && row.agentSlug ? { id: row.agentId, slug: row.agentSlug } : null;
  return { actor: agent ? `agent:${agent.slug}` : `user:${row.name}`, access: row.access as Access, agent };
}

/**
 * A caller acting as an agent for one request (X-Orbitalia Moon-Agent): only a token
 * not already bound to an agent may. Like an agent's own token, it is never admin.
 */
export async function actAs(ctx: Ctx, slug: string): Promise<Ctx | string> {
  if (ctx.agent) return `this token already acts as a/${ctx.agent.slug}`;
  const [a] = await db().select({ id: agents.id, slug: agents.slug }).from(agents).where(eq(agents.slug, slug));
  if (!a) return `no agent a/${slug}`;
  return { ...ctx, actor: `agent:${a.slug}`, agent: a, access: ctx.access === "admin" ? "write" : ctx.access };
}
