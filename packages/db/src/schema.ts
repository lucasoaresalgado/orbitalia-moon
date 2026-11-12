// The Drizzle schema: the source of truth for the tables in scope §7.
// pg-boss keeps its own schema (pgboss).
import { sql } from "drizzle-orm";
import {
  bigint, bigserial, boolean, customType, date, index, integer, jsonb, numeric, pgTable, serial, text, timestamp, unique, uniqueIndex, uuid,
} from "drizzle-orm/pg-core";

const vector = (dims: number) =>
  customType<{ data: number[]; driverData: string }>({
    dataType: () => `vector(${dims})`,
    toDriver: (v) => `[${v.join(",")}]`,
    fromDriver: (v) => JSON.parse(v) as number[],
  });
const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });
const money = (name: string) => numeric(name, { precision: 12, scale: 6, mode: "number" });
const ts = (name: string) => timestamp(name, { withTimezone: true });
const now = (name: string) => ts(name).notNull().defaultNow();

// ------------------------------------------------------------------ projects and plans

export const projects = pgTable("projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  repoFullName: text("repo_full_name"),
  defaultBranch: text("default_branch").notNull().default("main"),
  /** deterministic checks run in a sandbox before review (§8.10), e.g. "pnpm install --frozen-lockfile && pnpm test && pnpm lint" */
  checksCommand: text("checks_command"),
  checksNetwork: boolean("checks_network").notNull().default(false),
  status: text("status").notNull().default("active"),
  nextCardNumber: integer("next_card_number").notNull().default(1),
  /** S3-compatible storage for its scripts (scope §26), besides its storage folder: endpoint, bucket, prefix, region, and the secret variables holding the keys */
  storage: jsonb("storage"),
  createdAt: now("created_at"),
});

export const plans = pgTable("plans", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id),
  version: integer("version").notNull(),
  content: jsonb("content").notNull(),
  status: text("status").notNull(), // draft | approved | superseded | rejected
  approvedAt: ts("approved_at"),
  createdAt: now("created_at"),
}, (t) => [uniqueIndex().on(t.projectId, t.version)]);

// ------------------------------------------------------------------ agents

export const agents = pgTable("agents", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  role: text("role").notNull(),
  description: text("description"),
  /**
   * internal: Orbitalia Moon runs it (versions, sandboxes, the worker loop). external: an
   * identity a harness acts as through the API/MCP/CLI; it has no versions and the
   * worker never starts a run for it.
   */
  runtime: text("runtime").notNull().default("internal"),
  activeVersionId: uuid("active_version_id"),
  createdAt: now("created_at"),
});

/**
 * The Limbic: an agent's start instructions (written by Lucas) and its memories
 * (written by the agent itself, and editable by Lucas). Both go into every run's prompt.
 */
export const limbic = pgTable("limbic", {
  agentId: uuid("agent_id").primaryKey().references(() => agents.id),
  instructions: text("instructions").notNull().default(""),
  memories: text("memories").notNull().default(""),
  updatedAt: now("updated_at"),
});

export const agentVersions = pgTable("agent_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  agentId: uuid("agent_id").notNull().references(() => agents.id),
  version: integer("version").notNull(),
  status: text("status").notNull(), // draft | deployed | archived
  model: text("model").notNull(),
  fallbackModel: text("fallback_model"),
  systemPrompt: text("system_prompt").notNull(),
  tools: jsonb("tools").notNull(),
  skills: jsonb("skills").notNull().default(sql`'[]'::jsonb`),
  permissions: jsonb("permissions").notNull(),
  limits: jsonb("limits").notNull(),
  changeNote: text("change_note"),
  createdAt: now("created_at"),
}, (t) => [uniqueIndex().on(t.agentId, t.version)]);

// ------------------------------------------------------------------ cards

export const cards = pgTable("cards", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id),
  number: integer("number").notNull(),
  title: text("title").notNull(),
  kind: text("kind").notNull().default("code"),
  brief: text("brief"),
  acceptanceCriteria: jsonb("acceptance_criteria").notNull().default(sql`'[]'::jsonb`),
  status: text("status").notNull().default("backlog"),
  statusBeforeBlock: text("status_before_block"),
  blockedReason: text("blocked_reason"),
  priority: text("priority").notNull().default("medium"),
  assigneeAgentId: uuid("assignee_agent_id").references(() => agents.id),
  modelTier: text("model_tier"),
  branch: text("branch"),
  prNumber: integer("pr_number"),
  prUrl: text("pr_url"),
  /** the newest "changes requested" review already acted on */
  prLastReviewId: bigint("pr_last_review_id", { mode: "number" }),
  reviewLoops: integer("review_loops").notNull().default(0),
  planId: uuid("plan_id").references(() => plans.id),
  planKey: text("plan_key"),
  parentCardId: uuid("parent_card_id"),
  meetingId: uuid("meeting_id"),
  source: text("source").notNull().default("manager"),
  startAt: ts("start_at"),
  dueAt: ts("due_at"),
  createdAt: now("created_at"),
  updatedAt: now("updated_at"),
  /** deleted by Lucas: hidden everywhere, kept for the record */
  deletedAt: ts("deleted_at"),
}, (t) => [uniqueIndex().on(t.projectId, t.number), uniqueIndex("cards_plan_key_idx").on(t.planId, t.planKey)]);

/** Lucas's notes on a card; the card's agent acts on each one once. */
export const cardNotes = pgTable("card_notes", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  cardId: uuid("card_id").notNull().references(() => cards.id),
  text: text("text").notNull(),
  createdAt: now("created_at"),
  handledAt: ts("handled_at"),
  handledRunId: uuid("handled_run_id"),
}, (t) => [index().on(t.cardId, t.id)]);

export const cardEvents = pgTable("card_events", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  cardId: uuid("card_id").notNull().references(() => cards.id),
  actor: text("actor").notNull(), // user | agent:<slug> | system
  type: text("type").notNull(), // status_change | log | comment | commit | pr | decision | cost | review
  payload: jsonb("payload").notNull(),
  durationMs: integer("duration_ms"),
  tokens: integer("tokens"),
  costUsd: money("cost_usd"),
  createdAt: now("created_at"),
}, (t) => [index().on(t.cardId, t.createdAt)]);

// ------------------------------------------------------------------ execution

export const meetings = pgTable("meetings", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").references(() => projects.id),
  topic: text("topic").notNull(),
  /** what the meeting should settle (markdown), shown to every participant */
  agenda: text("agenda").notNull().default(""),
  status: text("status").notNull(), // running | closing | closed
  round: integer("round").notNull().default(0),
  maxRounds: integer("max_rounds").notNull().default(3),
  /** how long external participants (harnesses) get to post each round */
  roundMinutes: integer("round_minutes").notNull().default(10),
  roundDeadline: ts("round_deadline"),
  createdBy: text("created_by").notNull().default("user"),
  closedBy: text("closed_by"), // system_one | user | cap | empty | error
  minutes: text("minutes"),
  createdAt: now("created_at"),
  closedAt: ts("closed_at"),
});

export const meetingParticipants = pgTable("meeting_participants", {
  meetingId: uuid("meeting_id").notNull().references(() => meetings.id),
  agentId: uuid("agent_id").notNull().references(() => agents.id),
  joinedAt: now("joined_at"),
}, (t) => [uniqueIndex().on(t.meetingId, t.agentId)]);

export const runs = pgTable("runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  kind: text("kind").notNull(), // agent | manager | review | brief | minutes | scan | report | test
  cardId: uuid("card_id").references(() => cards.id),
  projectId: uuid("project_id").references(() => projects.id),
  meetingId: uuid("meeting_id").references(() => meetings.id),
  agentVersionId: uuid("agent_version_id").references(() => agentVersions.id),
  status: text("status").notNull(), // queued | running | waiting_approval | waiting_input | succeeded | failed | canceled | timed_out
  model: text("model"),
  input: jsonb("input"),
  leaseOwner: text("lease_owner"),
  leaseExpiresAt: ts("lease_expires_at"),
  attempt: integer("attempt").notNull().default(0),
  turn: integer("turn").notNull().default(0),
  checkpoint: jsonb("checkpoint"),
  cancelRequested: boolean("cancel_requested").notNull().default(false),
  costUsd: money("cost_usd").notNull().default(0),
  tokens: integer("tokens").notNull().default(0),
  summary: text("summary"),
  /** what a script's main() returned (scope §26) */
  result: jsonb("result"),
  error: text("error"),
  startedAt: ts("started_at"),
  finishedAt: ts("finished_at"),
  createdAt: now("created_at"),
}, (t) => [index().on(t.status, t.createdAt), index().on(t.cardId)]);

/** Every turn event of a run, numbered, for live transcripts and replay. */
export const runEvents = pgTable("run_events", {
  runId: uuid("run_id").notNull().references(() => runs.id, { onDelete: "cascade" }),
  seq: integer("seq").notNull(),
  type: text("type").notNull(),
  data: jsonb("data").notNull(),
  at: now("at"),
}, (t) => [uniqueIndex().on(t.runId, t.seq)]);

export const modelPrices = pgTable("model_prices", {
  id: serial("id").primaryKey(),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  inputPerMtok: numeric("input_per_mtok", { precision: 10, scale: 4, mode: "number" }).notNull(),
  outputPerMtok: numeric("output_per_mtok", { precision: 10, scale: 4, mode: "number" }).notNull(),
  cacheWritePerMtok: numeric("cache_write_per_mtok", { precision: 10, scale: 4, mode: "number" }).notNull().default(0),
  cacheReadPerMtok: numeric("cache_read_per_mtok", { precision: 10, scale: 4, mode: "number" }).notNull().default(0),
  effectiveFrom: date("effective_from").notNull(),
});

export const llmCalls = pgTable("llm_calls", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  runId: uuid("run_id").references(() => runs.id),
  cardId: uuid("card_id"),
  projectId: uuid("project_id"),
  agentVersionId: uuid("agent_version_id"),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  cacheCreationInputTokens: integer("cache_creation_input_tokens").notNull().default(0),
  cacheReadInputTokens: integer("cache_read_input_tokens").notNull().default(0),
  latencyMs: integer("latency_ms"),
  costUsd: money("cost_usd").notNull().default(0),
  priceId: integer("price_id").references(() => modelPrices.id),
  createdAt: now("created_at"),
}, (t) => [index().on(t.createdAt), index().on(t.cardId)]);

export const approvals = pgTable("approvals", {
  id: uuid("id").primaryKey().defaultRandom(),
  kind: text("kind").notNull(), // plan | tool | budget_raise | network | question | windmill_deploy
  runId: uuid("run_id").references(() => runs.id),
  cardId: uuid("card_id").references(() => cards.id),
  request: jsonb("request").notNull(),
  response: jsonb("response"),
  status: text("status").notNull().default("pending"),
  decidedAt: ts("decided_at"),
  createdAt: now("created_at"),
}, (t) => [index().on(t.status, t.createdAt)]);

export const toolCalls = pgTable("tool_calls", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  runId: uuid("run_id").notNull().references(() => runs.id),
  toolUseId: text("tool_use_id"),
  name: text("name").notNull(),
  input: jsonb("input").notNull(),
  outputSummary: text("output_summary"),
  status: text("status").notNull(), // ok | error | denied | pending_approval
  approvalId: uuid("approval_id").references(() => approvals.id),
  durationMs: integer("duration_ms"),
  createdAt: now("created_at"),
}, (t) => [index().on(t.runId)]);

export const sandboxRuns = pgTable("sandbox_runs", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  runId: uuid("run_id").references(() => runs.id),
  containerName: text("container_name"),
  image: text("image").notNull(),
  command: text("command").notNull(),
  network: boolean("network").notNull().default(false),
  cpuLimit: numeric("cpu_limit", { precision: 3, scale: 1, mode: "number" }).notNull(),
  memLimitMb: integer("mem_limit_mb").notNull(),
  exitCode: integer("exit_code"),
  timedOut: boolean("timed_out").notNull().default(false),
  stdoutTail: text("stdout_tail"),
  stderrTail: text("stderr_tail"),
  fullLogPath: text("full_log_path"),
  durationMs: integer("duration_ms"),
  createdAt: now("created_at"),
});

export const decisions = pgTable("decisions", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  runId: uuid("run_id").references(() => runs.id),
  cardId: uuid("card_id").references(() => cards.id),
  meetingId: uuid("meeting_id").references(() => meetings.id),
  type: text("type").notNull(),
  engine: text("engine").notNull(), // systemone:<model> | haiku_fallback | default
  inputRef: jsonb("input_ref"),
  output: jsonb("output").notNull(),
  confidence: numeric("confidence", { precision: 4, scale: 3, mode: "number" }),
  accepted: boolean("accepted").notNull().default(true),
  latencyMs: integer("latency_ms"),
  outcome: text("outcome"),
  createdAt: now("created_at"),
});

export const meetingMessages = pgTable("meeting_messages", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  meetingId: uuid("meeting_id").notNull().references(() => meetings.id),
  round: integer("round").notNull(),
  agentId: uuid("agent_id").references(() => agents.id),
  kind: text("kind").notNull(), // system | turn | message | minutes
  toAgentId: uuid("to_agent_id").references(() => agents.id),
  /** who wrote it: agent:<slug>, user, user:<token>, system */
  actor: text("actor").notNull().default("system"),
  content: jsonb("content").notNull(),
  createdAt: now("created_at"),
}, (t) => [index().on(t.meetingId, t.id)]);

/** The manager chat: one thread per project (null = "All"). */
export const managerMessages = pgTable("manager_messages", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  projectId: uuid("project_id").references(() => projects.id),
  role: text("role").notNull(), // user | assistant
  content: jsonb("content").notNull(), // provider-neutral blocks
  runId: uuid("run_id").references(() => runs.id),
  costUsd: money("cost_usd"),
  model: text("model"),
  createdAt: now("created_at"),
}, (t) => [index().on(t.projectId, t.id)]);

// ------------------------------------------------------------------ journal and docs

/**
 * A project's journal: each step of the work, as Lucas, Luna, an internal agent
 * or a harness logs it (scope §25). Embedded into notes so agents find it.
 */
export const journalEntries = pgTable("journal_entries", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  projectId: uuid("project_id").notNull().references(() => projects.id),
  cardId: uuid("card_id").references(() => cards.id),
  meetingId: uuid("meeting_id").references(() => meetings.id),
  runId: uuid("run_id").references(() => runs.id),
  actor: text("actor").notNull(),
  kind: text("kind").notNull(), // step | decision | milestone | issue | note
  title: text("title").notNull(),
  body: text("body").notNull().default(""),
  data: jsonb("data").notNull().default(sql`'{}'::jsonb`),
  createdAt: now("created_at"),
}, (t) => [index().on(t.projectId, t.id)]);

/** A project's documents: markdown pages with every version kept. */
export const docs = pgTable("docs", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id),
  slug: text("slug").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  version: integer("version").notNull().default(1),
  updatedBy: text("updated_by").notNull(),
  createdAt: now("created_at"),
  updatedAt: now("updated_at"),
  deletedAt: ts("deleted_at"),
}, (t) => [uniqueIndex().on(t.projectId, t.slug)]);

export const docVersions = pgTable("doc_versions", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  docId: uuid("doc_id").notNull().references(() => docs.id),
  version: integer("version").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  actor: text("actor").notNull(),
  note: text("note"),
  createdAt: now("created_at"),
}, (t) => [uniqueIndex().on(t.docId, t.version)]);

// ------------------------------------------------------------------ budgets

export const budgets = pgTable("budgets", {
  id: serial("id").primaryKey(),
  scope: text("scope").notNull(),
  scopeId: uuid("scope_id"),
  limitUsd: numeric("limit_usd", { precision: 10, scale: 2, mode: "number" }).notNull(),
  warnPct: integer("warn_pct").array().notNull().default(sql`'{50,80}'`),
  periodStart: date("period_start"),
  spentUsd: money("spent_usd").notNull().default(0),
  reservedUsd: money("reserved_usd").notNull().default(0),
  /** the same budget in usage tokens; both are always tracked, the unit switch decides which one blocks */
  limitTokens: bigint("limit_tokens", { mode: "number" }),
  spentTokens: bigint("spent_tokens", { mode: "number" }).notNull().default(0),
  reservedTokens: bigint("reserved_tokens", { mode: "number" }).notNull().default(0),
}, (t) => [unique("budgets_scope_key").on(t.scope, t.scopeId, t.periodStart).nullsNotDistinct()]);

/** Default limits per scope; budgets rows are created from these when a period or a card starts. */
export const budgetDefaults = pgTable("budget_defaults", {
  scope: text("scope").primaryKey(),
  limitUsd: numeric("limit_usd", { precision: 10, scale: 2, mode: "number" }).notNull(),
  limitTokens: bigint("limit_tokens", { mode: "number" }),
  warnPct: integer("warn_pct").array().notNull().default(sql`'{50,80}'`),
});

// ------------------------------------------------------------------ knowledge

export const notes = pgTable("notes", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").references(() => projects.id),
  sourceType: text("source_type").notNull(),
  sourceId: uuid("source_id"),
  content: text("content").notNull(),
  createdAt: now("created_at"),
});

export const noteChunks = pgTable("note_chunks", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  noteId: uuid("note_id").notNull().references(() => notes.id, { onDelete: "cascade" }),
  chunkIndex: integer("chunk_index").notNull(),
  content: text("content").notNull(),
  embedding: vector(1024)("embedding").notNull(),
  embeddingModel: text("embedding_model").notNull(),
}, (t) => [index("note_chunks_embedding_idx").using("hnsw", t.embedding.op("vector_cosine_ops"))]);

// ------------------------------------------------------------------ platform

export const notifications = pgTable("notifications", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  level: text("level").notNull(),
  title: text("title").notNull(),
  body: text("body"),
  link: text("link"),
  channels: text("channels").array().notNull(),
  createdAt: now("created_at"),
  sentAt: ts("sent_at"),
  readAt: ts("read_at"),
});

export const secrets = pgTable("secrets", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  ciphertext: bytea("ciphertext").notNull(),
  allowedTools: text("allowed_tools").array().notNull().default(sql`'{}'`),
  lastUsedAt: ts("last_used_at"),
});

/**
 * Variables scripts get as environment variables (scope §26): per project, or
 * global (project_id null). A secret's value is sealed with the master key and
 * never shown back by any door; every value is masked in run output.
 */
export const variables = pgTable("variables", {
  id: serial("id").primaryKey(),
  projectId: uuid("project_id").references(() => projects.id),
  name: text("name").notNull(),
  isSecret: boolean("is_secret").notNull().default(false),
  /** a plain variable's value */
  value: text("value"),
  /** a secret's value, sealed */
  ciphertext: bytea("ciphertext"),
  description: text("description"),
  updatedBy: text("updated_by").notNull(),
  updatedAt: now("updated_at"),
}, (t) => [unique("variables_scope_name").on(t.projectId, t.name).nullsNotDistinct()]);

/**
 * A project's scripts (scope §26): the code is a file under scripts/ in the
 * project folder (versioned by git); this row holds how it runs and when.
 */
export const scripts = pgTable("scripts", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id),
  path: text("path").notNull(),
  language: text("language").notNull(), // python | typescript | bash | sql
  description: text("description"),
  /** JSON Schema of main()'s arguments, read from the code on save */
  argsSchema: jsonb("args_schema").notNull().default(sql`'{"type":"object","properties":{}}'::jsonb`),
  network: boolean("network").notNull().default(false),
  timeoutS: integer("timeout_s").notNull().default(300),
  memMb: integer("mem_mb").notNull().default(1024),
  /** cron, in the platform's time zone; runs only while schedule_enabled */
  schedule: text("schedule"),
  scheduleArgs: jsonb("schedule_args").notNull().default(sql`'{}'::jsonb`),
  scheduleEnabled: boolean("schedule_enabled").notNull().default(false),
  lastRunId: uuid("last_run_id"),
  createdAt: now("created_at"),
  updatedAt: now("updated_at"),
}, (t) => [uniqueIndex().on(t.projectId, t.path)]);

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: now("updated_at"),
});

export const auditLog = pgTable("audit_log", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  actor: text("actor").notNull(),
  action: text("action").notNull(),
  targetType: text("target_type"),
  targetId: text("target_id"),
  details: jsonb("details"),
  createdAt: now("created_at"),
}, (t) => [index().on(t.createdAt)]);

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  expiresAt: ts("expires_at").notNull(),
  createdAt: now("created_at"),
});

/**
 * Tokens for the API, the MCP server and the CLI (harness access). The database
 * keeps only the SHA-256 of the token, like sessions. A token bound to an agent
 * acts as that agent (actor agent:<slug>); otherwise it acts as Lucas (user:<name>).
 */
export const apiTokens = pgTable("api_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  tokenHash: text("token_hash").notNull().unique(),
  /** the first characters, shown in lists so a token can be recognized */
  prefix: text("prefix").notNull(),
  access: text("access").notNull(), // read | write | admin
  agentId: uuid("agent_id").references(() => agents.id),
  createdAt: now("created_at"),
  lastUsedAt: ts("last_used_at"),
  revokedAt: ts("revoked_at"),
});
