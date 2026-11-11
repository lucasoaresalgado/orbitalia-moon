// The GitHub App (scope §11): installation tokens for git, pull requests, and
// polling their state (the laptop can't receive webhooks).
import { App } from "@octokit/app";

export interface PullState {
  number: number;
  url: string;
  state: "open" | "closed";
  merged: boolean;
  /** reviews asking for changes, newest last */
  changesRequested: { id: number; body: string; submittedAt: string }[];
  comments: { path: string; line: number | null; body: string }[];
}

export class GitHub {
  private app: App;
  private token: { value: string; expires: number } | null = null;

  constructor(private cfg: { appId: string; privateKey: string; installationId: number }) {
    this.app = new App({ appId: cfg.appId, privateKey: cfg.privateKey });
  }

  private async octokit() {
    return this.app.getInstallationOctokit(this.cfg.installationId);
  }

  /** A short-lived installation token for git over HTTPS (never written to disk). */
  async gitToken(): Promise<string> {
    if (this.token && this.token.expires - Date.now() > 5 * 60_000) return this.token.value;
    const r = await this.app.octokit.request("POST /app/installations/{installation_id}/access_tokens", { installation_id: this.cfg.installationId });
    this.token = { value: r.data.token, expires: new Date(r.data.expires_at).getTime() };
    return r.data.token;
  }

  async defaultBranch(repo: string): Promise<string> {
    const [owner, name] = repo.split("/") as [string, string];
    const ok = await this.octokit();
    return (await ok.request("GET /repos/{owner}/{repo}", { owner, repo: name })).data.default_branch;
  }

  /** Opens the card's PR, or returns the open one for the branch (idempotent). */
  async openPullRequest(repo: string, o: { head: string; base: string; title: string; body: string }): Promise<{ number: number; url: string }> {
    const [owner, name] = repo.split("/") as [string, string];
    const ok = await this.octokit();
    const existing = await ok.request("GET /repos/{owner}/{repo}/pulls", { owner, repo: name, head: `${owner}:${o.head}`, state: "open" });
    const pr = existing.data[0];
    if (pr) {
      await ok.request("PATCH /repos/{owner}/{repo}/pulls/{pull_number}", { owner, repo: name, pull_number: pr.number, body: o.body });
      return { number: pr.number, url: pr.html_url };
    }
    const r = await ok.request("POST /repos/{owner}/{repo}/pulls", { owner, repo: name, head: o.head, base: o.base, title: o.title, body: o.body });
    return { number: r.data.number, url: r.data.html_url };
  }

  async pullState(repo: string, number: number): Promise<PullState> {
    const [owner, name] = repo.split("/") as [string, string];
    const ok = await this.octokit();
    const pr = (await ok.request("GET /repos/{owner}/{repo}/pulls/{pull_number}", { owner, repo: name, pull_number: number })).data;
    const reviews = (await ok.request("GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews", { owner, repo: name, pull_number: number, per_page: 100 })).data;
    const comments = (await ok.request("GET /repos/{owner}/{repo}/pulls/{pull_number}/comments", { owner, repo: name, pull_number: number, per_page: 100 })).data;
    return {
      number,
      url: pr.html_url,
      state: pr.state as "open" | "closed",
      merged: !!pr.merged_at,
      changesRequested: reviews.filter((r) => r.state === "CHANGES_REQUESTED").map((r) => ({ id: Number(r.id), body: r.body ?? "", submittedAt: r.submitted_at ?? "" })),
      comments: comments.map((c) => ({ path: c.path, line: c.line ?? null, body: c.body })),
    };
  }

  async health(): Promise<{ ok: boolean; error?: string }> {
    try {
      await this.app.octokit.request("GET /app");
      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }
}
