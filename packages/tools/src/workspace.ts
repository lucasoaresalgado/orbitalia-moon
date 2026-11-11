// Workspace tools: files (run in the worker, confined), commands (run in a
// sandbox container), commits (git on the host, hooks off).
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { z } from "zod";
import { confine, PathDenied } from "./confine.ts";
import { defineTool, type ToolContext, type ToolOutcome } from "./registry.ts";

const MAX_READ = 200_000;
const err = (content: string): ToolOutcome => ({ content, summary: content.slice(0, 120), isError: true });

function ws(ctx: ToolContext): string {
  if (!ctx.workspace) throw new Error("this agent has no workspace");
  return ctx.workspace;
}

async function guarded(f: () => Promise<ToolOutcome>): Promise<ToolOutcome> {
  try {
    return await f();
  } catch (e) {
    if (e instanceof PathDenied) return err(e.message);
    return err((e as Error).message);
  }
}

export const listFiles = defineTool({
  name: "list_files",
  description: "List files and folders under a path in the card workspace (default: the root). Skips .git and node_modules.",
  input: z.object({ path: z.string().default("."), depth: z.number().int().min(1).max(5).default(2) }),
  risk: "low",
  execute: (i, ctx) =>
    guarded(async () => {
      const root = ws(ctx);
      const start = await confine(root, i.path);
      const out: string[] = [];
      const walk = async (dir: string, d: number) => {
        for (const e of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
          if (e.name === ".git" || e.name === "node_modules") continue;
          const p = join(dir, e.name);
          out.push(relative(root, p) + (e.isDirectory() ? "/" : ""));
          if (out.length > 1000) return;
          if (e.isDirectory() && d > 1) await walk(p, d - 1);
        }
      };
      await walk(start, i.depth);
      return { content: out.join("\n") || "(empty)", summary: `${out.length} entries`, untrusted: true };
    }),
});

export const readFileTool = defineTool({
  name: "read_file",
  description: "Read a text file from the card workspace. Optionally a line range (1-based, inclusive).",
  input: z.object({ path: z.string(), start_line: z.number().int().min(1).optional(), end_line: z.number().int().min(1).optional() }),
  risk: "low",
  execute: (i, ctx) =>
    guarded(async () => {
      const p = await confine(ws(ctx), i.path);
      if ((await stat(p)).size > 5_000_000) return err("file is larger than 5 MB");
      let text = await readFile(p, "utf8");
      if (i.start_line || i.end_line) {
        const lines = text.split("\n");
        text = lines.slice((i.start_line ?? 1) - 1, i.end_line ?? lines.length).map((l, n) => `${n + (i.start_line ?? 1)}\t${l}`).join("\n");
      }
      const cut = text.length > MAX_READ;
      return { content: cut ? `${text.slice(0, MAX_READ)}\n…[truncated: read a line range]` : text, summary: `${i.path} (${text.length} chars)`, untrusted: true };
    }),
});

export const writeFileTool = defineTool({
  name: "write_file",
  description: "Create or overwrite a file in the card workspace with the given content.",
  input: z.object({ path: z.string(), content: z.string() }),
  risk: "low",
  execute: (i, ctx) =>
    guarded(async () => {
      const p = await confine(ws(ctx), i.path, { write: true });
      await mkdir(dirname(p), { recursive: true });
      await writeFile(p, i.content);
      return { content: `wrote ${i.path} (${i.content.length} chars)`, summary: `wrote ${i.path}` };
    }),
});

export const editFileTool = defineTool({
  name: "edit_file",
  description: "Replace an exact string in a workspace file. old_string must occur exactly once unless replace_all is true.",
  input: z.object({ path: z.string(), old_string: z.string().min(1), new_string: z.string(), replace_all: z.boolean().default(false) }),
  risk: "low",
  execute: (i, ctx) =>
    guarded(async () => {
      const p = await confine(ws(ctx), i.path, { write: true });
      const text = await readFile(p, "utf8");
      const count = text.split(i.old_string).length - 1;
      if (count === 0) return err(`old_string not found in ${i.path}`);
      if (count > 1 && !i.replace_all) return err(`old_string occurs ${count} times in ${i.path}; add context or set replace_all`);
      await writeFile(p, i.replace_all ? text.split(i.old_string).join(i.new_string) : text.replace(i.old_string, () => i.new_string));
      return { content: `edited ${i.path} (${i.replace_all ? count : 1} replacement${count > 1 && i.replace_all ? "s" : ""})`, summary: `edited ${i.path}` };
    }),
});

export const runInSandbox = defineTool({
  name: "run_in_sandbox",
  description:
    "Run a shell command in a fresh isolated container with the card workspace at /workspace. No network unless network=true (which may need approval). Returns exit code and the tail of stdout/stderr.",
  input: z.object({ command: z.string().min(1), timeout_s: z.number().int().min(5).max(1800).default(300), network: z.boolean().default(false) }),
  risk: "medium",
  needsApproval: (i, ctx) => i.network && ctx.permissions.network === "ask",
  execute: (i, ctx) =>
    guarded(async () => {
      if (!ctx.sandbox) return err("sandboxes are not available");
      if (i.network && ctx.permissions.network === "never") return err("network access is not allowed for this agent");
      const r = await ctx.sandbox.run(i.command, { timeoutS: i.timeout_s, network: i.network });
      const head = r.timedOut ? `timed out after ${i.timeout_s}s` : `exit code ${r.exitCode}`;
      return {
        content: `${head} (${(r.durationMs / 1000).toFixed(1)}s)\n--- stdout\n${r.stdoutTail}\n--- stderr\n${r.stderrTail}`,
        summary: `${i.command.slice(0, 60)} → ${head}`,
        isError: r.timedOut || r.exitCode !== 0,
        untrusted: true,
      };
    }),
});

export const gitCommit = defineTool({
  name: "git_commit",
  description: "Stage every change in the workspace and commit it on the card branch with the given message.",
  input: z.object({ message: z.string().min(3).max(2000) }),
  risk: "low",
  execute: (i, ctx) =>
    guarded(async () => {
      if (!ctx.git) return err("this card has no repository");
      const r = await ctx.git.commit(i.message);
      if (!r.sha) return { content: "nothing to commit", summary: "nothing to commit" };
      return { content: `committed ${r.sha.slice(0, 10)} (${r.files} files)`, summary: `commit ${r.sha.slice(0, 10)}` };
    }),
});

export const WORKSPACE_TOOLS = [listFiles, readFileTool, writeFileTool, editFileTool, runInSandbox, gitCommit];
