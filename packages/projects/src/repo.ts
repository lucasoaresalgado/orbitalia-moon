// Project code folders (scope §26): every project's code is a git repository at
// <PROJECTS_DIR>/<slug>, on its base branch, created, changed and deleted by the
// platform. Every change is a commit authored by whoever made it. Card
// workspaces are cloned from it; reviewed cards are merged back into it.
//
// git runs with the same hardening as card workspaces: hooks, fsmonitor,
// credential storage, ssh and the file protocol off (the file protocol is
// allowed for one command at a time, for clones and fetches between our own folders).
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { simpleGit, type SimpleGit } from "simple-git";
import { confine } from "@miniasys/tools";

const SAFE = ["core.hooksPath=/dev/null", "core.fsmonitor=false", "credential.helper=", "protocol.file.allow=never", "core.sshCommand=false"];
const BOT = { name: "miniasys[bot]", email: "miniasys-bot@users.noreply.github.com" };
const MAX_LIST = 5000;
const MAX_READ = 2 * 1024 * 1024;

export interface RepoProject {
  slug: string;
  /** owner/name on GitHub, when the project mirrors one */
  repo: string | null;
  baseBranch: string;
}

export interface Entry {
  path: string;
  type: "file" | "dir";
  size: number;
}

export interface Commit {
  sha: string;
  author: string;
  date: string;
  message: string;
}

export class MergeConflict extends Error {
  constructor(readonly files: string[]) {
    super(`merge conflict in ${files.join(", ") || "the project"}`);
  }
}

export class RepoError extends Error {}

/** git author for an actor (user, user:<token>, agent:<slug>, system) */
const authorOf = (actor: string) => `${actor.replace(/[<>]/g, "")} <${actor.replace(/[^a-zA-Z0-9._-]+/g, "-")}@miniasys.local>`;

export class ProjectRepos {
  private chains = new Map<string, Promise<unknown>>();

  constructor(
    readonly root: string,
    private token: (() => Promise<string>) | null = null,
  ) {}

  dirOf(slug: string) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) throw new RepoError(`bad project slug ${slug}`);
    return join(this.root, slug);
  }

  git(dir: string, o: { token?: string; allowFile?: boolean } = {}): SimpleGit {
    const config = SAFE.map((c) => (o.allowFile && c.startsWith("protocol.file.allow") ? "protocol.file.allow=always" : c));
    if (o.token) config.push(`http.extraHeader=AUTHORIZATION: basic ${Buffer.from(`x-access-token:${o.token}`).toString("base64")}`);
    return simpleGit({
      baseDir: dir,
      config,
      timeout: { block: 120_000 },
      unsafe: { allowUnsafeHooksPath: true, allowUnsafeFsMonitor: true, allowUnsafeCredentialHelper: true, allowUnsafeSshCommand: true, allowUnsafeProtocolOverride: true },
    });
  }

  /**
   * One change at a time per project in this process; and git's own index.lock
   * (the web app and the worker share the folder) is retried for a few seconds.
   */
  async locked<T>(slug: string, f: () => Promise<T>): Promise<T> {
    const prev = this.chains.get(slug) ?? Promise.resolve();
    const next = prev.catch(() => {}).then(async () => {
      for (let i = 0; ; i++) {
        try {
          return await f();
        } catch (e) {
          if (i < 20 && /index\.lock|cannot lock ref|Unable to create .*\.lock/i.test((e as Error).message)) {
            await new Promise((r) => setTimeout(r, 250));
            continue;
          }
          throw e;
        }
      }
    });
    this.chains.set(slug, next);
    try {
      return await next;
    } finally {
      if (this.chains.get(slug) === next) this.chains.delete(slug);
    }
  }

  async exists(slug: string) {
    return stat(join(this.dirOf(slug), ".git")).then(() => true, () => false);
  }

  /** The project's folder, created when missing: an empty repository, or a clone of its GitHub repository. */
  async ensure(p: RepoProject): Promise<string> {
    const dir = this.dirOf(p.slug);
    if (await this.exists(p.slug)) return dir;
    return this.locked(p.slug, async () => {
      if (await this.exists(p.slug)) return dir;
      await mkdir(this.root, { recursive: true });
      if (p.repo) {
        const token = this.token ? await this.token().catch(() => undefined) : undefined;
        try {
          await this.git(this.root, { token }).clone(`https://github.com/${p.repo}.git`, dir, ["--no-tags", "--branch", p.baseBranch]);
        } catch (e) {
          await rm(dir, { recursive: true, force: true });
          throw new RepoError(`can't clone ${p.repo}: ${(e as Error).message.split("\n")[0]}${token ? "" : " (private repositories need the GitHub App: Settings → Connections)"}`);
        }
      } else {
        await mkdir(dir, { recursive: true });
        await this.git(dir).init(["-b", p.baseBranch]);
      }
      const g = this.git(dir);
      await g.addConfig("user.name", BOT.name).addConfig("user.email", BOT.email);
      if (!p.repo) {
        await writeFile(join(dir, "README.md"), `# ${p.slug}\n\nThis project's code lives here, in Orbitalia Moon. Scripts go in \`scripts/\`.\n`);
        await g.add(["README.md"]);
        await g.commit("project created", ["--author", authorOf("system")]);
      }
      return dir;
    });
  }

  /** Files and folders under a path (recursive unless `depth` is 1), without .git. */
  async list(slug: string, path = "", o: { recursive?: boolean } = {}): Promise<Entry[]> {
    const dir = this.dirOf(slug);
    const base = path ? await confine(dir, path) : dir;
    const out: Entry[] = [];
    const walk = async (d: string) => {
      for (const name of (await readdir(d, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
        if (out.length >= MAX_LIST) return;
        if (name.name === ".git") continue;
        const full = join(d, name.name);
        const rel = relative(dir, full).split(sep).join("/");
        if (name.isDirectory()) {
          out.push({ path: rel, type: "dir", size: 0 });
          if (o.recursive !== false) await walk(full);
        } else if (name.isFile()) out.push({ path: rel, type: "file", size: (await stat(full)).size });
      }
    };
    await walk(base);
    return out;
  }

  /** A file's text (or, at `sha`, an older version of it). Binary files come back as base64. */
  async read(slug: string, path: string, sha?: string): Promise<{ path: string; content: string; encoding: "utf8" | "base64"; size: number }> {
    const dir = this.dirOf(slug);
    let buf: Buffer;
    if (sha) {
      if (!/^[0-9a-f]{4,40}$/.test(sha)) throw new RepoError("bad commit id");
      await confine(dir, path, { write: true }); // the path must be inside, even if it no longer exists
      buf = Buffer.from(await this.git(dir).raw(["show", `${sha}:${path.replace(/^\/+/, "")}`]), "binary");
    } else {
      const real = await confine(dir, path);
      if ((await stat(real)).size > MAX_READ) throw new RepoError(`${path} is larger than ${MAX_READ / 1024 / 1024} MB`);
      buf = await readFile(real);
    }
    const text = buf.toString("utf8");
    const binary = buf.includes(0) || text.includes("�");
    return { path, content: binary ? buf.toString("base64") : text, encoding: binary ? "base64" : "utf8", size: buf.length };
  }

  private async commitAll(dir: string, message: string, actor: string): Promise<string | null> {
    const g = this.git(dir);
    await g.add(["-A"]);
    const st = await g.status();
    if (st.isClean()) return null;
    await g.commit(message, ["--author", authorOf(actor)]);
    return (await g.revparse(["HEAD"])).trim();
  }

  /** Writes a file and commits it. `baseSha` (the commit the caller read) refuses to overwrite a newer change. */
  async write(slug: string, path: string, content: string | Buffer, o: { actor: string; message?: string; baseSha?: string }): Promise<{ sha: string | null }> {
    const dir = this.dirOf(slug);
    return this.locked(slug, async () => {
      const real = await confine(dir, path, { write: true });
      if (o.baseSha) {
        const last = (await this.log(slug, path, 1))[0]?.sha;
        if (last && !last.startsWith(o.baseSha) && !o.baseSha.startsWith(last)) throw new RepoError(`${path} changed since ${o.baseSha.slice(0, 8)} (now ${last.slice(0, 8)}): read it again`);
      }
      await mkdir(dirname(real), { recursive: true });
      await writeFile(real, content);
      return { sha: await this.commitAll(dir, o.message ?? `update ${path}`, o.actor) };
    });
  }

  async remove(slug: string, path: string, o: { actor: string; message?: string }): Promise<{ sha: string | null }> {
    const dir = this.dirOf(slug);
    return this.locked(slug, async () => {
      const real = await confine(dir, path, { write: true });
      if (real === dir) throw new RepoError("can't delete the project folder this way: delete the project");
      await rm(real, { recursive: true, force: true });
      return { sha: await this.commitAll(dir, o.message ?? `delete ${path}`, o.actor) };
    });
  }

  async move(slug: string, from: string, to: string, o: { actor: string; message?: string }): Promise<{ sha: string | null }> {
    const dir = this.dirOf(slug);
    return this.locked(slug, async () => {
      const src = await confine(dir, from);
      const dst = await confine(dir, to, { write: true });
      if (await stat(dst).then(() => true, () => false)) throw new RepoError(`${to} already exists`);
      await mkdir(dirname(dst), { recursive: true });
      await this.git(dir).raw(["mv", relative(dir, src), relative(dir, dst)]);
      return { sha: await this.commitAll(dir, o.message ?? `move ${from} to ${to}`, o.actor) };
    });
  }

  /** The history of the project, or of one path. */
  async log(slug: string, path?: string, limit = 50): Promise<Commit[]> {
    const dir = this.dirOf(slug);
    const args = ["log", `-n${Math.min(limit, 500)}`, "--format=%H%x1f%an%x1f%aI%x1f%s"];
    if (path) args.push("--", path.replace(/^\/+/, ""));
    const out = await this.git(dir).raw(args).catch(() => "");
    return out.split("\n").filter(Boolean).map((l) => {
      const [sha, author, date, message] = l.split("\x1f");
      return { sha: sha!, author: author!, date: date!, message: message ?? "" };
    });
  }

  /** A commit's change (optionally limited to one path). */
  async show(slug: string, sha: string, path?: string): Promise<string> {
    if (!/^[0-9a-f]{4,40}$/.test(sha)) throw new RepoError("bad commit id");
    return this.git(this.dirOf(slug)).raw(["show", "--format=%H %an %aI%n%n%B", sha, ...(path ? ["--", path] : [])]);
  }

  async head(slug: string) {
    return (await this.git(this.dirOf(slug)).revparse(["HEAD"])).trim();
  }

  /**
   * git merge, checked by the result: simple-git's raw() doesn't throw when git
   * stops on a conflict, so the status decides. A conflict is aborted (the folder
   * is left as it was) and reported with its files.
   */
  private async merge(dir: string, args: string[]) {
    let failure: Error | null = null;
    await this.git(dir).raw(["merge", ...args]).catch((e: Error) => void (failure = e));
    const st = await this.git(dir).status();
    if (st.conflicted.length || failure) {
      await this.git(dir).raw(["merge", "--abort"]).catch(() => {});
      if (st.conflicted.length) throw new MergeConflict(st.conflicted);
      throw failure!;
    }
  }

  /** Merges a card branch (from its workspace) into the project's base branch; a conflict leaves nothing behind. */
  async mergeFrom(slug: string, workspace: string, branch: string, o: { actor: string; message: string }): Promise<{ sha: string }> {
    const dir = this.dirOf(slug);
    return this.locked(slug, async () => {
      const g = this.git(dir, { allowFile: true });
      await g.raw(["fetch", workspace, `${branch}:refs/miniasys/merge`]);
      try {
        await this.merge(dir, ["--no-ff", "-m", `${o.message}\n\nApproved by ${o.actor}`, "refs/miniasys/merge"]);
      } finally {
        await this.git(dir).raw(["update-ref", "-d", "refs/miniasys/merge"]).catch(() => {});
      }
      return { sha: await this.head(slug) };
    });
  }

  /** Brings the base branch up to date with GitHub (after Lucas merges a PR there). Local commits are kept with a merge. */
  async syncFromGitHub(p: RepoProject): Promise<{ sha: string; changed: boolean }> {
    if (!p.repo) throw new RepoError("this project has no GitHub repository");
    const dir = await this.ensure(p);
    return this.locked(p.slug, async () => {
      const token = this.token ? await this.token().catch(() => undefined) : undefined;
      const before = await this.head(p.slug);
      const g = this.git(dir, { token });
      await g.raw(["fetch", "--no-tags", `https://github.com/${p.repo}.git`, `${p.baseBranch}:refs/remotes/origin/${p.baseBranch}`]);
      await this.merge(dir, ["--no-edit", `origin/${p.baseBranch}`]);
      const after = await this.head(p.slug);
      return { sha: after, changed: after !== before };
    });
  }

  /** Pushes the base branch's local work to GitHub as agent/<slug>-miniasys (never to the base branch: only Lucas merges). */
  async pushMiniasysBranch(p: RepoProject): Promise<string | null> {
    if (!p.repo || !this.token) return null;
    const token = await this.token();
    const branch = `agent/${p.slug}-miniasys`;
    await this.git(this.dirOf(p.slug), { token }).raw(["push", "--force", `https://github.com/${p.repo}.git`, `HEAD:refs/heads/${branch}`]);
    return branch;
  }

  /** Deletes the project's folder for good. */
  async destroy(slug: string) {
    await this.locked(slug, () => rm(this.dirOf(slug), { recursive: true, force: true }));
  }
}
