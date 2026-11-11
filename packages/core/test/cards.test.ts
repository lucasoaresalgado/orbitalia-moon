import { describe, expect, it } from "vitest";
import { cardBranch, columnOf, InvalidTransition, isAgentBranch, MAX_REVIEW_LOOPS, transition } from "../src/index.ts";

const agent = { kind: "code" as const, actor: "agent" as const };

describe("card state machine", () => {
  it("follows the happy path of a code card", () => {
    expect(transition("backlog", "ready", agent).to).toBe("ready");
    expect(transition("ready", "in_progress", agent).to).toBe("in_progress");
    expect(transition("in_progress", "checks", agent).to).toBe("checks");
    expect(transition("checks", "in_review", agent).to).toBe("in_review");
    expect(transition("in_review", "pr_open", agent).to).toBe("pr_open");
    expect(transition("pr_open", "done", agent).to).toBe("done");
  });

  it("refuses skipping steps and leaving done", () => {
    expect(() => transition("backlog", "in_review", agent)).toThrow(InvalidTransition);
    expect(() => transition("done", "in_progress", agent)).toThrow(InvalidTransition);
  });

  it("sends a code card through a PR and a non-code card straight to done", () => {
    expect(() => transition("in_review", "done", agent)).toThrow(/pull request/);
    expect(transition("in_review", "done", { kind: "research", actor: "agent" }).to).toBe("done");
    expect(() => transition("in_review", "pr_open", { kind: "data", actor: "agent" })).toThrow(/only code cards/);
    expect(transition("in_review", "done", { ...agent, hasRepo: false }).to).toBe("done");
  });

  it("needs a reason to block", () => {
    expect(() => transition("in_progress", "blocked", agent)).toThrow(/reason/);
    expect(transition("in_progress", "blocked", { ...agent, blockedReason: "budget" })).toEqual({ to: "blocked", blockedReason: "budget" });
  });

  it("blocks for input after too many review loops", () => {
    expect(transition("in_review", "in_progress", { ...agent, reviewLoops: MAX_REVIEW_LOOPS })).toEqual({ to: "blocked", blockedReason: "needs_input" });
    expect(transition("in_review", "in_progress", { ...agent, reviewLoops: 1 }).to).toBe("in_progress");
  });

  it("lets Lucas drag anywhere except marking an unmerged code card done", () => {
    expect(transition("backlog", "in_review", { kind: "code", actor: "user" }).to).toBe("in_review");
    expect(() => transition("in_progress", "done", { kind: "code", actor: "user" })).toThrow(/merged/);
    expect(transition("in_progress", "done", { kind: "ops", actor: "user" }).to).toBe("done");
  });

  it("keeps blocked cards in the column they came from", () => {
    expect(columnOf("blocked", "checks")).toBe("review");
    expect(columnOf("blocked")).toBe("in_progress");
    expect(columnOf("pr_open")).toBe("pr_open");
  });

  it("names branches under agent/", () => {
    const b = cardBranch("demo-app", 12, "Login página: OAuth & sessions!");
    expect(b).toBe("agent/demo-app-12-login-pagina-oauth-sessions");
    expect(isAgentBranch(b)).toBe(true);
    expect(isAgentBranch("main")).toBe(false);
    expect(isAgentBranch("agent/../main")).toBe(false);
  });
});
