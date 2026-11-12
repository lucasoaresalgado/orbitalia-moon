// API tokens for harnesses, the CLI and the MCP server. The token itself is shown
// once, when it's created.
import { z } from "zod";
import { apiTokens, agents, desc, eq } from "@miniasys/db";
import { db } from "../db.ts";
import { newToken } from "../tokens.ts";
import { ACCESS, audit, defineOp, OpError } from "./define.ts";
import { agentRow, AgentRef } from "./common.ts";

export const create = defineOp({
  name: "tokens.create",
  summary: "Create an API token (shown once). With agent, everything done with it is attributed to that agent (agent:<slug>); otherwise to user:<name>. access: read, write or admin.",
  access: "admin",
  input: z.object({
    name: z.string().regex(/^[a-z0-9][a-z0-9_.-]{1,40}$/, "lowercase letters, digits, dots, dashes and underscores"),
    access: z.enum(ACCESS).default("write"),
    agent: AgentRef.optional().describe("the agent this token acts as"),
  }),
  run: async (ctx, i) => {
    // an agent's token is never admin: it can't mint tokens or change settings
    if (i.agent && i.access === "admin") throw new OpError(400, "a token that acts as an agent can be read or write, not admin");
    const agent = i.agent ? await agentRow(i.agent) : null;
    const t = newToken();
    const [row] = await db().insert(apiTokens).values({ name: i.name, tokenHash: t.hash, prefix: t.prefix, access: i.access, agentId: agent?.id ?? null }).onConflictDoNothing().returning({ id: apiTokens.id });
    if (!row) throw new OpError(409, `a token named ${i.name} already exists`);
    await audit(ctx, "token.create", { type: "token", id: i.name }, { access: i.access, agent: agent?.slug ?? null });
    return { id: row.id, name: i.name, access: i.access, agent: agent?.slug ?? null, token: t.token };
  },
});

export const list = defineOp({
  name: "tokens.list",
  summary: "List API tokens (never the token itself): name, prefix, access, agent, last use, revoked.",
  access: "admin",
  input: z.object({}),
  run: async () =>
    db()
      .select({ id: apiTokens.id, name: apiTokens.name, prefix: apiTokens.prefix, access: apiTokens.access, agent: agents.slug, createdAt: apiTokens.createdAt, lastUsedAt: apiTokens.lastUsedAt, revokedAt: apiTokens.revokedAt })
      .from(apiTokens)
      .leftJoin(agents, eq(agents.id, apiTokens.agentId))
      .orderBy(desc(apiTokens.createdAt)),
});

export const revoke = defineOp({
  name: "tokens.revoke",
  summary: "Revoke an API token by name: it stops working at once.",
  access: "admin",
  destructive: true,
  input: z.object({ name: z.string().min(1) }),
  run: async (ctx, { name }) => {
    const r = await db().update(apiTokens).set({ revokedAt: new Date() }).where(eq(apiTokens.name, name)).returning({ id: apiTokens.id });
    if (!r.length) throw new OpError(404, `no token named ${name}`);
    await audit(ctx, "token.revoke", { type: "token", id: name });
    return { ok: true };
  },
});
