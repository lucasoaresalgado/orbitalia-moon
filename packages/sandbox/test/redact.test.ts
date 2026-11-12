import { describe, expect, it } from "vitest";
import { containerSpec, redactor } from "../src/index.ts";

describe("secret masking", () => {
  const mask = redactor(["s3cr3t-Value/+=", "ab", ""]);
  it("masks raw, JSON-escaped, URL-encoded and base64 forms", () => {
    const v = "s3cr3t-Value/+=";
    expect(mask(`key=${v} end`)).toBe("key=*** end");
    expect(mask(JSON.stringify({ k: v }))).toBe('{"k":"***"}');
    expect(mask(`u=${encodeURIComponent(v)}`)).toBe("u=***");
    expect(mask(Buffer.from(v).toString("base64"))).toBe("***");
  });
  it("ignores values too short to mask safely, and passes text through without secrets", () => {
    expect(mask("ab cd")).toBe("ab cd");
    expect(redactor([])("anything")).toBe("anything");
  });
});

describe("extra mounts", () => {
  const base = { runId: "00000000-0000-0000-0000-000000000000", n: 1, workspace: "/w", command: "true", image: "i", network: false, cpus: 1, memMb: 512, timeoutS: 10 };
  it("binds a project read-only and storage read-write", () => {
    const s = containerSpec({ ...base, mounts: [{ host: "/p/demo", container: "/project", readOnly: true }, { host: "/s/demo", container: "/storage", readOnly: false }] });
    expect(s.HostConfig.Binds).toContain("/p/demo:/project:ro,z");
    expect(s.HostConfig.Binds).toContain("/s/demo:/storage:z");
  });
  it("refuses relative paths and mounting over the platform's folders", () => {
    expect(() => containerSpec({ ...base, mounts: [{ host: "p", container: "/project", readOnly: true }] })).toThrow(/absolute/);
    expect(() => containerSpec({ ...base, mounts: [{ host: "/x", container: "/workspace", readOnly: true }] })).toThrow(/mount over/);
  });
});
