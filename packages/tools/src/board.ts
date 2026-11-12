// Board, inbox and knowledge tools.
import { z } from "zod";
import { PlanContent } from "@miniasys/core";
import { defineTool, type ToolOutcome } from "./registry.ts";

const ok = (content: string): ToolOutcome => ({ content, summary: content.slice(0, 120) });

export const updateCard = defineTool({
  name: "update_card",
  description:
    "Update your own card: its title, its brief, its acceptance criteria (the full new list), or mark criteria you have met (exact text). Change the brief or criteria only when Lucas's note asks for it, and say what you changed.",
  input: z.object({
    title: z.string().min(3).max(120).optional(),
    brief: z.string().min(1).max(20_000).optional(),
    acceptance_criteria: z.array(z.string().min(1)).min(1).max(30).optional(),
    criteria_met: z.array(z.string()).optional(),
  }),
  risk: "low",
  execute: async (i, ctx) => {
    await ctx.board.updateCard({
      ...(i.title ? { title: i.title } : {}),
      ...(i.brief ? { brief: i.brief } : {}),
      ...(i.acceptance_criteria ? { acceptanceCriteria: i.acceptance_criteria } : {}),
      ...(i.criteria_met ? { acceptanceCriteriaMet: i.criteria_met } : {}),
    });
    return ok("card updated");
  },
});

export const cortexSearch = defineTool({
  name: "cortex_search",
  description: "Search your cortex: the map of markdown documents and parquet tables you may read. Returns each match's index, path, kind and what it is about.",
  input: z.object({ query: z.string().min(2), limit: z.number().int().min(1).max(20).default(8) }),
  risk: "low",
  execute: async (i, ctx) => {
    if (!ctx.cortex) return { content: "You have no cortex map yet.", summary: "no cortex", isError: true };
    const hits = await ctx.cortex.search(i.query, i.limit);
    return { content: hits.map((h) => `#${h.index} [${h.kind}] ${h.path} (${h.score.toFixed(2)})\n  ${h.about}`).join("\n") || "nothing on the map matches", summary: `${hits.length} matches`, untrusted: true };
  },
});

export const cortexRead = defineTool({
  name: "cortex_read",
  description:
    "Read a file from your cortex map, by path or index. Markdown comes back as text. For a parquet table you get its columns and rows, or the result of `sql` run over it as table `t` (a single read-only SELECT).",
  input: z.object({ path: z.string().optional(), index: z.number().int().min(0).optional(), sql: z.string().max(4000).optional(), limit: z.number().int().min(1).max(500).default(50) }),
  risk: "low",
  execute: async (i, ctx) => {
    if (!ctx.cortex) return { content: "You have no cortex map yet.", summary: "no cortex", isError: true };
    if (i.path == null && i.index == null) return { content: "Give a path or an index from cortex_search.", summary: "no file given", isError: true };
    try {
      const text = await ctx.cortex.read({ ...(i.path ? { path: i.path } : {}), ...(i.index != null ? { index: i.index } : {}) }, { ...(i.sql ? { sql: i.sql } : {}), limit: i.limit });
      return { content: text, summary: `read ${i.path ?? `#${i.index}`}`, untrusted: true };
    } catch (e) {
      return { content: (e as Error).message, summary: (e as Error).message.slice(0, 100), isError: true };
    }
  },
});

export const limbicRemember = defineTool({
  name: "limbic_remember",
  description: "Save a memory for your future runs: a fact, a preference of Lucas's, or a lesson learned. One short self-contained sentence or two. It goes into your prompt from now on.",
  input: z.object({ memory: z.string().min(5).max(1000) }),
  risk: "low",
  execute: async (i, ctx) => {
    if (!ctx.limbic) return { content: "Memory is not available.", summary: "no limbic", isError: true };
    await ctx.limbic.remember(i.memory);
    return ok("remembered");
  },
});

export const limbicForget = defineTool({
  name: "limbic_forget",
  description: "Remove memories that are wrong or outdated: every memory line containing the given text.",
  input: z.object({ match: z.string().min(3).max(500) }),
  risk: "low",
  execute: async (i, ctx) => {
    if (!ctx.limbic) return { content: "Memory is not available.", summary: "no limbic", isError: true };
    const n = await ctx.limbic.forget(i.match);
    return ok(n ? `forgot ${n} memor${n === 1 ? "y" : "ies"}` : "no memory matched");
  },
});

export const addCardLog = defineTool({
  name: "add_card_log",
  description: "Add a short progress note to your card's activity log.",
  input: z.object({ message: z.string().min(1).max(2000) }),
  risk: "low",
  execute: async (i, ctx) => {
    await ctx.board.log(i.message);
    return ok("logged");
  },
});

export const comment = defineTool({
  name: "comment",
  description: "Comment on your card (visible to Lucas and the other agents).",
  input: z.object({ text: z.string().min(1).max(4000) }),
  risk: "low",
  execute: async (i, ctx) => {
    await ctx.board.comment(i.text);
    return ok("commented");
  },
});

export const requestHumanInput = defineTool({
  name: "request_human_input",
  description: "Ask Lucas one specific question you can't answer yourself. Your run pauses until he answers; the card shows as blocked.",
  input: z.object({ question: z.string().min(5).max(2000), options: z.array(z.string()).max(6).optional() }),
  risk: "low",
  execute: async (i, ctx) => {
    const { approvalId } = await ctx.board.requestHumanInput(i.question, i.options);
    return { content: "question sent; waiting for the answer", summary: "asked Lucas", wait: { approvalId } };
  },
});

export const notifyUser = defineTool({
  name: "notify_user",
  description: "Send Lucas a notification (inbox, and his phone for warn/critical).",
  input: z.object({ level: z.enum(["info", "warn", "critical"]), message: z.string().min(1).max(500) }),
  risk: "low",
  execute: async (i, ctx) => {
    await ctx.board.notifyUser(i.level, i.message);
    return ok("notified");
  },
});

export const createCards = defineTool({
  name: "create_cards",
  description:
    "Propose a plan for the current project: summary, assumptions, milestones with cards. Lucas approves it before any card is created; you'll be told the outcome.",
  input: PlanContent,
  risk: "medium",
  execute: async (i, ctx) => {
    const r = await ctx.board.proposePlan(i);
    return { content: "plan proposed; waiting for Lucas's approval", summary: "plan proposed", wait: { approvalId: r.approvalId } };
  },
});

export const listCards = defineTool({
  name: "list_cards",
  description: "List the cards of the current project (or all projects), optionally by status.",
  input: z.object({ status: z.string().optional() }),
  risk: "low",
  execute: async (i, ctx) => {
    const cards = await ctx.board.listCards({ status: i.status });
    return ok(cards.map((c) => `${c.path} [${c.status}${c.blockedReason ? `/${c.blockedReason}` : ""}] ${c.title}`).join("\n") || "no cards");
  },
});

export const loadSkill = defineTool({
  name: "load_skill",
  description: "Load a skill (a folder of instructions) by name into your context.",
  input: z.object({ name: z.string().regex(/^[a-z0-9][a-z0-9-]*$/) }),
  risk: "low",
  execute: async (i, ctx) => {
    const text = await ctx.skills?.load(i.name);
    return text ? { content: text, summary: `skill ${i.name}` } : { content: `no skill named ${i.name}`, summary: "no such skill", isError: true };
  },
});

export const searchNotes = defineTool({
  name: "search_notes",
  description: "Search the project's knowledge (plans, briefs, reviews, minutes, docs) by meaning. Returns the best matching passages.",
  input: z.object({ query: z.string().min(2), limit: z.number().int().min(1).max(8).default(5) }),
  risk: "low",
  execute: async (i, ctx) => {
    if (!ctx.notes) return { content: "search is not available yet", summary: "unavailable", isError: true };
    const hits = await ctx.notes.search(i.query, i.limit);
    return { content: hits.map((h) => `[${h.source}] (${h.score.toFixed(2)})\n${h.content}`).join("\n\n---\n\n") || "no matches", summary: `${hits.length} passages`, untrusted: true };
  },
});


// ------------------------------------------------------------------ journal and docs (scope §25)

export const logStep = defineTool({
  name: "log_step",
  description:
    "Log a step in the project's journal: something done, decided, reached or found, worth keeping in the project's history (not routine progress: that's add_card_log). kind: step | decision | milestone | issue | note. The body is markdown: what, why, result.",
  input: z.object({ kind: z.enum(["step", "decision", "milestone", "issue", "note"]).default("step"), title: z.string().min(1).max(200), body: z.string().max(20_000).default("") }),
  risk: "low",
  execute: async (i, ctx) => {
    const r = await ctx.board.logStep(i);
    return ok(`logged in the journal (#${r.id})`);
  },
});

export const listDocs = defineTool({
  name: "list_docs",
  description: "List the project's documents (slug, title, version).",
  input: z.object({}),
  risk: "low",
  execute: async (_i, ctx) => {
    const docs = await ctx.board.listDocs();
    return ok(docs.length ? docs.map((d) => `${d.slug} (v${d.version}): ${d.title}`).join("\n") : "no docs yet");
  },
});

export const readDoc = defineTool({
  name: "read_doc",
  description: "Read one of the project's documents (markdown) by slug; note its version if you will change it.",
  input: z.object({ slug: z.string().min(1).max(80), version: z.number().int().min(1).optional() }),
  risk: "low",
  execute: async (i, ctx) => {
    const d = await ctx.board.readDoc(i.slug, i.version);
    return d ? { content: `# ${d.title} (v${d.version})\n\n${d.body}`, summary: `read ${d.slug} v${d.version}` } : ok(`no doc ${i.slug}`);
  },
});

export const writeDoc = defineTool({
  name: "write_doc",
  description:
    "Create or rewrite one of the project's documents (the whole markdown body; each save is a new version). Pass base_version (the version you read, 0 for a new doc) so you never overwrite a newer change; say what changed in note.",
  input: z.object({ slug: z.string().regex(/^[a-z0-9][a-z0-9-/]{0,80}$/), title: z.string().min(1).max(200).optional(), body: z.string().max(200_000), base_version: z.number().int().min(0).optional(), note: z.string().max(500).optional() }),
  risk: "low",
  execute: async (i, ctx) => {
    const r = await ctx.board.writeDoc({ slug: i.slug, body: i.body, ...(i.title ? { title: i.title } : {}), ...(i.base_version !== undefined ? { baseVersion: i.base_version } : {}), ...(i.note ? { note: i.note } : {}) });
    return ok(r.unchanged ? `${i.slug} unchanged (v${r.version})` : `${i.slug} saved as v${r.version}`);
  },
});

export const callMeeting = defineTool({
  name: "call_meeting",
  description:
    "Call a meeting of agents on the current project to settle something together (conflicting cards, a design choice, blockers). Round 1 every participant gives an update; then those asked questions answer. It closes with minutes, and its action items become cards.",
  input: z.object({ topic: z.string().min(3).max(200), agenda: z.string().max(4000).default(""), participants: z.array(z.string().min(1)).min(1).max(8).describe("agent slugs"), max_rounds: z.number().int().min(1).max(6).default(3) }),
  risk: "medium",
  execute: async (i, ctx) => {
    const r = await ctx.board.callMeeting({ topic: i.topic, agenda: i.agenda, participants: i.participants, maxRounds: i.max_rounds });
    return ok(`meeting started (${r.meetingId}); its minutes and cards arrive when it closes`);
  },
});

export const runScript = defineTool({
  name: "run_script",
  description:
    "Run one of the project's saved scripts (scripts/<name> in the project's code, as merged into its base branch) with arguments, and wait for it: its result, status and the end of its output. It runs with the project's variables (secrets come back masked as ***) and storage.",
  input: z.object({ script: z.string().min(1).max(300).describe('e.g. "etl.py" or "scripts/etl.py"'), args: z.record(z.string(), z.unknown()).default({}) }),
  risk: "medium",
  execute: async (i, ctx) => {
    const r = await ctx.board.runScript(i.script.startsWith("scripts/") ? i.script : `scripts/${i.script}`, i.args);
    const body = JSON.stringify({ status: r.status, result: r.result, error: r.error, output: r.output.slice(-4000) }, null, 1);
    return { content: body, summary: `${i.script}: ${r.status}` };
  },
});

export const BOARD_TOOLS = [updateCard, addCardLog, comment, requestHumanInput, notifyUser, createCards, listCards, loadSkill, searchNotes, cortexSearch, cortexRead, limbicRemember, limbicForget, logStep, listDocs, readDoc, writeDoc, callMeeting, runScript];
