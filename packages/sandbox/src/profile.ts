// The sandbox container profile (scope §10), as a pure function so it is
// tested and reviewed apart from Podman. Agents never reach the socket: only
// the worker builds containers, always from this profile.

export interface SandboxRequest {
  runId: string;
  /** a sequence number within the run, for the container name */
  n: number;
  /** absolute host path of the card workspace (mounted read-write, or read-only for reviewers) */
  workspace: string;
  workspaceReadOnly?: boolean;
  /** mount <workspace>/.git read-only over the workspace (default true; false only when there is no .git) */
  gitDir?: boolean;
  /** absolute host path of the lakehouse, mounted read-only when the agent may read it */
  lakehouse?: string | null;
  command: string;
  image: string;
  network: boolean;
  cpus: number;
  memMb: number;
  pidsLimit?: number;
  timeoutS: number;
  env?: Record<string, string>;
  /** a host folder mounted read-write at /claude-home and used as HOME (Claude Code keeps its sessions there) */
  home?: string | null;
  /** rootless Podman (the default, scope §10) or Docker (e.g. a WSL dev machine) */
  runtime?: Runtime;
  /** Docker only: the host uid:gid the container runs as, so files stay the user's */
  user?: string;
  /** more host folders to mount (absolute paths), e.g. a project at /project, its storage at /storage */
  mounts?: { host: string; container: string; readOnly: boolean }[];
  /** secret values to mask in everything the run leaves behind (scope §26) */
  redact?: string[];
}

export type Runtime = "podman" | "docker";

export const SANDBOX_LABEL = "miniasys.run";

export function containerName(runId: string, n: number) {
  return `sbx-${runId.slice(0, 8)}-${n}`;
}

/** The Docker-compatible create body Podman's API accepts. */
export function containerSpec(r: SandboxRequest) {
  if (!r.workspace.startsWith("/")) throw new Error("the workspace must be an absolute path");
  const binds = [`${r.workspace}:/workspace:${r.workspaceReadOnly ? "ro,Z" : "Z"}`];
  // the worker runs git on the host in this workspace: the sandbox must not plant hooks or config there
  if (r.gitDir !== false) binds.push(`${r.workspace}/.git:/workspace/.git:ro`);
  if (r.lakehouse) binds.push(`${r.lakehouse}:/lakehouse:ro,z`);
  if (r.home) {
    if (!r.home.startsWith("/")) throw new Error("the home folder must be an absolute path");
    binds.push(`${r.home}:/claude-home:Z`);
  }
  for (const m of r.mounts ?? []) {
    if (!m.host.startsWith("/") || !m.container.startsWith("/")) throw new Error("mount paths must be absolute");
    if (["/", "/workspace", "/claude-home", "/tmp", "/proc", "/sys", "/dev"].includes(m.container)) throw new Error(`can't mount over ${m.container}`);
    binds.push(`${m.host}:${m.container}:${m.readOnly ? "ro,z" : "z"}`);
  }
  const mem = Math.min(Math.max(r.memMb, 256), 2048) * 1024 * 1024;
  const docker = r.runtime === "docker";
  return {
    name: containerName(r.runId, r.n),
    Image: r.image,
    Cmd: ["bash", "-lc", r.command],
    WorkingDir: "/workspace",
    ...(docker && r.user ? { User: r.user } : {}),
    Labels: { [SANDBOX_LABEL]: r.runId },
    Env: Object.entries({ ...(r.home ? { HOME: "/claude-home" } : {}), ...r.env }).map(([k, v]) => `${k}=${v}`),
    NetworkDisabled: !r.network,
    HostConfig: {
      Binds: binds,
      // files written keep Lucas's ownership: keep-id on rootless Podman, the host uid on Docker
      ...(docker ? {} : { UsernsMode: "keep-id" }),
      CapDrop: ["ALL"],
      SecurityOpt: ["no-new-privileges"],
      ReadonlyRootfs: true,
      Tmpfs: { "/tmp": "rw,size=512m", "/home": "rw,size=64m" },
      NanoCpus: Math.round(Math.min(Math.max(r.cpus, 0.25), 2) * 1e9),
      Memory: mem,
      MemorySwap: mem,
      PidsLimit: r.pidsLimit ?? 256,
      // pasta is rootless Podman 5's network (slirp4netns is often not installed); like
      // slirp4netns it gives no route to services bound to the host's 127.0.0.1
      NetworkMode: r.network ? (docker ? "bridge" : "pasta") : "none",
      AutoRemove: false,
    },
  };
}

/** The same profile as a podman command line, for the docs and for manual checks. */
export function podmanArgs(r: SandboxRequest): string[] {
  const s = containerSpec(r);
  return [
    "run", "--rm", "--name", s.name, "--label", `${SANDBOX_LABEL}=${r.runId}`, "--userns=keep-id",
    "--cap-drop=ALL", "--security-opt", "no-new-privileges", "--read-only", "--tmpfs", "/tmp:rw,size=512m",
    `--cpus=${s.HostConfig.NanoCpus / 1e9}`, `--memory=${s.HostConfig.Memory / 1048576}m`, `--memory-swap=${s.HostConfig.MemorySwap / 1048576}m`,
    `--pids-limit=${s.HostConfig.PidsLimit}`, `--network=${s.HostConfig.NetworkMode}`,
    ...s.HostConfig.Binds.flatMap((b) => ["-v", b]), "-w", "/workspace", r.image, ...s.Cmd,
  ];
}

const TAIL = 20_000;
export const tail = (s: string, n = TAIL) => (s.length > n ? `…[${s.length - n} bytes cut]\n${s.slice(-n)}` : s);

/** Splits Docker's multiplexed log stream (8-byte frame headers) into stdout and stderr. */
export function demux(buf: Buffer): { stdout: string; stderr: string } {
  const out: Buffer[] = [];
  const err: Buffer[] = [];
  let i = 0;
  // a TTY-less container's logs are framed; anything else is plain stdout
  if (buf.length < 8 || ![0, 1, 2].includes(buf[0]!)) return { stdout: buf.toString("utf8"), stderr: "" };
  while (i + 8 <= buf.length) {
    const kind = buf[i]!;
    const size = buf.readUInt32BE(i + 4);
    const chunk = buf.subarray(i + 8, i + 8 + size);
    (kind === 2 ? err : out).push(chunk);
    i += 8 + size;
  }
  return { stdout: Buffer.concat(out).toString("utf8"), stderr: Buffer.concat(err).toString("utf8") };
}
