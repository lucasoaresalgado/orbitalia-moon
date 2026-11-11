// Card workspaces (scope §11): one git clone per card on the SSD, on the card's
// agent/* branch, reused across the card's runs. git runs on the host with
// hooks, fsmonitor and credential storage off; tokens go in a per-command
// header and are never written to .git/config.
import { mkdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { simpleGit, type SimpleGit } from "simple-git";
import { isAgentBranch } from "@miniasys/core";
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
  ) {}

  pathOf(cardId: string) {
    return join(this.root, cardId);
  }

  private git(dir: string, token?: string): SimpleGit {
    const config = [...SAFE];
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

  /** Creates the workspace (a clone on the card branch, or a plain folder for cards without a repo). */
  async ensure(card: CardRef): Promise<string> {
    const dir = this.pathOf(card.id);
    const exists = await stat(join(dir, ".git")).then(() => true, () => false);
    if (exists) return dir;
    await mkdir(dir, { recursive: true });
    if (!card.repo) {
      // still a git repo, so the sandbox's read-only .git mount and diffs work the same way
      const g = this.git(dir);
      await g.init(["-b", card.baseBranch]);
      await g.addConfig("user.name", BOT.name).addConfig("user.email", BOT.email);
      await g.commit("workspace", ["--allow-empty"]);
      await g.checkoutLocalBranch(card.branch);
      return dir;
    }
    // without the GitHub App a public repository is still cloned (anonymously); pushing needs the App later
    const token = this.token ? await this.token() : undefined;
    const url = `https://github.com/${card.repo}.git`;
    try {
      await this.git(this.root, token).clone(url, dir, ["--no-tags"]);
    } catch (e) {
      await rm(dir, { recursive: true, force: true });
      if (!token) throw new ConfigError(`can't clone ${card.repo}: it isn't public and the GitHub App isn't configured (Settings → Connections)`);
      throw e;
    }
    const g = this.git(dir, token);
    await g.addConfig("user.name", BOT.name).addConfig("user.email", BOT.email);
    const remote = await g.listRemote(["--heads", "origin", card.branch]);
    if (remote.trim()) await g.checkout(["-B", card.branch, `origin/${card.branch}`]);
    else await g.checkout(["-B", card.branch, `origin/${card.baseBranch}`]);
    return dir;
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
    const base = card.repo ? `origin/${card.baseBranch}` : card.baseBranch;
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
    await g.push("origin", `HEAD:refs/heads/${card.branch}`, ["--force-with-lease"]);
  }

  async remove(cardId: string) {
    await rm(this.pathOf(cardId), { recursive: true, force: true });
  }
}
