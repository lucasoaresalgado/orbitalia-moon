// Fetches skills from GitHub for review (scope §27). The worker holds the GitHub
// token, so it clones here: a shallow fetch of one commit with the hardened git
// config (no hooks, no credential helper, no ssh, no file protocol), then every
// folder with a SKILL.md under the asked path is checked (text only, no symlinks,
// size limits) and copied to a staging folder. Nothing is installed or run here:
// Lucas reviews the preview and installs from the staging copy.
import { createHash } from "node:crypto";
import { cp, lstat, mkdir, readFile, readdir, realpath, rm, stat } from "node:fs/promises";
import { basename, join, relative, sep } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { SCRIPT_FILE, SKILL_LIMITS, skillDomains, skillFrontmatter, skillSlug, skillWarnings } from "@miniasys/core";
import { skillImports, skillSources, eq, publish } from "@miniasys/db";
import type { Services } from "./services.ts";

const run = promisify(execFile);
const SAFE = ["core.hooksPath=/dev/null", "core.fsmonitor=false", "credential.helper=", "protocol.file.allow=never", "core.sshCommand=false", "core.symlinks=false"];

export interface FoundFile { path: string; size: number; script: boolean; skipped?: string }
export interface FoundSkill {
  key: number;
  name: string;
  path: string;
  description: string;
  skillMd: string;
  files: FoundFile[];
  warnings: { file: string; line: number; reason: string; text: string }[];
  domains: string[];
  /** a skill folder with this name exists already: local, or imported (from which repo) */
  exists: null | { source: "local" } | { source: "github"; repo: string; path: string; sha: string };
  hash: string;
  /** why it can't be installed (its SKILL.md failed the checks) */
  invalid?: string;
}

/** git's own complaint, not the command line (which holds the auth header) */
const gitError = (e: unknown) => (((e as { stderr?: string }).stderr || (e as Error).message).trim().split("\n").filter((l) => !l.includes("extraHeader")).slice(-2).join(" ")).slice(0, 300);
const isText = (b: Buffer) => !b.subarray(0, 8000).includes(0);

export class SkillFetcher {
  constructor(private s: Services) {}

  dirOf(importId: string) {
    return join(this.s.config.workspacesDir, ".skill-imports", importId);
  }

  async fetch(importId: string) {
    const [imp] = await this.s.d.db.select().from(skillImports).where(eq(skillImports.id, importId));
    if (!imp || imp.status !== "fetching") return;
    const dir = this.dirOf(importId);
    const clone = join(dir, "repo");
    const staging = join(dir, "skills");
    const done = async (patch: Partial<typeof skillImports.$inferInsert>) => {
      await this.s.d.db.update(skillImports).set(patch).where(eq(skillImports.id, importId));
      await publish(this.s.d.sql, { topic: "skills", type: "import", data: { id: importId, status: patch.status } });
    };
    try {
      await rm(dir, { recursive: true, force: true });
      await mkdir(clone, { recursive: true });
      const sha = await this.clone(imp.repo, imp.ref, clone);
      const root = await realpath(clone);
      const base = await realpath(join(clone, imp.path)).catch(() => null);
      if (!base || (base !== root && !base.startsWith(root + sep))) throw new Error(`the folder "${imp.path}" doesn't exist at ${sha.slice(0, 7)}`);
      const dirs = await this.skillDirs(base);
      if (!dirs.length) throw new Error(`no SKILL.md under ${imp.path || "the repository root"}: a skill is a folder with a SKILL.md`);
      const found: FoundSkill[] = [];
      for (const [i, d] of dirs.slice(0, SKILL_LIMITS.skills).entries()) {
        try {
          found.push(await this.check(root, d, join(staging, String(i)), i));
        } catch (e) {
          // one bad skill doesn't sink the others: shown, but not installable
          const path = relative(root, d).split(sep).join("/");
          found.push({ key: i, name: skillSlug(basename(d)), path, description: "", skillMd: "", files: [], warnings: [], domains: [], exists: null, hash: "", invalid: (e as Error).message.slice(0, 300) });
        }
      }
      await done({ status: "ready", sha, found, error: null });
    } catch (e) {
      const msg = (e as Error).message.replace(/x-access-token:[^@\s]+/g, "x-access-token:***").replace(/basic [A-Za-z0-9+/=]+/gi, "basic ***");
      await done({ status: "failed", error: msg.slice(0, 2000) });
    } finally {
      await rm(clone, { recursive: true, force: true });
    }
  }

  /** One commit of the repository, shallow; anonymous first, then with the GitHub App's token (private repos it can see). */
  private async clone(repo: string, ref: string | null, dir: string): Promise<string> {
    const attempt = async (token: string | null) => {
      const config = [...SAFE];
      if (token) config.push(`http.extraHeader=AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`);
      // git itself (no shell), hardened with -c, in an environment of our own: nothing from the
      // worker's (editors, pagers, askpass, global or system config) reaches it
      const git = (...args: string[]) =>
        run("git", [...config.flatMap((c) => ["-c", c]), ...args], {
          cwd: dir, timeout: 120_000, maxBuffer: 4 * 1024 * 1024,
          env: { PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin", HOME: dir, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0", GIT_LFS_SKIP_SMUDGE: "1", ...(process.env.HTTPS_PROXY ? { HTTPS_PROXY: process.env.HTTPS_PROXY } : {}) },
        }).then((r) => r.stdout);
      await rm(dir, { recursive: true, force: true });
      await mkdir(dir, { recursive: true });
      await git("init", "--quiet");
      await git("remote", "add", "origin", `https://github.com/${repo}.git`);
      await git("fetch", "--depth", "1", "--no-tags", "--quiet", "origin", ref ?? "HEAD");
      await git("checkout", "--quiet", "FETCH_HEAD");
      return (await git("rev-parse", "HEAD")).trim();
    };
    try {
      return await attempt(null);
    } catch (first) {
      if (!this.s.github) throw new Error(`couldn't fetch github.com/${repo}${ref ? ` at ${ref}` : ""}: it doesn't exist, is private, or the branch/tag is wrong (${gitError(first)})`);
      try {
        return await attempt(await this.s.github.gitToken());
      } catch (e) {
        throw new Error(`couldn't fetch github.com/${repo}${ref ? ` at ${ref}` : ""}, even with the GitHub App: ${gitError(e)}`);
      }
    }
  }

  /** Folders with a SKILL.md: the asked folder itself, or every one below it (not inside another skill). */
  private async skillDirs(base: string): Promise<string[]> {
    const has = async (d: string) => (await lstat(join(d, "SKILL.md")).catch(() => null))?.isFile() ?? false;
    if (await has(base)) return [base];
    const out: string[] = [];
    const walk = async (d: string, depth: number) => {
      if (depth > SKILL_LIMITS.depth || out.length >= SKILL_LIMITS.skills) return;
      for (const e of (await readdir(d, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
        if (!e.isDirectory() || e.name === ".git" || e.name === "node_modules" || e.name.startsWith(".")) continue;
        const full = join(d, e.name);
        if (await has(full)) out.push(full);
        else await walk(full, depth + 1);
      }
    };
    await walk(base, 0);
    return out;
  }

  /** Checks one skill folder and copies what passes to the staging folder. */
  private async check(root: string, dir: string, to: string, key: number): Promise<FoundSkill> {
    const files: FoundFile[] = [];
    const warnings: FoundSkill["warnings"] = [];
    let total = 0;
    let accepted = 0;
    const hash = createHash("sha256");
    let text = "";
    // SKILL.md first, so the limits never leave out the skill itself
    const main = join(dir, "SKILL.md");
    const mainStat = await lstat(main);
    if (!mainStat.isFile() || mainStat.size > SKILL_LIMITS.fileBytes) throw new Error(`${relative(root, main)}: SKILL.md must be a regular file under ${SKILL_LIMITS.fileBytes / 1024} KB`);
    await mkdir(to, { recursive: true });
    await cp(main, join(to, "SKILL.md"));
    const mainBuf = await readFile(main);
    hash.update("SKILL.md").update(mainBuf);
    total += mainStat.size;
    accepted++;
    files.push({ path: "SKILL.md", size: mainStat.size, script: false });
    text += mainBuf.toString("utf8");
    warnings.push(...skillWarnings("SKILL.md", mainBuf.toString("utf8"), 10));
    const walk = async (d: string) => {
      for (const e of (await readdir(d, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
        if (e.name === ".git" || (d === dir && e.name === "SKILL.md")) continue;
        const full = join(d, e.name);
        const rel = relative(dir, full).split(sep).join("/");
        const st = await lstat(full);
        if (st.isSymbolicLink()) { files.push({ path: rel, size: 0, script: false, skipped: "symbolic link" }); continue; }
        if (st.isDirectory()) { await walk(full); continue; }
        if (!st.isFile()) continue;
        const script = SCRIPT_FILE.test(e.name);
        if (accepted >= SKILL_LIMITS.files) { files.push({ path: rel, size: st.size, script, skipped: "too many files" }); continue; }
        if (st.size > SKILL_LIMITS.fileBytes) { files.push({ path: rel, size: st.size, script, skipped: "file too large" }); continue; }
        if (total + st.size > SKILL_LIMITS.totalBytes) { files.push({ path: rel, size: st.size, script, skipped: "skill too large" }); continue; }
        const buf = await readFile(full);
        if (!isText(buf)) { files.push({ path: rel, size: st.size, script, skipped: "binary file" }); continue; }
        await mkdir(join(to, relative(dir, d)), { recursive: true });
        await cp(full, join(to, rel));
        hash.update(rel).update(buf);
        total += st.size;
        accepted++;
        files.push({ path: rel, size: st.size, script });
        const content = buf.toString("utf8");
        text += `\n${content}`;
        warnings.push(...skillWarnings(rel, content, 10));
      }
    };
    await walk(dir);
    const skillMd = await readFile(join(dir, "SKILL.md"), "utf8");
    const fm = skillFrontmatter(skillMd);
    const name = skillSlug(fm.name ?? basename(dir));
    return {
      key, name, path: relative(root, dir).split(sep).join("/"), description: fm.description ?? "", skillMd: skillMd.slice(0, 64 * 1024),
      files, warnings: warnings.slice(0, 40), domains: skillDomains(text), exists: await this.existing(name), hash: hash.digest("hex").slice(0, 16),
    };
  }

  private async existing(name: string): Promise<FoundSkill["exists"]> {
    const [src] = await this.s.d.db.select().from(skillSources).where(eq(skillSources.name, name));
    if (src) return { source: "github", repo: src.repo, path: src.path, sha: src.sha };
    return (await stat(join(this.s.config.skillsDir, name)).catch(() => null)) ? { source: "local" } : null;
  }

  /** Staging folders of imports older than a day (installed or not). */
  async sweep() {
    const root = join(this.s.config.workspacesDir, ".skill-imports");
    for (const id of await readdir(root).catch(() => [] as string[])) {
      const st = await stat(join(root, id)).catch(() => null);
      if (st && Date.now() - st.mtimeMs > 86_400_000) await rm(join(root, id), { recursive: true, force: true });
    }
  }
}
