// The worker: queue consumer, agent loop, schedules (scope §5 Processes).
// Never exposes HTTP; the web app talks to it through Postgres (runs rows,
// pg-boss jobs, NOTIFY).
import { execFile } from "node:child_process";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { PgBoss } from "pg-boss";
import pino from "pino";
import Anthropic from "@anthropic-ai/sdk";
import { Envelope, loadConfig, parseMasterKey, PG_CHANNEL, type BusEvent } from "@miniasys/core";
import { cards, connect, managerMessages, runs, eq, and, or, lte, getSetting, setSetting, SETTINGS, DEFAULT_MODELS, DEFAULT_SANDBOX, type ModelSettings, type SandboxSettings } from "@miniasys/db";
import { runMigrations } from "@miniasys/db/migrate";
import { seed } from "@miniasys/db/seed";
import { ClaudeDecisionEngine, ColibriEngine, Decider, OllamaEmbeddings } from "@miniasys/llm";
import { SandboxRunner } from "@miniasys/sandbox";
import { defaultRegistry } from "@miniasys/tools";
import { systemBlocks } from "./agent/context.ts";
import { Budgets } from "./budgets.ts";
import { Executor } from "./executor.ts";
import { GitHub } from "./github.ts";
import { Journal } from "./journal.ts";
import { embedNote } from "./knowledge.ts";
import { singleCall } from "./engine.ts";
import { Models } from "./models.ts";
import { Notifier } from "./notifier.ts";
import { Pipeline } from "./pipeline.ts";
import { QUEUES, type Services } from "./services.ts";
import { CardDeleted } from "./errors.ts";
import { buildIndex, cortexFile } from "@miniasys/cortex";
import { Workspaces } from "./workspaces.ts";

const config = loadConfig();
for (const dir of [config.workspacesDir, config.logDir]) mkdirSync(dir, { recursive: true });
const log = pino(
  { level: process.env.LOG_LEVEL ?? "info", base: { proc: "worker" } },
  pino.multistream([{ stream: process.stdout }, { stream: pino.destination({ dest: `${config.logDir}/worker.log`, mkdir: true, sync: false }) }]),
);

const d = connect(config.databaseUrl, 10);
await runMigrations(d);
await seed(d.db);

const boss = new PgBoss({ connectionString: config.databaseUrl, schema: "pgboss" });
boss.on("error", (e) => log.error({ err: e.message }, "pg-boss"));
await boss.start();

const models = new Models(config.anthropic);
const anthropic = config.anthropic.apiKey ? new Anthropic({ apiKey: config.anthropic.apiKey, ...(config.anthropic.baseURL ? { baseURL: config.anthropic.baseURL } : {}) }) : null;
const modelSettings = await getSetting<ModelSettings>(d.db, SETTINGS.models, DEFAULT_MODELS);
const sandboxSettings = await getSetting<SandboxSettings>(d.db, SETTINGS.sandbox, DEFAULT_SANDBOX);
const decider = new Decider(
  modelSettings.colibri_decision_model ? new ColibriEngine(config.colibriUrl, modelSettings.colibri_decision_model) : null,
  anthropic ? new ClaudeDecisionEngine(anthropic, modelSettings.decisions_fallback) : null,
);
const publicUrl = process.env.PUBLIC_URL ?? "http://127.0.0.1:3000";
const notifier = new Notifier(d, config.ntfy, publicUrl, log);
const github = config.github?.privateKey && config.github.installationId ? new GitHub({ appId: config.github.appId, privateKey: config.github.privateKey, installationId: config.github.installationId }) : null;
const envelope = new Envelope(parseMasterKey(config.masterKey ?? undefined));

const s: Services = {
  config, d, log, boss, models, decider, notifier, github, envelope,
  sandbox: new SandboxRunner(config.podmanSocket, sandboxSettings.maxConcurrent, config.logDir, config.containerRuntime),
  budgets: new Budgets(d, config.timeZone, notifier),
  journal: new Journal(d),
  registry: defaultRegistry(),
  embeddings: new OllamaEmbeddings(config.ollamaUrl, config.embeddingModel),
};
const sandboxHealth = await s.sandbox!.health();
if (!sandboxHealth.ok) {
  log.warn({ err: sandboxHealth.error, runtime: config.containerRuntime }, "container socket unreachable: sandboxes are off until it is up");
}

const ws = new Workspaces(config.workspacesDir, github ? () => github.gitToken() : null);
const pipeline = new Pipeline(s, ws);
const executor = new Executor(s, ws, (run, status) => pipeline.onRunFinished(run, status));

// ------------------------------------------------------------------ queues

const queue = async <T extends object>(name: string, handler: (data: T) => Promise<void>, opts: { retryLimit?: number } = {}) => {
  await boss.createQueue(name, { retryLimit: opts.retryLimit ?? 3, retryDelay: 30, retryBackoff: true });
  await boss.work<T>(name, async (jobs) => {
    for (const job of jobs) {
      try {
        await handler(job.data);
      } catch (e) {
        if (e instanceof CardDeleted) {
          log.info({ queue: name, job: job.id }, "card deleted: step skipped");
          continue;
        }
        log.error({ queue: name, job: job.id, err: (e as Error).message }, "job failed");
        throw e;
      }
    }
  });
};

await queue<{ planId: string }>(QUEUES.planApproved, (j) => pipeline.planApproved(j.planId));
await queue<{ cardId: string }>(QUEUES.cardBrief, (j) => pipeline.brief(j.cardId));
await queue<{ cardId: string }>(QUEUES.cardRoute, (j) => pipeline.route(j.cardId));
await queue<{ cardId: string; runId: string }>(QUEUES.cardChecks, (j) => pipeline.checks(j.cardId, j.runId));
await queue<{ cardId: string; checks: string }>(QUEUES.cardReview, (j) => pipeline.review(j.cardId, j.checks));
await queue<{ cardId: string; review: string }>(QUEUES.cardPr, (j) => pipeline.openPr(j.cardId, j.review));
await queue<{ noteId: string }>(QUEUES.notesEmbed, (j) => embedNote(s, j.noteId), { retryLimit: 10 });
await queue(QUEUES.prsPoll, () => pipeline.pollPrs(), { retryLimit: 0 });
await queue(QUEUES.dailyReport, () => dailyReport(), { retryLimit: 1 });
await queue(QUEUES.sweep, () => sweep(), { retryLimit: 0 });
await queue(QUEUES.backup, () => backup(), { retryLimit: 2 });
await queue<{ cardId: string }>(QUEUES.cardNote, (j) => pipeline.note(j.cardId));
await queue<{ agentSlug: string; sources: string[] }>(QUEUES.cortexBuild, async (j) => {
  // the agent's map of the storage: every markdown and parquet file under its sources, embedded when Ollama answers
  const r = await buildIndex({ file: cortexFile(config.cortexDir, j.agentSlug), root: config.lakehouseDir, sources: j.sources, embed: (t) => s.embeddings.embed(t) });
  await notifier.notify({ level: "info", title: `Cortex of a/${j.agentSlug} rebuilt: ${r.entries} files${r.embedded ? ", with embeddings" : " (no embeddings: Ollama unavailable, search uses keywords)"}`, link: `/agents/${j.agentSlug}?tab=cortex` });
}, { retryLimit: 1 });

// "at next wake" comes for free: pg-boss runs a missed schedule when the worker is back
const tz = config.timeZone;
await boss.schedule(QUEUES.prsPoll, "*/4 * * * *", null, { tz });
await boss.schedule(QUEUES.sweep, "*/5 * * * *", null, { tz });
await boss.schedule(QUEUES.dailyReport, "0 8 * * *", null, { tz });
await boss.schedule(QUEUES.backup, "0 2 * * *", null, { tz });

async function dailyReport() {
  const [iacy] = await d.sql<{ id: string; model: string; system_prompt: string }[]>`
    SELECT a.id, v.model, v.system_prompt FROM agents a JOIN agent_versions v ON v.id = a.active_version_id WHERE a.slug = 'iacy'`;
  if (!iacy) return;
  const system = await systemBlocks(s, { prompt: iacy.system_prompt, tools: [], role: "manager", project: null, card: null });
  const [run] = await d.db.insert(runs).values({ kind: "report", status: "running", model: iacy.model, startedAt: new Date() }).returning();
  const { text } = await singleCall(s, {
    role: "manager", runId: run!.id, scope: { agentId: iacy.id }, model: iacy.model, system, effort: "low", maxOutputTokens: 1200,
    prompt: "Write today's daily report for Lucas: what moved since yesterday, what is blocked and why, spend against budget, PRs waiting for his merge. Ten lines at most.",
  });
  await d.db.update(runs).set({ status: "succeeded", finishedAt: new Date(), summary: text.slice(0, 500) }).where(eq(runs.id, run!.id));
  await d.db.insert(managerMessages).values({ projectId: null, role: "assistant", content: { text: `**Daily report**\n\n${text}` }, model: iacy.model });
  await notifier.notify({ level: "info", title: "Daily report", body: text.slice(0, 3000), link: "/manager", ntfy: "low" });
}

async function sweep() {
  const settings = await getSetting<SandboxSettings>(d.db, SETTINGS.sandbox, DEFAULT_SANDBOX);
  if (s.sandbox) {
    s.sandbox.maxConcurrent = settings.maxConcurrent;
    const n = await s.sandbox.sweep(settings.timeoutS + 120).catch(() => 0);
    if (n) log.info({ removed: n }, "sandbox sweep");
  }
  const weekAgo = new Date(Date.now() - 7 * 86_400_000);
  const old = await d.db.select({ id: cards.id }).from(cards).where(or(and(eq(cards.status, "done"), lte(cards.updatedAt, weekAgo)), lte(cards.deletedAt, weekAgo)));
  for (const c of old) await ws.remove(c.id);
}

async function backup() {
  const script = fileURLToPath(new URL("../../../scripts/backup.sh", import.meta.url));
  const { stdout } = await promisify(execFile)(script, [], { env: { ...process.env, BACKUP_DIR: config.backupDir, DATABASE_URL: config.databaseUrl }, timeout: 30 * 60_000 });
  log.info({ out: stdout.slice(-500) }, "backup done");
  await setSetting(d.db, "last_backup", { at: new Date().toISOString(), ok: true });
}

// ------------------------------------------------------------------ live wake-ups from the web app

await d.sql.listen(PG_CHANNEL, (payload) => {
  try {
    const ev = JSON.parse(payload) as BusEvent;
    if (ev.topic !== "runs") return;
    if (ev.type === "queued") void executor.recover();
    if (ev.type === "cancel") executor.cancel((ev.data as { id: string }).id);
    if (ev.type === "pause") for (const id of executor.active) executor.cancel(id);
  } catch {
    /* not ours */
  }
});

executor.watch();
const n = await executor.recover();
log.info({ resumed: n, sandbox: sandboxHealth.ok, github: !!github, anthropic: models.configured }, "worker ready");

const shutdown = async () => {
  log.info("stopping");
  await executor.stop();
  await boss.stop({ graceful: true, timeout: 10_000 }).catch(() => {});
  await d.close();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
