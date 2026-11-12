// Shared Zod schemas: tool inputs, API payloads, agent configuration and the
// typed outputs of System One decisions (scope §6, §8.6).
import { z } from "zod";

// ------------------------------------------------------------------ agents

export const ROLES = ["manager", "brief_writer", "worker", "reviewer", "security", "minutes"] as const;
export const Role = z.enum(ROLES);
export type Role = z.infer<typeof Role>;

export const ModelTier = z.enum(["haiku", "sonnet", "opus", "local"]);
export type ModelTier = z.infer<typeof ModelTier>;

export const NetworkPolicy = z.enum(["never", "ask", "allowlist"]);

export const AgentTool = z.object({ name: z.string(), requires_approval: z.boolean().default(false) });

export const AgentPermissions = z.object({
  network: NetworkPolicy.default("never"),
  network_allowlist: z.array(z.string()).default([]),
  lakehouse_read: z.boolean().default(false),
  github_push: z.boolean().default(false),
  sandbox_mem_mb: z.number().int().min(256).max(2048).default(1024),
});
export type AgentPermissions = z.infer<typeof AgentPermissions>;

export const AgentLimits = z.object({
  max_turns: z.number().int().min(1).max(200).default(30),
  max_tokens: z.number().int().min(256).max(64_000).default(4096),
  compact_at_tokens: z.number().int().min(4_000).default(60_000),
  run_budget_usd: z.number().min(0).default(1),
  day_budget_usd: z.number().min(0).optional(),
});
export type AgentLimits = z.infer<typeof AgentLimits>;

export const AgentVersionInput = z.object({
  model: z.string().min(1),
  fallback_model: z.string().nullable().default(null),
  system_prompt: z.string().min(1),
  tools: z.array(AgentTool).default([]),
  skills: z.array(z.string()).default([]),
  permissions: AgentPermissions.prefault({}),
  limits: AgentLimits.prefault({}),
  change_note: z.string().optional(),
});
export type AgentVersionInput = z.infer<typeof AgentVersionInput>;

// ------------------------------------------------------------------ plans

export const PlanCard = z.object({
  key: z.string().min(1).describe("stable key within the plan, e.g. 'm1-c2'"),
  title: z.string().min(3).max(120),
  kind: z.enum(["code", "data", "research", "ops"]).default("code"),
  description: z.string().min(1),
  acceptance_criteria: z.array(z.string()).min(1),
  depends_on: z.array(z.string()).default([]),
  priority: z.enum(["low", "medium", "high", "urgent"]).default("medium"),
});
export type PlanCard = z.infer<typeof PlanCard>;

export const PlanContent = z.object({
  summary: z.string(),
  assumptions: z.array(z.string()).default([]),
  milestones: z.array(z.object({ title: z.string(), cards: z.array(PlanCard).min(1) })).min(1),
});
export type PlanContent = z.infer<typeof PlanContent>;

// ------------------------------------------------------------------ decisions (System One)

export const DECISION_TYPES = ["route_card", "triage", "risk_class", "meeting_open_questions", "should_meet", "finding_triage"] as const;
export type DecisionType = (typeof DECISION_TYPES)[number];

export const DecisionOutputs = {
  route_card: z.object({ role: z.enum(["dev", "data", "research", "ops"]), model_tier: z.enum(["haiku", "sonnet"]) }),
  triage: z.object({ priority: z.enum(["low", "medium", "high", "urgent"]), needs_approval: z.boolean() }),
  risk_class: z.object({ risk: z.enum(["low", "medium", "high"]) }),
  meeting_open_questions: z.object({ open_questions: z.enum(["yes", "no"]) }),
  should_meet: z.object({ meet: z.enum(["yes", "no"]) }),
  finding_triage: z.object({ verdict: z.enum(["real", "false_positive", "needs_human"]) }),
} satisfies Record<DecisionType, z.ZodTypeAny>;

export type DecisionOutput<T extends DecisionType> = z.infer<(typeof DecisionOutputs)[T]>;

/** Confidence thresholds and safe defaults (§8.6). */
export const DECISION_POLICY: { [T in DecisionType]: { accept: (o: DecisionOutput<T>, confidence: number) => boolean; fallback: DecisionOutput<T> | null } } = {
  route_card: { accept: (_o, c) => c >= 0.7, fallback: null /* the manager decides */ },
  triage: { accept: (_o, c) => c >= 0.7, fallback: { priority: "medium", needs_approval: true } },
  risk_class: { accept: (_o, c) => c >= 0.8, fallback: { risk: "high" } },
  meeting_open_questions: { accept: (o, c) => o.open_questions === "no" ? c >= 0.85 : true, fallback: { open_questions: "yes" } },
  should_meet: { accept: (o, c) => o.meet === "yes" ? c >= 0.8 : true, fallback: { meet: "no" } },
  finding_triage: { accept: (_o, c) => c >= 0.8, fallback: { verdict: "needs_human" } },
};

// ------------------------------------------------------------------ meetings

export const MeetingUpdate = z.object({
  done: z.string(),
  next: z.string(),
  blockers: z.string(),
  questions: z.array(z.object({ to: z.string(), question: z.string() })).default([]),
});

export const MeetingQuestion = z.object({ to: z.string().min(1).describe('the agent slug it is for, or "lucas"'), question: z.string().min(1).max(2000) });
export const MeetingActionItem = z.object({
  title: z.string().min(3).max(120),
  kind: z.enum(["code", "data", "research", "ops"]).default("code"),
  priority: z.enum(["low", "medium", "high", "urgent"]).default("medium"),
  assignee: z.string().nullable().optional().describe("agent slug that should do it"),
  description: z.string().max(4000).optional(),
});

/**
 * One participant's turn in a meeting round (scope §9): round 1 is an update
 * (done, next, blockers); later rounds answer the questions addressed to you.
 * Any round may ask questions and propose action items (they become cards).
 */
export const MeetingTurn = z.object({
  done: z.string().max(4000).optional(),
  next: z.string().max(4000).optional(),
  blockers: z.string().max(4000).optional(),
  answers: z.array(z.object({ to: z.string(), question: z.string().max(2000), answer: z.string().max(4000) })).max(10).default([]),
  questions: z.array(MeetingQuestion).max(5).default([]),
  action_items: z.array(MeetingActionItem).max(10).default([]),
  text: z.string().max(8000).optional().describe("anything else to say"),
});
export type MeetingTurn = z.infer<typeof MeetingTurn>;

export const MeetingMinutes = z.object({
  minutes: z.string().describe("markdown: decisions, agreements, unresolved items"),
  action_items: z.array(MeetingActionItem).max(20).default([]),
});

// ------------------------------------------------------------------ review

export const ReviewOutput = z.object({
  verdict: z.enum(["approve", "request_changes"]),
  summary: z.string(),
  criteria: z.array(z.object({ criterion: z.string(), met: z.boolean() })).default([]),
  comments: z.array(z.object({ file: z.string(), line: z.number().int().optional(), comment: z.string() })).default([]),
});
export type ReviewOutput = z.infer<typeof ReviewOutput>;

// ------------------------------------------------------------------ API payloads

export const ProjectCreate = z.object({
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]{1,38}$/),
  name: z.string().min(1).max(80),
  description: z.string().optional(),
  repo_full_name: z.string().regex(/^[\w.-]+\/[\w.-]+$/).nullable().optional(),
});

export const CardCreate = z.object({
  title: z.string().min(3).max(120),
  kind: z.enum(["code", "data", "research", "ops"]).default("code"),
  brief: z.string().optional(),
  acceptance_criteria: z.array(z.string()).default([]),
  priority: z.enum(["low", "medium", "high", "urgent"]).default("medium"),
});

export const CardPatch = z.object({
  status: z.enum(["backlog", "ready", "in_progress", "checks", "in_review", "pr_open", "blocked", "done"]).optional(),
  blocked_reason: z.enum(["needs_input", "budget", "approval", "failed"]).optional(),
  priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
  assignee_agent_id: z.string().uuid().nullable().optional(),
});
