// Everything a job or a run needs, built once in main.ts.
import type { PgBoss } from "pg-boss";
import type { Logger } from "pino";
import type { Config, Envelope } from "@miniasys/core";
import type { Database } from "@miniasys/db";
import type { Decider, OllamaEmbeddings } from "@miniasys/llm";
import type { SandboxRunner } from "@miniasys/sandbox";
import type { ToolRegistry } from "@miniasys/tools";
import type { Budgets } from "./budgets.ts";
import type { GitHub } from "./github.ts";
import type { Journal } from "./journal.ts";
import type { Models } from "./models.ts";
import type { Notifier } from "./notifier.ts";

export interface Services {
  config: Config;
  d: Database;
  log: Logger;
  boss: Pick<PgBoss, "send">;
  models: Models;
  decider: Decider;
  sandbox: SandboxRunner | null;
  budgets: Budgets;
  notifier: Notifier;
  journal: Journal;
  registry: ToolRegistry;
  github: GitHub | null;
  embeddings: OllamaEmbeddings;
  envelope: Envelope;
}

/** pg-boss queue names. */
export const QUEUES = {
  planApproved: "plan.approved",
  cardBrief: "card.brief",
  cardRoute: "card.route",
  cardChecks: "card.checks",
  cardReview: "card.review",
  cardPr: "card.pr",
  prsPoll: "prs.poll",
  notesEmbed: "notes.embed",
  dailyReport: "report.daily",
  sweep: "maintenance.sweep",
  backup: "backup.nightly",
} as const;
