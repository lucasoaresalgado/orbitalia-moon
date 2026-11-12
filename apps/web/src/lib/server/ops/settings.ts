// Settings (scope §18.5): models, prices, budgets, engines, the Claude subscription,
// the sandbox and secrets. Changing them is admin; reading them is not (no secret
// value is ever returned).
import { z } from "zod";
import { Envelope, parseMasterKey } from "@miniasys/core";
import {
  budgetDefaults, modelPrices, secrets, desc, eq, getSetting, setSetting, SETTINGS, DEFAULT_MODELS, DEFAULT_SANDBOX, DEFAULT_ENGINES, CLAUDE_TOKEN_SECRET,
  type ModelSettings, type SandboxSettings, type EngineSettings,
} from "@miniasys/db";
import { db, server, sql } from "../db.ts";
import { audit, defineOp, OpError } from "./define.ts";

const NULLABLE_MODELS = ["colibri_decision_model", "local_decision_model"] as const;
const BUDGET_SCOPES = ["global_month", "global_day", "card", "meeting", "agent_day"] as const;

export const get = defineOp({
  name: "settings.get",
  summary: "All settings: models per role, engines, budget unit and defaults, prices, sandbox limits, secret names (never values), schedules and providers.",
  access: "read",
  input: z.object({}),
  run: async () => {
    const c = server().config;
    const schedules = await sql()<{ name: string; cron: string; timezone: string | null; updated_on: Date | null }[]>`SELECT name, cron, timezone, updated_on FROM pgboss.schedule ORDER BY name`.catch(() => []);
    return {
      models: await getSetting<ModelSettings>(db(), SETTINGS.models, DEFAULT_MODELS),
      engines: await getSetting<EngineSettings>(db(), SETTINGS.engines, DEFAULT_ENGINES),
      budgetUnit: await getSetting<"usd" | "tokens">(db(), SETTINGS.budgetUnit, "usd"),
      subscription: (await db().select({ lastUsedAt: secrets.lastUsedAt }).from(secrets).where(eq(secrets.name, CLAUDE_TOKEN_SECRET)))[0] ?? null,
      sandbox: await getSetting<SandboxSettings>(db(), SETTINGS.sandbox, DEFAULT_SANDBOX),
      prices: await db().select().from(modelPrices).orderBy(modelPrices.provider, modelPrices.model, desc(modelPrices.effectiveFrom)),
      budgets: await db().select().from(budgetDefaults).orderBy(budgetDefaults.scope),
      secrets: (await db().select({ name: secrets.name, allowedTools: secrets.allowedTools, lastUsedAt: secrets.lastUsedAt }).from(secrets).orderBy(secrets.name)).filter((x) => x.name !== CLAUDE_TOKEN_SECRET),
      schedules,
      providers: {
        anthropic: !!c.anthropic.apiKey,
        colibri: c.colibriUrl,
        ollama: c.ollamaUrl,
        embedding: c.embeddingModel,
        github: c.github ? { appId: c.github.appId, installationId: c.github.installationId, key: !!c.github.privateKey } : null,
        ntfy: c.ntfy ? { url: c.ntfy.url, topic: `${c.ntfy.topic.slice(0, 4)}…` } : null,
        masterKey: !!c.masterKey,
        sandboxImage: c.sandboxImage,
      },
    };
  },
});

export const models = defineOp({
  name: "settings.models",
  summary: "Set the model of each role (manager, brief_writer, worker_default, worker_strong, reviewer, security, decisions_fallback, colibri_decision_model, local_decision_model). Only the roles given change; an empty value restores the default (or turns an optional decision model off).",
  access: "admin",
  input: z.object(Object.fromEntries(Object.keys(DEFAULT_MODELS).map((k) => [k, z.string().nullable().optional()])) as Record<keyof ModelSettings, z.ZodOptional<z.ZodNullable<z.ZodString>>>),
  run: async (ctx, i) => {
    const next = { ...(await getSetting<ModelSettings>(db(), SETTINGS.models, DEFAULT_MODELS)) };
    for (const k of Object.keys(DEFAULT_MODELS) as (keyof ModelSettings)[]) {
      if (i[k] === undefined) continue;
      const v = i[k]?.trim();
      (next as Record<string, string | null>)[k] = (NULLABLE_MODELS as readonly string[]).includes(k) ? v || null : v || DEFAULT_MODELS[k];
    }
    await setSetting(db(), SETTINGS.models, next);
    await audit(ctx, "settings.models", null, next);
    return next;
  },
});

export const price = defineOp({
  name: "settings.price",
  summary: "Add a model price (dollars per million tokens), effective from a date (default today); costs use the row effective at call time.",
  access: "admin",
  input: z.object({
    provider: z.string().min(1).default("anthropic"),
    model: z.string().trim().min(1),
    input: z.number().min(0),
    output: z.number().min(0),
    cacheWrite: z.number().min(0).default(0),
    cacheRead: z.number().min(0).default(0),
    effectiveFrom: z.iso.date().optional(),
  }),
  run: async (ctx, i) => {
    const row = {
      provider: i.provider, model: i.model, inputPerMtok: i.input, outputPerMtok: i.output, cacheWritePerMtok: i.cacheWrite, cacheReadPerMtok: i.cacheRead,
      effectiveFrom: i.effectiveFrom ?? new Date().toISOString().slice(0, 10),
    };
    await db().insert(modelPrices).values(row);
    await audit(ctx, "settings.price", null, row);
    return row;
  },
});

const Limit = z.object({ usd: z.number().min(0).nullable().optional(), tokens: z.number().min(0).nullable().optional() });

export const setBudgets = defineOp({
  name: "settings.budgets",
  summary: "Set default budget limits per scope (global_month, global_day, card, meeting, agent_day) in dollars and/or usage tokens; the current global periods follow.",
  access: "admin",
  input: z.object(Object.fromEntries(BUDGET_SCOPES.map((s) => [s, Limit.optional()])) as Record<(typeof BUDGET_SCOPES)[number], z.ZodOptional<typeof Limit>>),
  run: async (ctx, i) => {
    for (const scope of BUDGET_SCOPES) {
      const limit = i[scope]?.usd ?? null;
      const tokens = i[scope]?.tokens ?? null;
      if (limit !== null) await db().insert(budgetDefaults).values({ scope, limitUsd: limit }).onConflictDoUpdate({ target: budgetDefaults.scope, set: { limitUsd: limit } });
      if (tokens !== null) {
        await db().update(budgetDefaults).set({ limitTokens: Math.round(tokens) }).where(eq(budgetDefaults.scope, scope));
        if (scope === "global_month" || scope === "global_day")
          await sql()`UPDATE budgets SET limit_tokens = ${Math.round(tokens)} WHERE scope = ${scope} AND period_start = (SELECT max(period_start) FROM budgets WHERE scope = ${scope})`;
      }
      // the current periods follow the new global limits
      if (limit !== null && (scope === "global_month" || scope === "global_day"))
        await sql()`UPDATE budgets SET limit_usd = ${limit} WHERE scope = ${scope} AND period_start = (SELECT max(period_start) FROM budgets WHERE scope = ${scope})`;
    }
    await audit(ctx, "settings.budgets", null, i);
    return { ok: true };
  },
});

export const budgetUnit = defineOp({
  name: "settings.budget_unit",
  summary: "What budgets count and block on: usd (API credits) or tokens (usage tokens, for the Claude subscription). Both are always recorded.",
  access: "admin",
  input: z.object({ unit: z.enum(["usd", "tokens"]) }),
  run: async (ctx, { unit }) => {
    await setSetting(db(), SETTINGS.budgetUnit, unit);
    await audit(ctx, "settings.budget_unit", null, { unit });
    return { unit };
  },
});

const Engine = z.enum(["api", "claude_code"]);

export const engines = defineOp({
  name: "settings.engines",
  summary: "Pick the engine of each role (manager, worker, reviewer, brief_writer): api (Messages API, per-token billing) or claude_code (the Claude subscription, in a sandbox). Only the roles given change.",
  access: "admin",
  input: z.object(Object.fromEntries(Object.keys(DEFAULT_ENGINES).map((k) => [k, Engine.optional()])) as Record<keyof EngineSettings, z.ZodOptional<typeof Engine>>),
  run: async (ctx, i) => {
    const next = { ...(await getSetting<EngineSettings>(db(), SETTINGS.engines, DEFAULT_ENGINES)) };
    for (const k of Object.keys(DEFAULT_ENGINES) as (keyof EngineSettings)[]) if (i[k]) next[k] = i[k];
    await setSetting(db(), SETTINGS.engines, next);
    await audit(ctx, "settings.engines", null, next);
    return next;
  },
});

export const claudeConnect = defineOp({
  name: "settings.claude_connect",
  summary: "Connect the Claude subscription with a token from `claude setup-token` (stored encrypted, never shown again).",
  access: "admin",
  input: z.object({ token: z.string().trim().regex(/^sk-ant-[\w-]{30,}$/, "a token from `claude setup-token` (it starts with sk-ant-)") }),
  run: async (ctx, { token }) => {
    const envelope = new Envelope(parseMasterKey(server().config.masterKey ?? undefined));
    if (!envelope.ready) throw new OpError(400, "set MASTER_KEY_FILE first: the token is encrypted with it");
    const ciphertext = envelope.seal(token);
    await db().insert(secrets).values({ name: CLAUDE_TOKEN_SECRET, ciphertext, allowedTools: ["claude_code"] }).onConflictDoUpdate({ target: secrets.name, set: { ciphertext, allowedTools: ["claude_code"], lastUsedAt: null } });
    await audit(ctx, "subscription.connect");
    return { ok: true };
  },
});

export const claudeDisconnect = defineOp({
  name: "settings.claude_disconnect",
  summary: "Disconnect the Claude subscription: the token is deleted and every role goes back to the API engine.",
  access: "admin",
  destructive: true,
  input: z.object({}),
  run: async (ctx) => {
    await db().delete(secrets).where(eq(secrets.name, CLAUDE_TOKEN_SECRET));
    await setSetting(db(), SETTINGS.engines, DEFAULT_ENGINES);
    await audit(ctx, "subscription.disconnect");
    return { ok: true };
  },
});

export const sandbox = defineOp({
  name: "settings.sandbox",
  summary: "Sandbox limits: cpus (0.25–2), memMb (256–2048), maxConcurrent (1–4), timeoutS (10–1800), networkAllowlist (hosts). Only the fields given change.",
  access: "admin",
  input: z.object({
    cpus: z.number().min(0.25).max(2).optional(),
    memMb: z.number().int().min(256).max(2048).optional(),
    maxConcurrent: z.number().int().min(1).max(4).optional(),
    timeoutS: z.number().int().min(10).max(1800).optional(),
    networkAllowlist: z.array(z.string().trim().min(1)).optional(),
  }),
  run: async (ctx, i) => {
    const cur = await getSetting<SandboxSettings>(db(), SETTINGS.sandbox, DEFAULT_SANDBOX);
    const next: SandboxSettings = { ...cur, ...Object.fromEntries(Object.entries(i).filter(([, v]) => v !== undefined)) };
    await setSetting(db(), SETTINGS.sandbox, next);
    await audit(ctx, "settings.sandbox", null, next);
    return next;
  },
});

export const secretSet = defineOp({
  name: "secrets.set",
  summary: "Store a secret (encrypted; write-only: no door ever reads a value back), with the tools allowed to decrypt it.",
  access: "admin",
  input: z.object({ name: z.string().regex(/^[A-Z][A-Z0-9_]{1,63}$/, "secret names are UPPER_SNAKE_CASE"), value: z.string(), tools: z.array(z.string().trim().min(1)).default([]) }),
  run: async (ctx, i) => {
    if (i.name === CLAUDE_TOKEN_SECRET) throw new OpError(400, "use settings.claude_connect for the subscription token");
    const envelope = new Envelope(parseMasterKey(server().config.masterKey ?? undefined));
    if (!envelope.ready) throw new OpError(400, "set MASTER_KEY_FILE first: secrets are encrypted with it");
    const ciphertext = envelope.seal(i.value);
    await db().insert(secrets).values({ name: i.name, ciphertext, allowedTools: i.tools }).onConflictDoUpdate({ target: secrets.name, set: { ciphertext, allowedTools: i.tools } });
    await audit(ctx, "secret.set", { type: "secret", id: i.name }, { allowedTools: i.tools });
    return { ok: true };
  },
});

export const secretDelete = defineOp({
  name: "secrets.delete",
  summary: "Delete a secret.",
  access: "admin",
  destructive: true,
  input: z.object({ name: z.string().min(1) }),
  run: async (ctx, { name }) => {
    await db().delete(secrets).where(eq(secrets.name, name));
    await audit(ctx, "secret.delete", { type: "secret", id: name });
    return { ok: true };
  },
});
