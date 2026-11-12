import { describe, expect, it } from "vitest";
import { languageOf, scriptArgs, scriptDescription, scriptRequirements } from "../src/scripts.ts";

describe("script arguments", () => {
  it("reads a Python main()", () => {
    const s = scriptArgs("python", `"""Load the daily file."""\nimport os\n\ndef main(day: str, limit: int = 10, dry_run: bool = False, tags: list[str] = [],\n         mode: Literal["a", "b"] = "a", note: Optional[str] = None, *args, **kw):\n    return 1\n`);
    expect(s["x-order"]).toEqual(["day", "limit", "dry_run", "tags", "mode", "note"]);
    expect(s.required).toEqual(["day"]);
    expect(s.properties.limit).toEqual({ type: "integer", default: 10 });
    expect(s.properties.dry_run).toEqual({ type: "boolean", default: false });
    expect(s.properties.tags).toEqual({ type: "array", items: { type: "string" }, default: [] });
    expect(s.properties.mode).toEqual({ enum: ["a", "b"], default: "a" });
    expect(s.properties.note).toEqual({ anyOf: [{ type: "string" }, { type: "null" }], default: null });
  });

  it("reads a TypeScript main()", () => {
    const s = scriptArgs("typescript", `// Sync orders\nexport async function main(day: string, limit = 10, mode: "fast" | "full" = "fast", ids?: number[], opts: Record<string, number> = {}, cb = (x: number) => x) {}`);
    expect(s["x-order"]).toEqual(["day", "limit", "mode", "ids", "opts", "cb"]);
    expect(s.required).toEqual(["day"]);
    expect(s.properties.limit).toEqual({ type: "integer", default: 10 });
    expect(s.properties.mode).toEqual({ enum: ["fast", "full"], default: "fast" });
    expect(s.properties.ids).toEqual({ type: "array", items: { type: "number" } });
    expect(s.properties.opts).toEqual({ type: "object", default: {} });
  });

  it("reads Bash and SQL headers", () => {
    expect(scriptArgs("bash", "#!/bin/bash\n# arg: name string\n# arg: count integer 3\necho hi").properties).toEqual({ name: { type: "string" }, count: { type: "integer", default: 3 } });
    expect(scriptArgs("sql", "-- arg: day string 2026-01-01\nselect 1").properties.day).toEqual({ type: "string", default: "2026-01-01" });
  });

  it("finds languages, requirements and descriptions", () => {
    expect(languageOf("scripts/a.py")).toBe("python");
    expect(languageOf("scripts/a.txt")).toBeNull();
    expect(scriptRequirements("# requirements: pandas==2.2, requests\n# requirement: boto3\nx=1")).toEqual(["pandas==2.2", "requests", "boto3"]);
    expect(scriptDescription("python", '#!/usr/bin/env python\n"""Loads files."""\n')).toBe("Loads files.");
    expect(scriptDescription("bash", "#!/bin/bash\n# arg: x string\n# Cleans up\n")).toBe("Cleans up");
  });

  it("has no arguments without a main", () => {
    expect(scriptArgs("python", "print(1)")).toEqual({ type: "object", properties: {}, required: [], "x-order": [] });
  });
});
