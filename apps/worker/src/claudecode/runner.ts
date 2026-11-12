// The Claude subscription engine: the real Claude Code CLI, headless, inside a
// sandbox container. It logs in with the token from `claude setup-token`
// (Anthropic's supported way to use a subscription non-interactively), stored
// encrypted as a secret. Orbitalia Moon never calls the API with that token itself.
//
// Differences from the API engine, by design:
// - Claude Code uses its own tools inside the container, which needs network
//   access to reach Anthropic; the token is visible to processes in it.
// - Usage is counted in tokens; the run holds up to what the budget has left and
//   is stopped when it has used that.
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { usageTokens, type CallScope, type Usage } from "@miniasys/core";
import { llmCalls, runs, secrets, eq, sql, CLAUDE_TOKEN_SECRET } from "@miniasys/db";
import { BudgetExceeded } from "../budgets.ts";
import type { Services } from "../services.ts";
import { ClaudeStream, type StreamEvent } from "./stream.ts";

export class SubscriptionUnavailable extends Error {}

export interface ClaudeCodeOptions {
  runId: string;
  scope: CallScope & { agentVersionId?: string | null };
  agentDayLimit?: number | undefined;
  model: string;
  prompt: string;
  systemAppend: string;
  /** the card workspace (mounted at /workspace); null: an empty scratch folder */
  workspace: string | null;
  /** Claude Code keeps its sessions here (one folder per card or run), so a run can resume */
  homeKey: string;
  tools: "default" | "none";
  maxTurns: number;
  resume?: string | null;
  jsonSchema?: object | null;
  /** the most tokens this run may use (also capped by what the budget has left) */
  capTokens: number;
  timeoutS: number;
  signal: AbortSignal;
  onEvent?: (e: StreamEvent) => void | Promise<void>;
}

export interface ClaudeCodeResult {
  ok: boolean;
  text: string;
  structured: unknown;
  sessionId: string | null;
  usage: Usage;
  tokens: number;
  turns: number;
  apiEquivalentUsd: number | null;
  /** "budget": stopped after using what it held; "aborted": the signal stopped it */
  stopped: "budget" | "aborted" | null;
  error: string | null;
}

export async function claudeToken(s: Services): Promise<string> {
  const [row] = await s.d.db.select().from(secrets).where(eq(secrets.name, CLAUDE_TOKEN_SECRET));
  if (!row) throw new SubscriptionUnavailable("the Claude subscription is not connected (Settings → Models → Claude subscription)");
  if (!s.envelope.ready) throw new SubscriptionUnavailable("MASTER_KEY_FILE is not set, so the Claude token can't be decrypted");
  await s.d.db.update(secrets).set({ lastUsedAt: new Date() }).where(eq(secrets.id, row.id));
  return s.envelope.open(row.ciphertext);
}

const q = (path: string) => `"$(cat ${path})"`;

export async function runClaudeCode(s: Services, o: ClaudeCodeOptions): Promise<ClaudeCodeResult> {
  if (!s.sandbox) throw new SubscriptionUnavailable("the Claude subscription engine runs Claude Code in a sandbox, and sandboxes are unavailable");
  const health = await s.sandbox.health();
  if (!health.ok) throw new SubscriptionUnavailable(`the Claude subscription engine runs Claude Code in a sandbox container, and the container engine (${s.config.containerRuntime}, ${s.config.podmanSocket}) is unreachable: ${health.error}`);
  const token = await claudeToken(s);

  const hold = await s.budgets.reserveUpTo(o.scope, o.capTokens, Math.min(20_000, o.capTokens), o.agentDayLimit);
  const home = join(s.config.workspacesDir, ".claude-home", o.homeKey);
  const meta = join(home, ".miniasys");
  await mkdir(meta, { recursive: true });
  await writeFile(join(meta, "prompt.md"), o.prompt);
  await writeFile(join(meta, "system.md"), o.systemAppend);
  let workspace = o.workspace;
  if (!workspace) {
    workspace = join(s.config.workspacesDir, ".scratch", o.runId);
    await mkdir(workspace, { recursive: true });
  }
  const args = [
    "claude", "-p", q("/claude-home/.miniasys/prompt.md"),
    "--output-format", "stream-json", "--verbose",
    "--model", o.model, "--max-turns", String(o.maxTurns),
    "--dangerously-skip-permissions",
    // the account's claude.ai connectors (mail, calendar, docs…) would ride along with the subscription token: none here
    "--strict-mcp-config",
    "--append-system-prompt-file", "/claude-home/.miniasys/system.md",
  ];
  if (o.tools === "none") args.push("--tools", '""');
  if (o.resume && /^[\w-]+$/.test(o.resume)) args.push("--resume", o.resume);
  if (o.jsonSchema) {
    // Claude Code's validator has no draft 2020-12 meta-schema registered: a "$schema" key (zod adds one) fails the run
    const { $schema: _drop, ...schema } = o.jsonSchema as Record<string, unknown>;
    await writeFile(join(meta, "schema.json"), JSON.stringify(schema));
    args.push("--json-schema", q("/claude-home/.miniasys/schema.json"));
  }
  const command = args.join(" ");

  const parser = new ClaudeStream();
  let overBudget = false;
  const r = await s.sandbox.stream(
    {
      runId: o.runId, n: Date.now() % 100_000, workspace, gitDir: !!o.workspace, home, command,
      image: s.config.sandboxImage, network: true, cpus: 1, memMb: 2048, timeoutS: o.timeoutS,
      env: { CLAUDE_CODE_OAUTH_TOKEN: token, DISABLE_AUTOUPDATER: "1", CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1" },
    },
    async (line) => {
      for (const ev of parser.feed(line)) await o.onEvent?.(ev);
      if (usageTokens(parser.usage) > hold.tokens) {
        overBudget = true;
        return "stop";
      }
    },
    o.signal,
  );

  const final = parser.final;
  const usage = final?.usage ?? parser.usage;
  const tokens = usageTokens(usage);
  await s.budgets.settle(hold, { usd: 0, tokens });
  await s.d.db.insert(llmCalls).values({
    runId: o.runId, cardId: o.scope.cardId ?? null, projectId: o.scope.projectId ?? null, agentVersionId: o.scope.agentVersionId ?? null,
    provider: "claude_code", model: o.model, inputTokens: usage.input, outputTokens: usage.output,
    cacheCreationInputTokens: usage.cacheWrite, cacheReadInputTokens: usage.cacheRead, latencyMs: r.durationMs, costUsd: 0,
  });
  await s.d.db.update(runs).set({ tokens: sql`${runs.tokens} + ${tokens}` }).where(eq(runs.id, o.runId));
  // the full command line holds no secret (the token is an environment variable)
  await s.d.sql`INSERT INTO sandbox_runs (run_id, container_name, image, command, network, cpu_limit, mem_limit_mb, exit_code, timed_out, stdout_tail, stderr_tail, duration_ms)
    VALUES (${o.runId}, ${r.containerName}, ${s.config.sandboxImage}, ${command}, true, 1, 2048, ${r.exitCode}, ${r.timedOut}, ${""}, ${r.stderrTail.replaceAll(token, "[redacted]")}, ${r.durationMs})`;

  const stopped = overBudget ? "budget" : o.signal.aborted ? "aborted" : null;
  return {
    ok: !!final?.ok && !stopped,
    text: final?.text ?? "",
    structured: final?.structured ?? null,
    sessionId: final?.sessionId ?? parser.sessionId,
    usage, tokens, turns: final?.turns ?? 0,
    apiEquivalentUsd: final?.apiEquivalentUsd ?? null,
    stopped,
    error: final?.error ?? (r.timedOut ? `timed out after ${o.timeoutS}s` : !final && !stopped ? `Claude Code exited ${r.exitCode}: ${r.stderrTail.replaceAll(token, "[redacted]").slice(-500)}` : null),
  };
}

/** A budget stop, as the error the API path raises, so callers handle both alike. */
export function budgetStop(hold: number): BudgetExceeded {
  return new BudgetExceeded([], hold, "tokens");
}
