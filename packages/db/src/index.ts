// Postgres through postgres.js + Drizzle. One pool per process.
import postgres from "postgres";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import { PG_CHANNEL, type BusEvent } from "@miniasys/core";
import * as schema from "./schema.ts";

export * as schema from "./schema.ts";
export * from "./schema.ts";
export { sql, eq, ne, and, or, desc, asc, inArray, isNull, isNotNull, gte, lte } from "drizzle-orm";

export type Db = PostgresJsDatabase<typeof schema>;
export type Sql = postgres.Sql;

export interface Database {
  db: Db;
  sql: Sql;
  close(): Promise<void>;
}

export function connect(url: string, max = 10): Database {
  const sql = postgres(url, { max, idle_timeout: 30, connect_timeout: 10, onnotice: () => {} });
  const db = drizzle(sql, { schema });
  return { db, sql, close: () => sql.end({ timeout: 5 }) };
}

/** Publishes a live event for the web app's SSE stream (scope §18.7). */
export async function publish(sql: Sql, ev: BusEvent): Promise<void> {
  // NOTIFY payloads are limited to 8000 bytes: big data is fetched by id instead
  const payload = JSON.stringify(ev);
  await sql`SELECT pg_notify(${PG_CHANNEL}, ${payload.length < 7900 ? payload : JSON.stringify({ topic: ev.topic, type: ev.type })})`;
}

/** Every user action and agent side effect (scope §17). */
export async function audit(
  db: Db,
  actor: string,
  action: string,
  target?: { type: string; id: string } | null,
  details?: unknown,
): Promise<void> {
  await db.insert(schema.auditLog).values({ actor, action, targetType: target?.type ?? null, targetId: target?.id ?? null, details: details ?? null });
}

export async function getSetting<T>(db: Db, key: string, fallback: T): Promise<T> {
  const [row] = await db.select().from(schema.settings).where(eq(schema.settings.key, key));
  return row ? (row.value as T) : fallback;
}

export async function setSetting(db: Db, key: string, value: unknown): Promise<void> {
  await db
    .insert(schema.settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: schema.settings.key, set: { value, updatedAt: new Date() } });
}


/** Settings keys and their defaults. */
export const SETTINGS = {
  /** role → model id; ids live in configuration, never in code (§8.1) */
  models: "models",
  paused: "agents_paused",
  /** role → "api" | "claude_code" */
  engines: "engines",
  /** "usd" | "tokens": what budgets enforce */
  budgetUnit: "budget_unit",
  sandbox: "sandbox",
  schedules: "schedules",
} as const;

export interface ModelSettings {
  manager: string;
  brief_writer: string;
  worker_default: string;
  worker_strong: string;
  reviewer: string;
  security: string;
  decisions_fallback: string;
  colibri_decision_model: string | null;
  /** a small model on the local Ollama for decisions; null turns it off */
  local_decision_model: string | null;
}

export const DEFAULT_MODELS: ModelSettings = {
  manager: "claude-opus-5-5",
  brief_writer: "claude-haiku-5-5",
  worker_default: "claude-haiku-5-5",
  worker_strong: "claude-sonnet-5-5",
  reviewer: "claude-sonnet-5-5",
  security: "claude-sonnet-5-5",
  decisions_fallback: "claude-haiku-5-5",
  colibri_decision_model: null,
  local_decision_model: null,
};

export interface SandboxSettings {
  cpus: number;
  memMb: number;
  maxConcurrent: number;
  timeoutS: number;
  networkAllowlist: string[];
}

export const DEFAULT_SANDBOX: SandboxSettings = { cpus: 1, memMb: 1024, maxConcurrent: 2, timeoutS: 300, networkAllowlist: [] };

export * from "./cards.ts";
export * from "./journal.ts";
export * from "./meetings.ts";
export * from "./variables.ts";

export type Engine = "api" | "claude_code";
export interface EngineSettings {
  manager: Engine;
  worker: Engine;
  reviewer: Engine;
  brief_writer: Engine;
}
export const DEFAULT_ENGINES: EngineSettings = { manager: "api", worker: "api", reviewer: "api", brief_writer: "api" };

/** The secret holding the token from `claude setup-token` (encrypted with the master key). */
export const CLAUDE_TOKEN_SECRET = "CLAUDE_CODE_OAUTH_TOKEN";
