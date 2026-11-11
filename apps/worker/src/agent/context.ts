// What a run starts with (scope §8.5): a cached system prompt, cached project
// context, and the run's own part (the card brief, or the manager's board view).
// Workers never receive the full plan, only their brief.
import { cardPath, SYSTEM_UNTRUSTED_RULE } from "@miniasys/core";
import { cards, managerMessages, plans, projects, and, desc, eq, isNull } from "@miniasys/db";
import type { Message, PromptBlock } from "@miniasys/llm";
import { listSkills } from "../knowledge.ts";
import type { Services } from "../services.ts";

type Card = typeof cards.$inferSelect;
type Project = typeof projects.$inferSelect;

export async function systemBlocks(s: Services, o: { prompt: string; tools: string[]; role: string; project: Project | null; card: Card | null }): Promise<PromptBlock[]> {
  const blocks: PromptBlock[] = [];
  let fixed = `${o.prompt.trim()}\n\n${SYSTEM_UNTRUSTED_RULE}`;
  if (o.tools.includes("load_skill")) {
    const skills = await listSkills(s.config.skillsDir);
    if (skills.length) fixed += `\n\n# Skills\nLoad one with load_skill before a task it covers:\n${skills.map((k) => `- ${k.name}: ${k.description}`).join("\n")}`;
  }
  blocks.push({ text: fixed, tier: "static" });

  if (o.project) {
    let text = `# Project ${`p/${o.project.slug}`}: ${o.project.name}\n${o.project.description ?? ""}${o.project.repoFullName ? `\nRepository: ${o.project.repoFullName} (base branch ${o.project.defaultBranch})` : ""}`;
    // the plan's summary is project context for the manager; workers get their brief only
    if (o.role === "manager") {
      const [plan] = await s.d.db.select().from(plans).where(and(eq(plans.projectId, o.project.id), eq(plans.status, "approved"))).orderBy(desc(plans.version)).limit(1);
      if (plan) text += `\n\n## Approved plan (v${plan.version})\n${(plan.content as { summary: string }).summary}`;
    }
    blocks.push({ text, tier: "project" });
  }

  if (o.role === "manager") blocks.push({ text: await boardView(s, o.project), tier: "run" });
  return blocks;
}

async function boardView(s: Services, project: Project | null): Promise<string> {
  const rows = await s.d.sql<{ slug: string; number: number; title: string; status: string; blocked_reason: string | null; pr_url: string | null; cost: string }[]>`
    SELECT p.slug, c.number, c.title, c.status, c.blocked_reason, c.pr_url,
      COALESCE((SELECT sum(cost_usd) FROM llm_calls l WHERE l.card_id = c.id), 0) AS cost
    FROM cards c JOIN projects p ON p.id = c.project_id
    WHERE (${project?.id ?? null}::uuid IS NULL OR c.project_id = ${project?.id ?? null}) AND c.status <> 'done'
    ORDER BY c.updated_at DESC LIMIT 60`;
  const [spend] = await s.d.sql<{ today: string; month: string }[]>`
    SELECT COALESCE(sum(cost_usd) FILTER (WHERE created_at >= date_trunc('day', now())), 0) AS today,
           COALESCE(sum(cost_usd) FILTER (WHERE created_at >= date_trunc('month', now())), 0) AS month FROM llm_calls`;
  const lines = rows.map((c) => `- ${cardPath(c.slug, c.number)} [${c.status}${c.blocked_reason ? `/${c.blocked_reason}` : ""}] ${c.title} ($${Number(c.cost).toFixed(2)})${c.pr_url ? ` PR ${c.pr_url}` : ""}`);
  return `# Board now (${new Date().toISOString().slice(0, 16)}Z)\nSpend: $${Number(spend?.today ?? 0).toFixed(2)} today, $${Number(spend?.month ?? 0).toFixed(2)} this month.\n${lines.join("\n") || "No open cards."}`;
}

/** The first message of a worker run: its card, brief, criteria, and any feedback that sent it back. */
export function cardTask(project: Project, card: Card, feedback?: string | null): Message {
  const criteria = (card.acceptanceCriteria as (string | { text: string; met: boolean })[]).map((c) => (typeof c === "string" ? c : c.text));
  const text = [
    `Work on card ${cardPath(project.slug, card.number)}: ${card.title}`,
    `Kind: ${card.kind}. Branch: ${card.branch}. Your workspace is the repository at /workspace.`,
    `## Brief\n${card.brief ?? "(no brief; use the title and criteria)"}`,
    `## Acceptance criteria\n${criteria.map((c) => `- ${c}`).join("\n") || "- (none given)"}`,
    feedback ? `## Feedback on your previous attempt\n${feedback}` : "",
  ].filter(Boolean).join("\n\n");
  return { role: "user", content: [{ type: "text", text }] };
}

/** The manager's conversation: the recent chat of this project (or "All"), as text. */
export async function managerHistory(s: Services, projectId: string | null, limit = 30): Promise<Message[]> {
  const rows = await s.d.db
    .select()
    .from(managerMessages)
    .where(projectId ? eq(managerMessages.projectId, projectId) : isNull(managerMessages.projectId))
    .orderBy(desc(managerMessages.id))
    .limit(limit);
  const out: Message[] = [];
  for (const r of rows.reverse()) {
    const text = (r.content as { text?: string }).text ?? "";
    if (!text) continue;
    const prev = out.at(-1);
    if (prev && prev.role === r.role) (prev.content as { type: "text"; text: string }[]).push({ type: "text", text });
    else out.push(r.role === "user" ? { role: "user", content: [{ type: "text", text }] } : { role: "assistant", content: [{ type: "text", text }] });
  }
  while (out[0]?.role === "assistant") out.shift();
  return out;
}

