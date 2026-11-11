import { describe, expect, it } from "vitest";
import { containerSpec, demux, podmanArgs } from "../src/profile.ts";

const req = { runId: "0f3a9c1e-1111-2222-3333-444444444444", n: 1, workspace: "/home/l/miniasys/workspaces/c1", command: "pnpm test", image: "localhost/agent-sandbox:dev", network: false, cpus: 1, memMb: 1024, timeoutS: 300 };

describe("sandbox profile", () => {
  it("locks the container down", () => {
    const s = containerSpec(req);
    expect(s.name).toBe("sbx-0f3a9c1e-1");
    expect(s.HostConfig.CapDrop).toEqual(["ALL"]);
    expect(s.HostConfig.SecurityOpt).toContain("no-new-privileges");
    expect(s.HostConfig.ReadonlyRootfs).toBe(true);
    expect(s.HostConfig.NetworkMode).toBe("none");
    expect(s.NetworkDisabled).toBe(true);
    expect(s.HostConfig.Memory).toBe(s.HostConfig.MemorySwap);
    expect(s.HostConfig.PidsLimit).toBe(256);
    expect(s.HostConfig.Binds).toEqual(["/home/l/miniasys/workspaces/c1:/workspace:Z", "/home/l/miniasys/workspaces/c1/.git:/workspace/.git:ro"]);
  });

  it("mounts the lakehouse read-only only when asked, and caps memory at 2 GB", () => {
    const s = containerSpec({ ...req, lakehouse: "/mnt/data/lakehouse", memMb: 8192 });
    expect(s.HostConfig.Binds).toContain("/mnt/data/lakehouse:/lakehouse:ro,z");
    expect(s.HostConfig.Memory).toBe(2048 * 1024 * 1024);
  });

  it("refuses a relative workspace", () => {
    expect(() => containerSpec({ ...req, workspace: "ws" })).toThrow(/absolute/);
  });

  it("renders the same profile as podman arguments", () => {
    const a = podmanArgs(req).join(" ");
    expect(a).toContain("--cap-drop=ALL");
    expect(a).toContain("--network=none");
    expect(a).toContain("--read-only");
  });

  it("splits multiplexed logs", () => {
    const frame = (kind: number, s: string) => {
      const b = Buffer.from(s);
      const h = Buffer.alloc(8);
      h[0] = kind;
      h.writeUInt32BE(b.length, 4);
      return Buffer.concat([h, b]);
    };
    expect(demux(Buffer.concat([frame(1, "out1 "), frame(2, "err"), frame(1, "out2")]))).toEqual({ stdout: "out1 out2", stderr: "err" });
  });
});
