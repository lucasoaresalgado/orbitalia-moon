// Runs sandbox containers through Podman's Docker-compatible API on the
// rootless socket: create from the profile, start, wait with a timeout (kill on
// expiry), collect logs, remove. At most `maxConcurrent` at a time.
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import Docker from "dockerode";
import { containerSpec, demux, SANDBOX_LABEL, tail, type SandboxRequest } from "./profile.ts";

export interface SandboxResult {
  containerName: string;
  exitCode: number | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
  stdoutTail: string;
  stderrTail: string;
  durationMs: number;
  fullLogPath: string | null;
}

class Semaphore {
  private waiting: (() => void)[] = [];
  private active = 0;
  constructor(public max: number) {}
  async acquire() {
    if (this.active < this.max) {
      this.active++;
      return;
    }
    await new Promise<void>((r) => this.waiting.push(r));
    this.active++;
  }
  release() {
    this.active--;
    this.waiting.shift()?.();
  }
  get inUse() {
    return this.active;
  }
}

export class SandboxRunner {
  readonly docker: Docker;
  private sem: Semaphore;

  constructor(
    socketPath: string,
    maxConcurrent = 2,
    private logDir: string | null = null,
  ) {
    this.docker = new Docker({ socketPath });
    this.sem = new Semaphore(maxConcurrent);
  }

  set maxConcurrent(n: number) {
    this.sem.max = Math.max(1, n);
  }

  get active() {
    return this.sem.inUse;
  }

  async run(req: SandboxRequest, signal?: AbortSignal): Promise<SandboxResult> {
    await this.sem.acquire();
    const spec = containerSpec(req);
    const started = Date.now();
    let container: Docker.Container | null = null;
    let timedOut = false;
    try {
      container = await this.docker.createContainer(spec as Docker.ContainerCreateOptions);
      await container.start();
      const c = container;
      const kill = () => void c.kill().catch(() => {});
      const timer = setTimeout(() => {
        timedOut = true;
        kill();
      }, req.timeoutS * 1000);
      signal?.addEventListener("abort", kill, { once: true });
      let exitCode: number | null = null;
      try {
        const w = (await container.wait()) as { StatusCode: number };
        exitCode = timedOut ? null : w.StatusCode;
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", kill);
      }
      const logs = (await container.logs({ stdout: true, stderr: true, follow: false })) as unknown as Buffer;
      const { stdout, stderr } = demux(Buffer.isBuffer(logs) ? logs : Buffer.from(String(logs)));
      let fullLogPath: string | null = null;
      if (this.logDir && (stdout.length > 20_000 || stderr.length > 20_000)) {
        const dir = join(this.logDir, "sandbox", req.runId);
        await mkdir(dir, { recursive: true });
        fullLogPath = join(dir, `${spec.name}.log`);
        await writeFile(fullLogPath, `$ ${req.command}\n--- stdout\n${stdout}\n--- stderr\n${stderr}\n`);
      }
      return { containerName: spec.name, exitCode, timedOut, stdout, stderr, stdoutTail: tail(stdout), stderrTail: tail(stderr), durationMs: Date.now() - started, fullLogPath };
    } finally {
      if (container) await container.remove({ force: true }).catch(() => {});
      this.sem.release();
    }
  }

  /** Removes sandbox containers older than `maxAgeS` (§10 cleanup sweep). */
  async sweep(maxAgeS: number): Promise<number> {
    const list = await this.docker.listContainers({ all: true, filters: { label: [SANDBOX_LABEL] } });
    const cutoff = Date.now() / 1000 - maxAgeS;
    let n = 0;
    for (const c of list)
      if (c.Created < cutoff) {
        await this.docker.getContainer(c.Id).remove({ force: true }).catch(() => {});
        n++;
      }
    return n;
  }

  async listActive(): Promise<{ id: string; name: string; runId: string; created: number; state: string }[]> {
    const list = await this.docker.listContainers({ all: true, filters: { label: [SANDBOX_LABEL] } });
    return list.map((c) => ({ id: c.Id, name: (c.Names[0] ?? "").replace(/^\//, ""), runId: c.Labels[SANDBOX_LABEL] ?? "", created: c.Created, state: c.State }));
  }

  async kill(id: string): Promise<void> {
    await this.docker.getContainer(id).remove({ force: true });
  }

  async health(): Promise<{ ok: boolean; version?: string; error?: string }> {
    try {
      const v = await this.docker.version();
      return { ok: true, version: v.Version };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }
}
