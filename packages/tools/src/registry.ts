// The tool registry. A tool is a Zod schema (its input, validated before it
// runs), a JSON schema for the model, a risk badge, and an implementation that
// receives only the services its context gives it.
import { z } from "zod";
import type { AgentPermissions, Usage } from "@miniasys/core";
import type { ToolSpec } from "@miniasys/llm";
import type { SandboxResult } from "@miniasys/sandbox";

export type Risk = "low" | "medium" | "high";

export interface ToolOutcome {
  /** what the model reads */
  content: string;
  /** one line for the run's tool list */
  summary: string;
  isError?: boolean;
  /** data from outside the platform (files, commands, the web): wrapped as untrusted */
  untrusted?: boolean;
  /** the run should stop and wait (request_human_input) */
  wait?: { approvalId: string };
}

/** The board operations agents may perform on their own card; implemented by the worker. */
export interface BoardApi {
  updateCard(patch: { title?: string; brief?: string; acceptanceCriteria?: string[]; acceptanceCriteriaMet?: string[] }): Promise<void>;
  log(message: string, data?: unknown): Promise<void>;
  comment(text: string): Promise<void>;
  requestHumanInput(question: string, options?: string[]): Promise<{ approvalId: string }>;
  notifyUser(level: "info" | "warn" | "critical", message: string): Promise<void>;
  proposePlan(plan: unknown): Promise<{ approvalId: string; planId: string }>;
  listCards(filter: { status?: string | undefined }): Promise<{ path: string; title: string; status: string; blockedReason: string | null }[]>;
  /** the project's journal and docs (scope §25) */
  logStep(e: { kind: "step" | "decision" | "milestone" | "issue" | "note"; title: string; body: string }): Promise<{ id: number }>;
  listDocs(): Promise<{ slug: string; title: string; version: number; updatedBy: string }[]>;
  readDoc(slug: string, version?: number): Promise<{ slug: string; title: string; body: string; version: number } | null>;
  writeDoc(d: { slug: string; title?: string; body: string; baseVersion?: number; note?: string }): Promise<{ version: number; unchanged: boolean }>;
  /** starts a meeting on the run's project (scope §9) */
  callMeeting(m: { topic: string; agenda: string; participants: string[]; maxRounds?: number }): Promise<{ meetingId: string }>;
  /** runs one of the project's saved scripts and waits for it (scope §26) */
  runScript(path: string, args: Record<string, unknown>): Promise<{ runId: string; status: string; result: unknown; error: string | null; output: string }>;
}

export interface ToolContext {
  runId: string;
  cardId: string | null;
  projectSlug: string | null;
  agentSlug: string;
  permissions: AgentPermissions;
  /** the card workspace (absolute), null for agents without one (the manager) */
  workspace: string | null;
  signal: AbortSignal;
  board: BoardApi;
  sandbox: {
    run(command: string, o: { timeoutS: number; network: boolean; readOnly?: boolean }): Promise<SandboxResult>;
  } | null;
  git: {
    commit(message: string): Promise<{ sha: string | null; files: number }>;
  } | null;
  skills: {
    load(name: string): Promise<string | null>;
  } | null;
  notes: {
    search(query: string, limit: number): Promise<{ source: string; content: string; score: number }[]>;
  } | null;
  /** the agent's read-only map of the storage (null: no map for this agent) */
  cortex: {
    search(query: string, limit: number): Promise<{ index: number; path: string; kind: string; about: string; score: number }[]>;
    read(ref: { path?: string; index?: number }, o: { sql?: string; limit?: number }): Promise<string>;
  } | null;
  /** the agent's own memories */
  limbic: {
    remember(text: string): Promise<void>;
    forget(match: string): Promise<number>;
  } | null;
  /** usage accounting for tools that call models themselves */
  usage?: (u: Usage, model: string) => Promise<void>;
}

export interface Tool<I = unknown> {
  name: string;
  description: string;
  input: z.ZodType<I>;
  risk: Risk;
  /** whether this call needs Lucas's approval, beyond the agent's per-tool flag */
  needsApproval?(input: I, ctx: Pick<ToolContext, "permissions">): boolean;
  execute(input: I, ctx: ToolContext): Promise<ToolOutcome>;
}

export const defineTool = <I>(t: Tool<I>): Tool<I> => t;

export function specOf(t: Tool<unknown>): ToolSpec {
  const schema = z.toJSONSchema(t.input as z.ZodType, { target: "draft-7" }) as Record<string, unknown>;
  delete schema.$schema;
  return { name: t.name, description: t.description, schema };
}

export class ToolRegistry {
  private tools = new Map<string, Tool<unknown>>();
  register(...tools: Tool<any>[]) {
    for (const t of tools) this.tools.set(t.name, t as Tool<unknown>);
    return this;
  }
  get(name: string) {
    return this.tools.get(name);
  }
  all() {
    return [...this.tools.values()];
  }
}
