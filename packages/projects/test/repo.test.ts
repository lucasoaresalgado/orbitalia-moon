import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { simpleGit } from "simple-git";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MergeConflict, ProjectRepos } from "../src/repo.ts";

let root: string;
let repos: ProjectRepos;
const p = { slug: "demo", repo: null, baseBranch: "main" };

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "miniasys-repos-"));
  repos = new ProjectRepos(join(root, "projects"));
});
afterAll(() => rm(root, { recursive: true, force: true }));

describe("project folders", () => {
  it("creates a repository with a first commit, once", async () => {
    const dir = await repos.ensure(p);
    expect(dir).toBe(join(root, "projects", "demo"));
    await repos.ensure(p);
    expect((await repos.log("demo")).map((c) => c.message)).toEqual(["project created"]);
  });

  it("writes, moves and deletes files as commits by their actor", async () => {
    const w = await repos.write("demo", "scripts/hello.py", "def main():\n    return 1\n", { actor: "agent:cc", message: "add hello" });
    expect(w.sha).toMatch(/^[0-9a-f]{40}$/);
    expect((await repos.read("demo", "scripts/hello.py")).content).toContain("return 1");
    expect((await repos.write("demo", "scripts/hello.py", "def main():\n    return 1\n", { actor: "user" })).sha).toBeNull();
    await repos.move("demo", "scripts/hello.py", "scripts/hi.py", { actor: "user" });
    expect((await repos.list("demo")).map((e) => e.path)).toEqual(["README.md", "scripts", "scripts/hi.py"]);
    const [last] = await repos.log("demo", "scripts/hi.py", 1);
    expect(last?.author).toBe("user");
    await repos.remove("demo", "scripts", { actor: "user" });
    expect((await repos.list("demo")).map((e) => e.path)).toEqual(["README.md"]);
    // the old version is still readable
    expect((await repos.read("demo", "scripts/hello.py", w.sha!)).content).toContain("return 1");
  });

  it("refuses stale writes, .git, escapes and symlinks out", async () => {
    const a = await repos.write("demo", "a.txt", "1", { actor: "user" });
    await repos.write("demo", "a.txt", "2", { actor: "user" });
    await expect(repos.write("demo", "a.txt", "3", { actor: "user", baseSha: a.sha! })).rejects.toThrow(/changed since/);
    await expect(repos.write("demo", "../x.txt", "x", { actor: "user" })).rejects.toThrow(/outside/);
    await expect(repos.write("demo", ".git/config", "x", { actor: "user" })).rejects.toThrow(/\.git/);
    await symlink("/etc", join(root, "projects", "demo", "etc"));
    await expect(repos.read("demo", "etc/passwd")).rejects.toThrow(/outside/);
    await rm(join(root, "projects", "demo", "etc"));
    expect(() => repos.dirOf("../evil")).toThrow(/slug/);
  });

  it("merges a card branch from its workspace, and leaves nothing behind on a conflict", async () => {
    const ws = join(root, "ws");
    const g = repos.git(root, { allowFile: true });
    await g.clone(repos.dirOf("demo"), ws);
    const w = simpleGit(ws);
    await w.addConfig("user.name", "t").addConfig("user.email", "t@t");
    await w.checkoutLocalBranch("agent/demo-1-x");
    await (await import("node:fs/promises")).writeFile(join(ws, "feature.txt"), "feature");
    await w.add(["-A"]).commit("feature");
    await repos.mergeFrom("demo", ws, "agent/demo-1-x", { actor: "user", message: "Merge demo#1" });
    expect((await repos.read("demo", "feature.txt")).content).toBe("feature");

    await (await import("node:fs/promises")).writeFile(join(ws, "a.txt"), "card");
    await w.add(["-A"]).commit("conflicting");
    await repos.write("demo", "a.txt", "main", { actor: "user" });
    await expect(repos.mergeFrom("demo", ws, "agent/demo-1-x", { actor: "user", message: "m" })).rejects.toBeInstanceOf(MergeConflict);
    expect((await simpleGit(repos.dirOf("demo")).status()).isClean()).toBe(true);
    expect((await repos.read("demo", "a.txt")).content).toBe("main");
  });

  it("serializes concurrent writes", async () => {
    await Promise.all(Array.from({ length: 8 }, (_, i) => repos.write("demo", `many/${i}.txt`, String(i), { actor: "user" })));
    expect((await repos.list("demo", "many")).length).toBe(8);
  });
});
