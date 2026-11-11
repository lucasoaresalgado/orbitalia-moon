// Settings (scope §18.5): models, prices, budgets, connections, secrets,
// sandbox, schedules. Every change is audited.
import { fail } from "@sveltejs/kit";
import { Envelope, parseMasterKey } from "@miniasys/core";
import {
  budgetDefaults, modelPrices, secrets, desc, eq, getSetting, setSetting, SETTINGS, DEFAULT_MODELS, DEFAULT_SANDBOX, DEFAULT_ENGINES, CLAUDE_TOKEN_SECRET,
  type ModelSettings, type SandboxSettings, type EngineSettings,
} from "@miniasys/db";
import { db, server, sql } from "#lib/server/db.ts";
import { userAudit } from "#lib/server/audit.ts";

export const load = async () => {
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
};

const num = (v: FormDataEntryValue | null, min = 0) => {
  // a missing or empty field leaves the value as it is (Number(null) and Number("") are 0)
  if (v === null || String(v).trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= min ? n : null;
};

export const actions = {
  models: async ({ request }) => {
    const f = Object.fromEntries(await request.formData()) as Record<string, string>;
    const next = { ...DEFAULT_MODELS };
    for (const k of Object.keys(DEFAULT_MODELS) as (keyof ModelSettings)[]) {
      const v = f[k]?.trim();
      (next as Record<string, string | null>)[k] = k === "colibri_decision_model" ? v || null : v || DEFAULT_MODELS[k];
    }
    await setSetting(db(), SETTINGS.models, next);
    await userAudit("settings.models", null, next);
    return { ok: "models" };
  },
  price: async ({ request }) => {
    const f = await request.formData();
    const row = {
      provider: String(f.get("provider") || "anthropic"), model: String(f.get("model") ?? "").trim(),
      inputPerMtok: num(f.get("input")), outputPerMtok: num(f.get("output")), cacheWritePerMtok: num(f.get("cacheWrite")), cacheReadPerMtok: num(f.get("cacheRead")),
      effectiveFrom: String(f.get("effectiveFrom") || new Date().toISOString().slice(0, 10)),
    };
    if (!row.model || row.inputPerMtok === null || row.outputPerMtok === null) return fail(400, { error: "model, input and output prices are required" });
    await db().insert(modelPrices).values({ ...row, inputPerMtok: row.inputPerMtok, outputPerMtok: row.outputPerMtok, cacheWritePerMtok: row.cacheWritePerMtok ?? 0, cacheReadPerMtok: row.cacheReadPerMtok ?? 0 });
    await userAudit("settings.price", null, row);
    return { ok: "prices" };
  },
  budgets: async ({ request }) => {
    const f = await request.formData();
    for (const scope of ["global_month", "global_day", "card", "meeting", "agent_day"]) {
      const limit = num(f.get(scope));
      const tokens = num(f.get(`${scope}_tokens`));
      if (limit !== null) await db().insert(budgetDefaults).values({ scope, limitUsd: limit }).onConflictDoUpdate({ target: budgetDefaults.scope, set: { limitUsd: limit } });
      if (tokens !== null) {
        await db().update(budgetDefaults).set({ limitTokens: Math.round(tokens) }).where(eq(budgetDefaults.scope, scope));
        if (scope === "global_month" || scope === "global_day")
          await sql()`UPDATE budgets SET limit_tokens = ${Math.round(tokens)} WHERE scope = ${scope} AND period_start = (SELECT max(period_start) FROM budgets WHERE scope = ${scope})`;
      }
    }
    // the current periods follow the new global limits
    for (const scope of ["global_month", "global_day"]) {
      const limit = num(f.get(scope));
      if (limit !== null) await sql()`UPDATE budgets SET limit_usd = ${limit} WHERE scope = ${scope} AND period_start = (SELECT max(period_start) FROM budgets WHERE scope = ${scope})`;
    }
    await userAudit("settings.budgets", null, Object.fromEntries(f));
    return { ok: "budgets" };
  },
  engines: async ({ request }) => {
    const f = await request.formData();
    const next = { ...DEFAULT_ENGINES };
    for (const k of Object.keys(DEFAULT_ENGINES) as (keyof EngineSettings)[]) next[k] = f.get(k) === "claude_code" ? "claude_code" : "api";
    await setSetting(db(), SETTINGS.engines, next);
    await userAudit("settings.engines", null, next);
    return { ok: "engines" };
  },
  /** The token from `claude setup-token`: stored encrypted, never shown again, read only by the Claude Code engine. */
  claudeToken: async ({ request }) => {
    const token = String((await request.formData()).get("token") ?? "").trim();
    if (!/^sk-ant-[\w-]{30,}$/.test(token)) return fail(400, { error: "That doesn't look like a token from `claude setup-token` (it starts with sk-ant-)." });
    const envelope = new Envelope(parseMasterKey(server().config.masterKey ?? undefined));
    if (!envelope.ready) return fail(400, { error: "set MASTER_KEY_FILE first: the token is encrypted with it" });
    const ciphertext = envelope.seal(token);
    await db().insert(secrets).values({ name: CLAUDE_TOKEN_SECRET, ciphertext, allowedTools: ["claude_code"] }).onConflictDoUpdate({ target: secrets.name, set: { ciphertext, allowedTools: ["claude_code"], lastUsedAt: null } });
    await userAudit("subscription.connect");
    return { ok: "Claude subscription" };
  },
  claudeDisconnect: async () => {
    await db().delete(secrets).where(eq(secrets.name, CLAUDE_TOKEN_SECRET));
    await setSetting(db(), SETTINGS.engines, DEFAULT_ENGINES);
    await userAudit("subscription.disconnect");
    return { ok: "Claude subscription (disconnected; every role is back on the API)" };
  },
  sandbox: async ({ request }) => {
    const f = await request.formData();
    const next: SandboxSettings = {
      cpus: Math.min(2, num(f.get("cpus"), 0.25) ?? 1), memMb: Math.min(2048, num(f.get("memMb"), 256) ?? 1024),
      maxConcurrent: Math.min(4, num(f.get("maxConcurrent"), 1) ?? 2), timeoutS: Math.min(1800, num(f.get("timeoutS"), 10) ?? 300),
      networkAllowlist: String(f.get("allowlist") ?? "").split("\n").map((s) => s.trim()).filter(Boolean),
    };
    await setSetting(db(), SETTINGS.sandbox, next);
    await userAudit("settings.sandbox", null, next);
    return { ok: "sandbox" };
  },
  /** Secrets are write-only: the UI never reads a value back (scope §13). */
  secret: async ({ request }) => {
    const f = await request.formData();
    const name = String(f.get("name") ?? "").trim();
    const value = String(f.get("value") ?? "");
    if (!/^[A-Z][A-Z0-9_]{1,63}$/.test(name)) return fail(400, { error: "secret names are UPPER_SNAKE_CASE" });
    const envelope = new Envelope(parseMasterKey(server().config.masterKey ?? undefined));
    if (!envelope.ready) return fail(400, { error: "set MASTER_KEY_FILE first: secrets are encrypted with it" });
    const allowedTools = String(f.get("tools") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    const ciphertext = envelope.seal(value);
    await db().insert(secrets).values({ name, ciphertext, allowedTools }).onConflictDoUpdate({ target: secrets.name, set: { ciphertext, allowedTools } });
    await userAudit("secret.set", { type: "secret", id: name }, { allowedTools });
    return { ok: "secrets" };
  },
  deleteSecret: async ({ request }) => {
    const name = String((await request.formData()).get("name"));
    await db().delete(secrets).where(eq(secrets.name, name));
    await userAudit("secret.delete", { type: "secret", id: name });
    return { ok: "secrets" };
  },
};
