// Board, inbox and knowledge tools.
import { z } from "zod";
import { PlanContent } from "@miniasys/core";
import { defineTool, type ToolOutcome } from "./registry.ts";

const ok = (content: string): ToolOutcome => ({ content, summary: content.slice(0, 120) });

export const updateCard = defineTool({
  name: "update_card",
  description: "Update your own card: its title, or mark acceptance criteria you have met (exact text).",
  input: z.object({ title: z.string().min(3).max(120).optional(), criteria_met: z.array(z.string()).optional() }),
  risk: "low",
  execute: async (i, ctx) => {
    await ctx.board.updateCard({ ...(i.title ? { title: i.title } : {}), ...(i.criteria_met ? { acceptanceCriteriaMet: i.criteria_met } : {}) });
    return ok("card updated");
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

export const BOARD_TOOLS = [updateCard, addCardLog, comment, requestHumanInput, notifyUser, createCards, listCards, loadSkill, searchNotes];
