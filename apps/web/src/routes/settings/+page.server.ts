// Settings (scope §18.5): models, prices, budgets, connections, secrets,
// sandbox, schedules, API tokens. Every change is an audited operation.
import { DEFAULT_ENGINES, DEFAULT_MODELS } from "@miniasys/db";
import { env } from "node:process";
import { act, call } from "#lib/server/ops/web.ts";
import type { OpOutput } from "#lib/server/ops/types.ts";

export const load = async ({ locals }) => ({
  ...(await call<OpOutput<"settings.get">>(locals, "settings.get")),
  tokens: await call<OpOutput<"tokens.list">>(locals, "tokens.list"),
  variables: await call<OpOutput<"variables.list">>(locals, "variables.list", {}),
  publicUrl: env.PUBLIC_URL ?? env.ORIGIN ?? "http://127.0.0.1:3000",
  agentSlugs: (await call<OpOutput<"agents.list">>(locals, "agents.list")).map((a) => a.slug),
});

/** a number field: a missing or empty field leaves the value as it is (Number("") would be 0) */
const num = (v: FormDataEntryValue | null, min = 0) => {
  if (v === null || String(v).trim() === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) && n >= min ? n : undefined;
};
const said = (ok: string) => <T>(r: { ok: true; data: T } | object) => ("ok" in r && r.ok === true ? { ok } : r);

export const actions = {
  models: async ({ request, locals }) => {
    const f = Object.fromEntries(await request.formData()) as Record<string, string>;
    // the form sends every role: an empty one restores its default
    const input = Object.fromEntries(Object.keys(DEFAULT_MODELS).map((k) => [k, f[k] ?? ""]));
    return said("models")(await act(locals, "settings.models", input));
  },
  price: async ({ request, locals }) => {
    const f = await request.formData();
    const input = {
      provider: String(f.get("provider") || "anthropic"), model: String(f.get("model") ?? "").trim(),
      input: num(f.get("input")), output: num(f.get("output")), cacheWrite: num(f.get("cacheWrite")) ?? 0, cacheRead: num(f.get("cacheRead")) ?? 0,
      ...(f.get("effectiveFrom") ? { effectiveFrom: String(f.get("effectiveFrom")) } : {}),
    };
    return said("prices")(await act(locals, "settings.price", input));
  },
  budgets: async ({ request, locals }) => {
    const f = await request.formData();
    const input = Object.fromEntries(["global_month", "global_day", "card", "meeting", "agent_day"].map((s) => [s, { usd: num(f.get(s)) ?? null, tokens: num(f.get(`${s}_tokens`)) ?? null }]));
    return said("budgets")(await act(locals, "settings.budgets", input));
  },
  engines: async ({ request, locals }) => {
    const f = await request.formData();
    const input = Object.fromEntries(Object.keys(DEFAULT_ENGINES).map((k) => [k, f.get(k) === "claude_code" ? "claude_code" : "api"]));
    return said("engines")(await act(locals, "settings.engines", input));
  },
  /** The token from `claude setup-token`: stored encrypted, never shown again, read only by the Claude Code engine. */
  claudeToken: async ({ request, locals }) =>
    said("Claude subscription")(await act(locals, "settings.claude_connect", { token: String((await request.formData()).get("token") ?? "") })),
  claudeDisconnect: async ({ locals }) => said("Claude subscription (disconnected; every role is back on the API)")(await act(locals, "settings.claude_disconnect")),
  sandbox: async ({ request, locals }) => {
    const f = await request.formData();
    const input = {
      cpus: Math.min(2, num(f.get("cpus"), 0.25) ?? 1), memMb: Math.min(2048, num(f.get("memMb"), 256) ?? 1024),
      maxConcurrent: Math.min(4, num(f.get("maxConcurrent"), 1) ?? 2), timeoutS: Math.min(1800, num(f.get("timeoutS"), 10) ?? 300),
      networkAllowlist: String(f.get("allowlist") ?? "").split("\n").map((s) => s.trim()).filter(Boolean),
    };
    return said("sandbox")(await act(locals, "settings.sandbox", input));
  },
  /** Secrets are write-only: the UI never reads a value back (scope §13). */
  secret: async ({ request, locals }) => {
    const f = await request.formData();
    const input = { name: String(f.get("name") ?? "").trim(), value: String(f.get("value") ?? ""), tools: String(f.get("tools") ?? "").split(",").map((s) => s.trim()).filter(Boolean) };
    return said("secrets")(await act(locals, "secrets.set", input));
  },
  deleteSecret: async ({ request, locals }) => said("secrets")(await act(locals, "secrets.delete", { name: String((await request.formData()).get("name")) })),
  /** API tokens for harnesses, the CLI and the MCP server: the token is shown once, here. */
  createToken: async ({ request, locals }) => {
    const f = await request.formData();
    const r = await act<OpOutput<"tokens.create">>(locals, "tokens.create", { name: String(f.get("name") ?? "").trim(), access: String(f.get("access") || "write"), ...(f.get("agent") ? { agent: String(f.get("agent")) } : {}) });
    return "ok" in r ? { ok: "API tokens", token: r.data.token, tokenName: r.data.name } : r;
  },
  revokeToken: async ({ request, locals }) => said("API tokens")(await act(locals, "tokens.revoke", { name: String((await request.formData()).get("name")) })),
};
