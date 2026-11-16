// The project playground (a test area for a project's code): Lucas runs any
// command against a copy of the project in a sandbox, like a terminal. The copy
// persists between commands (install once, then test), and is refreshed from the
// project's code on demand. Same container profile as scripts (scope §10, §26):
// the project's variables as environment, secrets masked, storage at /storage.
import { cp, mkdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { CHANNELS } from "@miniasys/core";
import { projects, resolveVariables, runs, eq, getSetting, publish, SETTINGS, DEFAULT_SANDBOX, type SandboxSettings } from "@miniasys/db";
import type { Services } from "./services.ts";

export interface PlaygroundInput {
  command: string;
  network?: boolean;
  /** copy the project's code again before running (drops whatever the last commands changed) */
  reset?: boolean;
}

export class PlaygroundRunner {
  private running = new Map<string, AbortController>();
  constructor(private s: Services) {}

  cancel(runId: string) {
    this.running.get(runId)?.abort();
  }

  /** where a project's playground copy lives on the host */
  dirOf(slug: string) {
    return join(this.s.config.workspacesDir, `playground-${slug}`);
  }

  async run(runId: string) {
    const [run] = await this.s.d.db.select().from(runs).where(eq(runs.id, runId));
    if (!run || run.kind !== "playground" || run.status !== "queued") return;
    const input = run.input as PlaygroundInput;
    const [project] = await this.s.d.db.select().from(projects).where(eq(projects.id, run.projectId!));
    const ac = new AbortController();
    this.running.set(runId, ac);
    await this.s.d.db.update(runs).set({ status: "running", startedAt: new Date() }).where(eq(runs.id, runId));
    await publish(this.s.d.sql, { topic: CHANNELS.run(runId), type: "status", data: { status: "running" } });
    const end = async (status: "succeeded" | "failed" | "canceled", o: { error?: string; summary?: string } = {}) => {
      await this.s.d.db.update(runs).set({ status, error: o.error?.slice(0, 4000) ?? null, summary: o.summary ?? null, finishedAt: new Date() }).where(eq(runs.id, runId));
      await publish(this.s.d.sql, { topic: CHANNELS.run(runId), type: "status", data: { status } });
      if (project) await publish(this.s.d.sql, { topic: `playground:${project.id}`, type: "run", data: { runId, status } });
    };
    try {
      if (!project) return await end("failed", { error: "the project no longer exists" });
      if (!this.s.sandbox) return await end("failed", { error: "sandboxes are unavailable (the container engine is unreachable)" });
      const folder = await this.s.repos.ensure({ slug: project.slug, repo: project.repoFullName, baseBranch: project.defaultBranch });
      const dir = this.dirOf(project.slug);
      const exists = await stat(dir).then(() => true, () => false);
      if (input.reset || !exists) {
        await rm(dir, { recursive: true, force: true });
        await mkdir(dir, { recursive: true });
        // the code without its git folder: the sandbox never sees the project's .git
        await cp(folder, dir, { recursive: true, filter: (src) => !src.split("/").includes(".git") });
        await this.s.journal.append(runId, { type: "log", text: `· fresh copy of p/${project.slug}`, stream: "stdout" });
      }
      const storage = join(this.s.config.storageDir, project.slug);
      await mkdir(storage, { recursive: true });
      const { env, secrets } = await resolveVariables(this.s.d, this.s.envelope, project.id);
      const settings = await getSetting<SandboxSettings>(this.s.d.db, SETTINGS.sandbox, DEFAULT_SANDBOX);

      let pending: string[] = [];
      let flushing: Promise<void> = Promise.resolve();
      const flush = () => {
        if (!pending.length) return flushing;
        const text = pending.join("\n");
        pending = [];
        flushing = flushing.then(() => this.s.journal.append(runId, { type: "log", text, stream: "stdout" }));
        return flushing;
      };
      const timer = setInterval(() => void flush(), 500);
      let r;
      try {
        r = await this.s.sandbox.stream(
          {
            runId, n: 1, workspace: dir, gitDir: false, command: input.command, image: this.s.config.sandboxImage,
            network: !!input.network, cpus: settings.cpus, memMb: settings.memMb, timeoutS: settings.timeoutS,
            mounts: [{ host: storage, container: "/storage", readOnly: false }], redact: secrets,
            env: { ...env, MINIASYS_STORAGE: "/storage", MINIASYS_PROJECT: project.slug, MINIASYS_RUN_ID: runId, HOME: "/tmp", npm_config_cache: "/workspace/.npm-cache" },
          },
          (line) => {
            pending.push(line);
            if (pending.length >= 200) void flush();
          },
          ac.signal,
        );
      } finally {
        clearInterval(timer);
        await flush();
      }
      if (r.stderr.trim()) await this.s.journal.append(runId, { type: "log", text: r.stderr.slice(-20_000), stream: "stderr" });
      await this.s.d.sql`INSERT INTO sandbox_runs (run_id, container_name, image, command, network, cpu_limit, mem_limit_mb, exit_code, timed_out, stdout_tail, stderr_tail, full_log_path, duration_ms)
        VALUES (${runId}, ${r.containerName}, ${this.s.config.sandboxImage}, ${input.command}, ${!!input.network}, ${settings.cpus}, ${settings.memMb}, ${r.exitCode}, ${r.timedOut}, ${r.stdoutTail}, ${r.stderrTail}, ${r.fullLogPath}, ${r.durationMs})`;
      if (ac.signal.aborted) return await end("canceled", { error: "canceled" });
      if (r.timedOut) return await end("failed", { error: `timed out after ${settings.timeoutS} s` });
      if (r.exitCode !== 0) return await end("failed", { error: `exit ${r.exitCode}` });
      await end("succeeded", { summary: "exit 0" });
    } catch (e) {
      await end(ac.signal.aborted ? "canceled" : "failed", { error: (e as Error).message });
    } finally {
      this.running.delete(runId);
    }
  }
}
