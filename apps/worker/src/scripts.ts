// Runs scripts (scope §26): a file under scripts/ in a project's folder, run in
// a sandbox with the folder read-only at /project, the project's storage at
// /storage, its variables (secrets opened here, and masked in everything kept),
// its dependency cache, and its arguments. A small wrapper per language calls
// main() and prints the result after a marker; Bash prints its own.
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CHANNELS } from "@miniasys/core";
import { addJournalEntry, projects, resolveVariables, runs, scripts, eq, publish } from "@miniasys/db";
import { languageOf, scriptRequirements, type Language } from "@miniasys/projects";
import { addNote } from "./knowledge.ts";
import type { Services } from "./services.ts";

const RESULT = "__MINIASYS_RESULT__";
const MAX_RESULT = 1_000_000;

const PY_WRAPPER = `
import asyncio, importlib.util, inspect, json, os, sys
args = json.loads(os.environ.get("MINIASYS_ARGS") or "{}")
path = sys.argv[1]
sys.path[:0] = [os.path.dirname(path), "/project"]
spec = importlib.util.spec_from_file_location("__miniasys_script__", path)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
res = None
if hasattr(mod, "main"):
    res = mod.main(**args)
    if inspect.isawaitable(res):
        res = asyncio.run(res)
sys.stdout.flush()
print("\\n${RESULT}" + json.dumps(res, default=str), flush=True)
`;

/** Bare imports fall back to the project's npm dependencies (/deps/node_modules); ESM ignores NODE_PATH. */
const NODE_HOOK = `export async function resolve(s, c, next) { try { return await next(s, c); } catch (e) { if (/^[./]|^node:|^file:/.test(s)) throw e; return next(s, { ...c, parentURL: "file:///deps/index.js" }); } }`;
const TS_WRAPPER = `
import { register } from "node:module";
import { pathToFileURL } from "node:url";
register("data:text/javascript," + encodeURIComponent(${JSON.stringify(NODE_HOOK)}));
const args = JSON.parse(process.env.MINIASYS_ARGS || "{}");
const order = JSON.parse(process.env.MINIASYS_ARG_ORDER || "[]");
const m = await import(pathToFileURL(process.argv[1]).href);
const f = m.main ?? m.default;
const r = typeof f === "function" ? await f(...order.map((k) => args[k])) : null;
console.log("\\n${RESULT}" + JSON.stringify(r ?? null));
`;

const shq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
const sqlLiteral = (v: unknown) => (v === null || v === undefined ? "NULL" : typeof v === "number" || typeof v === "boolean" ? String(v) : `'${(typeof v === "string" ? v : JSON.stringify(v)).replace(/'/g, "''")}'`);

export class ScriptRunner {
  private running = new Map<string, AbortController>();

  constructor(private s: Services) {}

  cancel(runId: string) {
    this.running.get(runId)?.abort();
  }

  /** A scheduled run: a new run of the script with its schedule's arguments (skipped while the last one still runs). */
  async scheduled(scriptId: string) {
    const [sc] = await this.s.d.db.select().from(scripts).where(eq(scripts.id, scriptId));
    if (!sc?.scheduleEnabled) return;
    if (sc.lastRunId) {
      const [last] = await this.s.d.db.select({ status: runs.status }).from(runs).where(eq(runs.id, sc.lastRunId));
      if (last && ["queued", "running"].includes(last.status)) {
        this.s.log.info({ script: sc.path }, "scheduled run skipped: the last one is still running");
        return;
      }
    }
    // pg-boss may deliver one cron tick twice: one scheduled run per script per tick (crons are a minute apart at least)
    const [run] = await this.s.d.sql<{ id: string }[]>`
      INSERT INTO runs (kind, project_id, status, input)
      SELECT 'script', ${sc.projectId}, 'queued', ${JSON.stringify({ scriptId: sc.id, path: sc.path, args: sc.scheduleArgs, trigger: "schedule" })}::jsonb
      WHERE NOT EXISTS (SELECT 1 FROM runs WHERE kind = 'script' AND input->>'scriptId' = ${sc.id} AND input->>'trigger' = 'schedule' AND created_at > now() - interval '45 seconds')
      RETURNING id`;
    if (!run) return;
    await this.s.d.db.update(scripts).set({ lastRunId: run.id }).where(eq(scripts.id, sc.id));
    await this.run(run.id);
  }

  async run(runId: string) {
    const [run] = await this.s.d.db.select().from(runs).where(eq(runs.id, runId));
    if (!run || run.kind !== "script" || run.status !== "queued") return;
    const input = run.input as { scriptId: string; path: string; args: Record<string, unknown>; trigger?: string };
    const [sc] = await this.s.d.db.select().from(scripts).where(eq(scripts.id, input.scriptId));
    const [project] = await this.s.d.db.select().from(projects).where(eq(projects.id, run.projectId!));
    const ac = new AbortController();
    this.running.set(runId, ac);
    await this.s.d.db.update(runs).set({ status: "running", startedAt: new Date() }).where(eq(runs.id, runId));
    await publish(this.s.d.sql, { topic: CHANNELS.run(runId), type: "status", data: { status: "running" } });
    const fail = async (error: string, extra: Partial<typeof runs.$inferInsert> = {}) => {
      await this.s.d.db.update(runs).set({ status: ac.signal.aborted ? "canceled" : "failed", error: error.slice(0, 4000), finishedAt: new Date(), ...extra }).where(eq(runs.id, runId));
      await this.finished(runId, project!, input, ac.signal.aborted ? "canceled" : "failed", error);
    };
    try {
      if (!sc || !project) return await fail("the script or its project no longer exists");
      if (!this.s.sandbox) return await fail("sandboxes are unavailable (the container engine is unreachable)");
      const lang = languageOf(sc.path);
      if (!lang) return await fail(`${sc.path}: not a script (.py, .ts, .sh or .sql)`);
      const folder = await this.s.repos.ensure({ slug: project.slug, repo: project.repoFullName, baseBranch: project.defaultBranch });
      const source = await readFile(join(folder, sc.path), "utf8").catch(() => null);
      if (source === null) return await fail(`${sc.path} doesn't exist in the project's code`);
      const storage = join(this.s.config.storageDir, project.slug);
      await mkdir(storage, { recursive: true });

      // variables (secrets opened only now), storage, arguments
      const { env, secrets } = await resolveVariables(this.s.d, this.s.envelope, project.id);
      const s3 = project.storage as { endpoint?: string | null; bucket: string; prefix?: string; region?: string; accessKeyVar: string; secretKeyVar: string } | null;
      if (s3) {
        Object.assign(env, {
          AWS_ACCESS_KEY_ID: env[s3.accessKeyVar] ?? "", AWS_SECRET_ACCESS_KEY: env[s3.secretKeyVar] ?? "", AWS_REGION: s3.region || "us-east-1", AWS_DEFAULT_REGION: s3.region || "us-east-1",
          ...(s3.endpoint ? { AWS_ENDPOINT_URL: s3.endpoint, AWS_ENDPOINT_URL_S3: s3.endpoint } : {}),
          MINIASYS_S3: `s3://${s3.bucket}${s3.prefix ? `/${s3.prefix.replace(/^\/+|\/+$/g, "")}` : ""}`, MINIASYS_S3_BUCKET: s3.bucket,
        });
      }
      const order = ((sc.argsSchema as { "x-order"?: string[] })["x-order"] ?? Object.keys((sc.argsSchema as { properties?: object }).properties ?? {}));
      const args = input.args ?? {};
      const deps = await this.dependencies(project.slug, lang, source, folder, runId, ac.signal);
      if (deps.error) return await fail(deps.error);

      const scriptPath = `/project/${sc.path}`;
      const { command, extraEnv } = this.command(lang, scriptPath, args, order);
      const mounts = [
        { host: folder, container: "/project", readOnly: true },
        { host: storage, container: "/storage", readOnly: false },
        ...(deps.dir ? [{ host: deps.dir, container: "/deps", readOnly: true }] : []),
      ];
      let pending: string[] = [];
      let flushing: Promise<void> = Promise.resolve();
      const flush = () => {
        if (!pending.length) return flushing;
        const text = pending.join("\n");
        pending = [];
        flushing = flushing.then(() => this.s.journal.append(runId, { type: "log", text, stream: "stdout" }));
        return flushing;
      };
      const timer = setInterval(() => void flush(), 700);
      let r;
      try {
        r = await this.s.sandbox.stream(
          {
            runId, n: 1, workspace: storage, gitDir: false, command, image: this.s.config.sandboxImage,
            network: sc.network || !!s3, cpus: 1, memMb: sc.memMb, timeoutS: sc.timeoutS, mounts, redact: secrets,
            env: {
              ...env, ...extraEnv, MINIASYS_ARGS: JSON.stringify(args), MINIASYS_ARG_ORDER: JSON.stringify(order), MINIASYS_STORAGE: "/storage", MINIASYS_PROJECT: project.slug,
              MINIASYS_RUN_ID: runId, ...(deps.dir && lang === "python" ? { PYTHONPATH: "/deps" } : {}), ...(deps.dir && lang === "typescript" ? { NODE_PATH: "/deps/node_modules" } : {}),
            },
          },
          (line) => {
            if (!line.startsWith(RESULT)) pending.push(line);
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
        VALUES (${runId}, ${r.containerName}, ${this.s.config.sandboxImage}, ${`${lang} ${sc.path}`}, ${sc.network || !!s3}, 1, ${sc.memMb}, ${r.exitCode}, ${r.timedOut}, ${r.stdoutTail}, ${r.stderrTail}, ${r.fullLogPath}, ${r.durationMs})`;

      const result = this.result(lang, r.stdout);
      if (ac.signal.aborted) return await fail("canceled", { result });
      if (r.timedOut) return await fail(`timed out after ${sc.timeoutS} s`, { result });
      if (r.exitCode !== 0) return await fail(`exit ${r.exitCode}: ${(r.stderr.trim().split("\n").slice(-5).join("\n") || r.stdout.trim().split("\n").slice(-5).join("\n")).slice(0, 2000)}`, { result });
      const summary = result === undefined ? "done" : JSON.stringify(result).slice(0, 500);
      await this.s.d.db.update(runs).set({ status: "succeeded", result: result ?? null, summary, finishedAt: new Date() }).where(eq(runs.id, runId));
      await this.finished(runId, project, input, "succeeded", summary);
    } catch (e) {
      await fail((e as Error).message);
    } finally {
      this.running.delete(runId);
    }
  }

  private command(lang: Language, scriptPath: string, args: Record<string, unknown>, order: string[]): { command: string; extraEnv: Record<string, string> } {
    if (lang === "python") return { command: `python3 -c "$MINIASYS_WRAPPER" ${shq(scriptPath)}`, extraEnv: { MINIASYS_WRAPPER: PY_WRAPPER } };
    if (lang === "typescript") return { command: `node --experimental-strip-types --no-warnings --input-type=module -e "$MINIASYS_WRAPPER" ${shq(scriptPath)}`, extraEnv: { MINIASYS_WRAPPER: TS_WRAPPER } };
    if (lang === "bash") {
      const positional = order.map((k) => shq(args[k] === undefined || args[k] === null ? "" : typeof args[k] === "string" ? (args[k] as string) : JSON.stringify(args[k]))).join(" ");
      return { command: `cd /storage && bash ${shq(scriptPath)} ${positional}`, extraEnv: {} };
    }
    // DuckDB: arguments as variables (getvariable('name')), working in /storage; the last statement's rows are the result
    const preamble = Object.entries(args).map(([k, v]) => `SET VARIABLE ${k.replace(/[^A-Za-z0-9_]/g, "")} = ${sqlLiteral(v)};`).join(" ");
    return { command: `cd /storage && { printf '%s\\n' "$MINIASYS_SQL_PREAMBLE"; cat ${shq(scriptPath)}; } | duckdb -json`, extraEnv: { MINIASYS_SQL_PREAMBLE: preamble } };
  }

  /** The value main() returned (Python, TypeScript), the last statement's rows (SQL), or the last line printed (Bash). */
  private result(lang: Language, stdout: string): unknown {
    const at = stdout.lastIndexOf(RESULT);
    if (at >= 0) {
      const text = stdout.slice(at + RESULT.length).split("\n")[0]!.slice(0, MAX_RESULT);
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    }
    if (lang === "sql") {
      // duckdb -json prints each statement's rows as a JSON array (one line, or spread over several)
      const blocks = [...stdout.matchAll(/^\[[\s\S]*?\]$/gm)].map((m) => m[0]);
      for (const b of blocks.reverse()) {
        try {
          return JSON.parse(b.slice(0, MAX_RESULT));
        } catch {
          /* not a whole array: try the one before */
        }
      }
      return null;
    }
    if (lang === "bash") {
      const line = stdout.trim().split("\n").at(-1) ?? "";
      try {
        return JSON.parse(line);
      } catch {
        return line || null;
      }
    }
    return undefined;
  }

  /**
   * The dependency cache for a run: Python requirements (header, else the project's
   * requirements.txt) or the project's package.json, installed once per content
   * hash by a networked sandbox run, then mounted read-only.
   */
  private async dependencies(slug: string, lang: Language, source: string, folder: string, runId: string, signal: AbortSignal): Promise<{ dir: string | null; error?: string }> {
    let spec: { kind: "py" | "node"; text: string } | null = null;
    if (lang === "python") {
      const reqs = scriptRequirements(source);
      const file = reqs.length ? reqs.join("\n") : await readFile(join(folder, "requirements.txt"), "utf8").catch(() => "");
      if (file.trim()) spec = { kind: "py", text: file.trim() };
    } else if (lang === "typescript") {
      const pkg = await readFile(join(folder, "package.json"), "utf8").catch(() => "");
      const lock = await readFile(join(folder, "package-lock.json"), "utf8").catch(() => "");
      if (pkg.trim()) spec = { kind: "node", text: `${pkg}\n${lock}` };
    }
    if (!spec) return { dir: null };
    const hash = createHash("sha256").update(spec.text).digest("hex").slice(0, 16);
    const dir = join(this.s.config.depsDir, slug, `${spec.kind}-${hash}`);
    if (await stat(join(dir, ".ok")).then(() => true, () => false)) return { dir };
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });
    await this.s.journal.append(runId, { type: "log", text: `installing dependencies (${spec.kind === "py" ? "pip" : "npm"}, cached afterwards)…`, stream: "stdout" });
    if (spec.kind === "py") await writeFile(join(dir, ".requirements.txt"), spec.text);
    const command = spec.kind === "py"
      ? "pip3 install --quiet --disable-pip-version-check --no-cache-dir --target /deps-out -r /deps-out/.requirements.txt && touch /deps-out/.ok"
      : "cd /deps-out && cp /project/package.json . && (cp /project/package-lock.json . 2>/dev/null || true) && npm install --omit=dev --ignore-scripts --no-audit --no-fund --loglevel=error && touch /deps-out/.ok";
    const r = await this.s.sandbox!.run({
      runId, n: 900, workspace: dir, gitDir: false, command, image: this.s.config.sandboxImage, network: true, cpus: 1, memMb: 2048, timeoutS: 900,
      mounts: [{ host: folder, container: "/project", readOnly: true }, { host: dir, container: "/deps-out", readOnly: false }],
    }, signal);
    if (r.exitCode !== 0) {
      await rm(dir, { recursive: true, force: true });
      return { dir: null, error: `installing dependencies failed (exit ${r.exitCode}): ${(r.stderr || r.stdout).trim().split("\n").slice(-6).join("\n").slice(0, 2000)}` };
    }
    return { dir };
  }

  private async finished(runId: string, project: typeof projects.$inferSelect, input: { scriptId: string; path: string; trigger?: string }, status: string, detail: string) {
    await publish(this.s.d.sql, { topic: CHANNELS.run(runId), type: "status", data: { status } });
    await publish(this.s.d.sql, { topic: CHANNELS.scripts(project.id), type: "run", data: { runId, scriptId: input.scriptId, status } });
    if (input.trigger === "schedule" && status === "failed") {
      const index = async (n: { projectId: string; sourceType: string; sourceId: string | null; content: string }) => addNote(this.s, n);
      await addJournalEntry(this.s.d, { projectId: project.id, actor: "system", kind: "issue", title: `Scheduled run of ${input.path} failed`, body: detail.slice(0, 2000), runId }, index);
      await this.s.notifier.notify({ level: "warn", title: `${input.path} failed (scheduled run, p/${project.slug})`, body: detail.slice(0, 500), link: `/projects/${project.slug}/scripts?script=${encodeURIComponent(input.path)}`, ntfy: "default" });
    }
  }
}
