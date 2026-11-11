// The card state machine (scope §8.7). Every status change goes through
// `transition`, so the worker, the web app and Lucas's drags obey the same rules.

export const CARD_STATUSES = ["backlog", "ready", "in_progress", "checks", "in_review", "pr_open", "blocked", "done"] as const;
export type CardStatus = (typeof CARD_STATUSES)[number];

export const BLOCKED_REASONS = ["needs_input", "budget", "approval", "failed"] as const;
export type BlockedReason = (typeof BLOCKED_REASONS)[number];

export type CardKind = "code" | "data" | "research" | "ops";

/** Board columns: blocked cards stay in the column they were blocked from (§18.5 Board). */
export const BOARD_COLUMNS = [
  { id: "backlog", label: "Backlog", statuses: ["backlog"] },
  { id: "ready", label: "Ready", statuses: ["ready"] },
  { id: "in_progress", label: "In progress", statuses: ["in_progress"] },
  { id: "review", label: "Checks/Review", statuses: ["checks", "in_review"] },
  { id: "pr_open", label: "PR open", statuses: ["pr_open"] },
  { id: "done", label: "Done", statuses: ["done"] },
] as const satisfies readonly { id: string; label: string; statuses: readonly CardStatus[] }[];

const EDGES: Record<CardStatus, readonly CardStatus[]> = {
  backlog: ["ready"],
  ready: ["in_progress", "backlog"],
  in_progress: ["checks", "blocked"],
  checks: ["in_progress", "in_review", "blocked"],
  in_review: ["in_progress", "pr_open", "done", "blocked"],
  pr_open: ["in_progress", "done", "blocked"],
  blocked: ["in_progress", "ready"],
  done: [],
};

export interface TransitionContext {
  kind: CardKind;
  /** a manual move by Lucas on the board: may go anywhere except into done for a code card with an open PR */
  actor: "user" | "agent" | "system";
  blockedReason?: BlockedReason;
  /** the number of review loops so far */
  reviewLoops?: number;
  /** false when the project has no repository: a code card can't open a PR, so it finishes like a non-code card */
  hasRepo?: boolean;
}

export class InvalidTransition extends Error {
  constructor(readonly from: CardStatus, readonly to: CardStatus, reason: string) {
    super(`card can't go from ${from} to ${to}: ${reason}`);
  }
}

export const MAX_REVIEW_LOOPS = 3;

export interface Transition {
  to: CardStatus;
  blockedReason: BlockedReason | null;
}

/**
 * Checks a status change and returns the resulting status. Rules beyond the edges:
 * - a code card reaches done only from pr_open (merged by Lucas, detected by polling);
 * - a non-code card goes in_review → done; never to pr_open;
 * - blocked needs a reason;
 * - after MAX_REVIEW_LOOPS review loops, "changes requested" becomes blocked/needs_input.
 */
export function transition(from: CardStatus, to: CardStatus, ctx: TransitionContext): Transition {
  const viaPr = ctx.kind === "code" && ctx.hasRepo !== false;
  if (from === to) return { to, blockedReason: to === "blocked" ? (ctx.blockedReason ?? null) : null };
  if (to === "blocked") {
    if (!ctx.blockedReason) throw new InvalidTransition(from, to, "a blocked card needs a reason");
    if (from === "done") throw new InvalidTransition(from, to, "done is final");
    return { to, blockedReason: ctx.blockedReason };
  }
  if (ctx.actor === "user") {
    // Lucas may drag cards between columns, but the merge rule still holds
    if (to === "done" && viaPr && from !== "pr_open") throw new InvalidTransition(from, to, "a code card is done when its PR is merged");
    if (to === "pr_open" && !viaPr) throw new InvalidTransition(from, to, "only code cards with a repository open pull requests");
    return { to, blockedReason: null };
  }
  if (!EDGES[from].includes(to)) throw new InvalidTransition(from, to, "not an allowed step");
  if (from === "in_review" && to === "pr_open" && !viaPr) throw new InvalidTransition(from, to, "only code cards with a repository open pull requests");
  if (from === "in_review" && to === "done" && viaPr) throw new InvalidTransition(from, to, "a code card goes through a pull request");
  if (from === "in_review" && to === "in_progress" && (ctx.reviewLoops ?? 0) >= MAX_REVIEW_LOOPS) return { to: "blocked", blockedReason: "needs_input" };
  return { to, blockedReason: null };
}

export function columnOf(status: CardStatus, previous?: CardStatus | null): (typeof BOARD_COLUMNS)[number]["id"] {
  const s = status === "blocked" ? (previous ?? "in_progress") : status;
  return BOARD_COLUMNS.find((c) => (c.statuses as readonly CardStatus[]).includes(s))?.id ?? "backlog";
}
