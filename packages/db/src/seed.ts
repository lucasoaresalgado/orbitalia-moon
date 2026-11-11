// Seeds a fresh database: default agents (v1 from prompts/), model prices,
// budget defaults and settings. Idempotent: existing rows are left alone.
// Run: pnpm db:seed
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { AgentVersionInput, loadConfig } from "@miniasys/core";
import { connect, and, eq, isNull, DEFAULT_ENGINES, DEFAULT_MODELS, DEFAULT_SANDBOX, SETTINGS, type Db } from "./index.ts";
import { agents, agentVersions, budgetDefaults, modelPrices, settings } from "./schema.ts";

const prompt = (name: string) => readFileSync(fileURLToPath(new URL(`../../../prompts/${name}.md`, import.meta.url)), "utf8");

const BOARD = ["update_card", "add_card_log", "comment", "request_human_input"];
const MEMORY = ["cortex_search", "cortex_read", "limbic_remember", "limbic_forget"];
const FILES = ["list_files", "read_file", "write_file", "edit_file"];

export const DEFAULT_AGENTS = [
  {
    slug: "iacy", name: "Iacy", role: "manager", description: "The manager: plans, splits work into cards, answers escalations.",
    version: { model: DEFAULT_MODELS.manager, fallback_model: DEFAULT_MODELS.worker_strong, system_prompt: prompt("iacy"),
      tools: [...["create_cards", "list_cards", "notify_user", "search_notes", "load_skill"], ...BOARD, ...MEMORY].map((name) => ({ name, requires_approval: false })),
      limits: { max_turns: 12, max_tokens: 8000, compact_at_tokens: 80_000, run_budget_usd: 1, day_budget_usd: 3 } },
  },
  {
    slug: "brief-writer", name: "Brief writer", role: "brief_writer", description: "Turns a plan into one short brief per card; writes minutes; compacts transcripts.",
    version: { model: DEFAULT_MODELS.brief_writer, fallback_model: null, system_prompt: prompt("brief-writer"), tools: [],
      limits: { max_turns: 1, max_tokens: 2000, compact_at_tokens: 60_000, run_budget_usd: 0.1 } },
  },
  {
    slug: "dev", name: "Developer", role: "worker", description: "Full-stack worker: writes code and tests in the card workspace.",
    version: { model: DEFAULT_MODELS.worker_default, fallback_model: DEFAULT_MODELS.worker_strong, system_prompt: prompt("dev"),
      tools: [...FILES, "run_in_sandbox", "git_commit", "load_skill", "search_notes", ...BOARD, ...MEMORY].map((name) => ({ name, requires_approval: false })),
      permissions: { network: "ask", github_push: true },
      limits: { max_turns: 30, max_tokens: 8000, compact_at_tokens: 60_000, run_budget_usd: 2 } },
  },
  {
    slug: "reviewer", name: "Reviewer", role: "reviewer", description: "Reviews diffs and check results with a fresh context.",
    version: { model: DEFAULT_MODELS.reviewer, fallback_model: null, system_prompt: prompt("reviewer"),
      tools: [{ name: "read_file", requires_approval: false }, { name: "list_files", requires_approval: false }],
      limits: { max_turns: 8, max_tokens: 4000, compact_at_tokens: 60_000, run_budget_usd: 0.5 } },
  },
] as const;

/**
 * Starting prices in USD per million tokens (cache write = 5-minute write).
 * Configuration, not code: edit them in Settings → Prices from Anthropic's pricing page.
 */
const PRICES = [
  { provider: "anthropic", model: "claude-opus-5-5", inputPerMtok: 4, outputPerMtok: 20, cacheWritePerMtok: 5, cacheReadPerMtok: 0.2 },
  { provider: "anthropic", model: "claude-sonnet-5-5", inputPerMtok: 2, outputPerMtok: 10, cacheWritePerMtok: 2.5, cacheReadPerMtok: 0.1 },
  { provider: "anthropic", model: "claude-haiku-5-5", inputPerMtok: 0.1, outputPerMtok: 0.5, cacheWritePerMtok: 0.125, cacheReadPerMtok: 0.01 },
  { provider: "colibri", model: "*", inputPerMtok: 0, outputPerMtok: 0, cacheWritePerMtok: 0, cacheReadPerMtok: 0 },
  { provider: "ollama", model: "*", inputPerMtok: 0, outputPerMtok: 0, cacheWritePerMtok: 0, cacheReadPerMtok: 0 },
];

const BUDGETS = [
  { scope: "global_month", limitUsd: 60, limitTokens: 60_000_000 },
  { scope: "global_day", limitUsd: 3, limitTokens: 5_000_000 },
  { scope: "card", limitUsd: 2, limitTokens: 2_000_000 },
  { scope: "meeting", limitUsd: 0.5, limitTokens: 300_000 },
  { scope: "agent_day", limitUsd: 3, limitTokens: 3_000_000 },
];

export async function seed(db: Db): Promise<void> {
  for (const a of DEFAULT_AGENTS) {
    const [existing] = await db.select().from(agents).where(eq(agents.slug, a.slug));
    if (existing) continue;
    const v = AgentVersionInput.parse({ ...a.version, change_note: "seeded" });
    await db.transaction(async (tx) => {
      const [agent] = await tx.insert(agents).values({ slug: a.slug, name: a.name, role: a.role, description: a.description }).returning();
      const [ver] = await tx.insert(agentVersions).values({
        agentId: agent!.id, version: 1, status: "deployed", model: v.model, fallbackModel: v.fallback_model, systemPrompt: v.system_prompt,
        tools: v.tools, skills: v.skills, permissions: v.permissions, limits: v.limits, changeNote: v.change_note,
      }).returning();
      await tx.update(agents).set({ activeVersionId: ver!.id }).where(eq(agents.id, agent!.id));
    });
  }
  if (!(await db.select().from(modelPrices).limit(1)).length)
    await db.insert(modelPrices).values(PRICES.map((p) => ({ ...p, effectiveFrom: "2026-01-01" })));
  await db.insert(budgetDefaults).values(BUDGETS).onConflictDoNothing();
  // databases seeded before token budgets existed
  for (const b of BUDGETS) await db.update(budgetDefaults).set({ limitTokens: b.limitTokens }).where(and(eq(budgetDefaults.scope, b.scope), isNull(budgetDefaults.limitTokens)));
  await db.insert(settings).values([
    { key: SETTINGS.models, value: DEFAULT_MODELS },
    { key: SETTINGS.sandbox, value: DEFAULT_SANDBOX },
    { key: SETTINGS.paused, value: false },
    { key: SETTINGS.engines, value: DEFAULT_ENGINES },
    { key: SETTINGS.budgetUnit, value: "usd" },
  ]).onConflictDoNothing();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const database = connect(loadConfig().databaseUrl, 1);
  seed(database.db)
    .then(() => console.log("seeded"))
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(() => database.close());
}
