// Card workspaces (scope §11, §26): one git clone per card on the SSD, on the
// card's agent/* branch, reused across the card's runs. Cloned from the
// project's own folder (its code in Orbitalia Moon); a reviewed card is merged back
// into it, or pushed to GitHub for a PR when the project mirrors a repository.
// git runs on the host with hooks, fsmonitor and credential storage off; tokens
// go in a per-command header and are never written to .git/config.
import { mkdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { simpleGit, type SimpleGit } from "simple-git";
import { isAgentBranch } from "@miniasys/core";
import type { ProjectRepos } from "@miniasys/projects";
import { ConfigError } from "./errors.ts";

const SAFE = ["core.hooksPath=/dev/null", "core.fsmonitor=false", "credential.helper=", "protocol.file.allow=never", "core.sshCommand=false"];
const BOT = { name: "miniasys[bot]", email: "miniasys-bot@users.noreply.github.com" };

export interface CardRef {
  id: string;
  number: number;
  branch: string;
  projectSlug: string;
  repo: string | null;
  baseBranch: string;
}

export class Workspaces {
  constructor(
    private root: string,
    private token: (() => Promise<string>) | null,
    private repos: ProjectRepos,
  ) {}

  pathOf(cardId: string) {
    return join(this.root, cardId);
  }

  private git(dir: string, token?: string, allowFile = false): SimpleGit {
    const config = SAFE.map((c) => (allowFile && c.startsWith("protocol.file.allow") ? "protocol.file.allow=always" : c));
    if (token) config.push(`http.extraHeader=AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`);
    // simple-git guards these keys against untrusted values; ours are fixed hardening constants (hooks, fsmonitor,
    // credential helper and ssh off; file protocol refused), so exactly these are allowed
    return simpleGit({
      baseDir: dir,
      config,
      timeout: { block: 120_000 },
      unsafe: { allowUnsafeHooksPath: true, allowUnsafeFsMonitor: true, allowUnsafeCredentialHelper: true, allowUnsafeSshCommand: true, allowUnsafeProtocolOverride: true },
    });
  }

  /** Creates the workspace: a clone of the project folder on the card branch (the folder synced with GitHub first, when linked). */
  async ensure(card: CardRef): Promise<string> {
    const dir = this.pathOf(card.id);
    const exists = await stat(join(dir, ".git")).then(() => true, () => false);
    if (exists) return dir;
    const project = { slug: card.projectSlug, repo: card.repo, baseBranch: card.baseBranch };
    const folder = await this.repos.ensure(project);
    // a linked project's folder follows GitHub's base branch (a failure here is not fatal: the folder is still the code)
    if (card.repo) await this.repos.syncFromGitHub(project).catch(() => {});
    await mkdir(this.root, { recursive: true });
    try {
      await this.git(this.root, undefined, true).clone(folder, dir, ["--no-tags"]);
    } catch (e) {
      await rm(dir, { recursive: true, force: true });
      throw e;
    }
    const g = this.git(dir);
    await g.addConfig("user.name", BOT.name).addConfig("user.email", BOT.email);
    // the card's branch may already exist on GitHub (pushed by an earlier workspace)
    if (card.repo) {
      const token = this.token ? await this.token().catch(() => undefined) : undefined;
      const gh = this.git(dir, token);
      const remote = await gh.listRemote(["--heads", this.githubUrl(card.repo), card.branch]).catch(() => "");
      if (remote.trim()) {
        await gh.raw(["fetch", "--no-tags", this.githubUrl(card.repo), `${card.branch}:refs/heads/${card.branch}`]);
        await g.checkout(card.branch);
        return dir;
      }
    }
    await g.checkout(["-B", card.branch, `origin/${card.baseBranch}`]);
    return dir;
  }

  private githubUrl(repo: string) {
    return `https://github.com/${repo}.git`;
  }

  /** The base the card is compared against: the folder's base branch (origin), or the local one for older workspaces. */
  private async base(g: SimpleGit, card: CardRef) {
    const remote = await g.raw(["rev-parse", "--verify", "--quiet", `origin/${card.baseBranch}`]).then((r) => !!r.trim(), () => false);
    return remote ? `origin/${card.baseBranch}` : card.baseBranch;
  }

  /** Merges the card's branch into the project folder's base branch (after Lucas approves). */
  async merge(card: CardRef, actor: string) {
    return this.repos.mergeFrom(card.projectSlug, this.pathOf(card.id), card.branch, { actor, message: `Merge p/${card.projectSlug}#${card.number} (${card.branch})` });
  }

  /** Whether the card changed anything against its base. */
  async changed(card: CardRef): Promise<boolean> {
    const g = this.git(this.pathOf(card.id));
    const out = await g.raw(["rev-list", "--count", `${await this.base(g, card)}..HEAD`]).catch(() => "0");
    return Number(out.trim()) > 0;
  }

  async commit(card: CardRef, runId: string, message: string): Promise<{ sha: string | null; files: number }> {
    const g = this.git(this.pathOf(card.id));
    await g.add(["-A"]);
    const status = await g.status();
    if (!status.staged.length && !status.created.length && !status.deleted.length && !status.renamed.length && !status.modified.length) return { sha: null, files: 0 };
    const r = await g.commit(`${message.trim()}\n\nCard: p/${card.projectSlug}#${card.number}\nRun: ${runId}`);
    return { sha: r.commit || (await g.revparse(["HEAD"])), files: r.summary.changes };
  }

  /** The change against the base branch: stats, touched paths and the diff text. */
  async diff(card: CardRef): Promise<{ stat: string; files: string[]; text: string; insertions: number; deletions: number }> {
    const g = this.git(this.pathOf(card.id));
    const base = await this.base(g, card);
    const summary = await g.diffSummary([`${base}...HEAD`]);
    const text = await g.diff([`${base}...HEAD`]);
    return {
      stat: summary.files.map((f) => `${f.file} ${"insertions" in f ? `+${f.insertions} -${f.deletions}` : "(binary)"}`).join("\n"),
      files: summary.files.map((f) => f.file),
      text,
      insertions: summary.insertions,
      deletions: summary.deletions,
    };
  }

  async push(card: CardRef): Promise<void> {
    if (!isAgentBranch(card.branch)) throw new Error(`refusing to push ${card.branch}: agents push only to agent/*`);
    if (!card.repo) throw new Error("no repository to push to");
    if (!this.token) throw new ConfigError("the GitHub App isn't configured, so the branch can't be pushed (Settings → Connections)");
    const g = this.git(this.pathOf(card.id), await this.token());
    // origin is the project folder; GitHub is pushed to by URL, and only agent/* branches
    await g.push(this.githubUrl(card.repo), `HEAD:refs/heads/${card.branch}`, ["--force"]);
  }

  async remove(cardId: string) {
    await rm(this.pathOf(cardId), { recursive: true, force: true });
  }
}
