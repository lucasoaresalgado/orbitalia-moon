import { mkdtemp, mkdir, symlink, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { confine, PathDenied } from "../src/confine.ts";

let base: string;
let ws: string;
let outside: string;

beforeAll(async () => {
  base = await mkdtemp(join(tmpdir(), "miniasys-confine-"));
  ws = join(base, "ws");
  outside = join(base, "outside");
  await mkdir(join(ws, "src"), { recursive: true });
  await mkdir(join(ws, ".git", "hooks"), { recursive: true });
  await mkdir(outside);
  await writeFile(join(ws, "src", "a.ts"), "a");
  await writeFile(join(outside, "secret.txt"), "s");
  await symlink(join(outside, "secret.txt"), join(ws, "link-out"));
  await symlink(outside, join(ws, "dir-out"));
  await symlink(join(ws, "src", "a.ts"), join(ws, "link-in"));
  await symlink(join(ws, ".git"), join(ws, "git-alias"));
});
afterAll(() => rm(base, { recursive: true, force: true }));

describe("path confinement", () => {
  it("allows paths inside the workspace", async () => {
    expect(await confine(ws, "src/a.ts")).toBe(join(ws, "src", "a.ts"));
    expect(await confine(ws, "/workspace/src/a.ts")).toBe(join(ws, "src", "a.ts"));
    expect(await confine(ws, "link-in")).toBe(join(ws, "src", "a.ts"));
    expect(await confine(ws, "src/new/file.ts", { write: true })).toBe(join(ws, "src", "new", "file.ts"));
  });

  it("refuses ../ escapes and foreign absolute paths", async () => {
    await expect(confine(ws, "../outside/secret.txt")).rejects.toThrow(PathDenied);
    await expect(confine(ws, "src/../../outside/secret.txt")).rejects.toThrow(PathDenied);
    await expect(confine(ws, "/etc/passwd")).rejects.toThrow(/under \/workspace/);
    await expect(confine(ws, "/workspace/../etc/passwd")).rejects.toThrow(PathDenied);
  });

  it("refuses symlinks pointing out, for reads and writes", async () => {
    await expect(confine(ws, "link-out")).rejects.toThrow(/symlink/);
    await expect(confine(ws, "link-out", { write: true })).rejects.toThrow(PathDenied);
    await expect(confine(ws, "dir-out/secret.txt")).rejects.toThrow(PathDenied);
    await expect(confine(ws, "dir-out/new.txt", { write: true })).rejects.toThrow(PathDenied);
  });

  it("refuses .git, directly or through a symlink", async () => {
    await expect(confine(ws, ".git/hooks/pre-commit", { write: true })).rejects.toThrow(/\.git/);
    await expect(confine(ws, "git-alias/hooks/pre-commit", { write: true })).rejects.toThrow(/\.git/);
    await expect(confine(ws, ".git/config")).rejects.toThrow(/\.git/);
  });

  it("refuses NUL bytes and missing files on read", async () => {
    await expect(confine(ws, "src/a.ts\0x")).rejects.toThrow(/NUL/);
    await expect(confine(ws, "src/missing.ts")).rejects.toThrow(/does not exist/);
  });
});
