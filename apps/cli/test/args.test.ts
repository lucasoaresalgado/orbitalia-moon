import { describe, expect, it } from "vitest";
import { ArgError, parseInput } from "../src/args.ts";
import { human, table } from "../src/format.ts";

const cardCreate = {
  type: "object",
  properties: {
    title: { type: "string" },
    kind: { type: "string", enum: ["code", "research"] },
    acceptance_criteria: { type: "array", items: { type: "string" } },
    priority: { type: "string" },
    project: { type: "string" },
    start: { type: "boolean" },
    budgetUsd: { type: "number" },
    assignee: { anyOf: [{ type: "string" }, { type: "null" }] },
    data: { type: "object" },
  },
  required: ["title", "project"],
};

describe("cli arguments", () => {
  it("types flags from the schema, in kebab, snake or camel case", () => {
    const { input } = parseInput(cardCreate, ["--title", "Fix login", "--budget-usd", "0.5", "--start", "--kind=research"]);
    expect(input).toEqual({ title: "Fix login", budgetUsd: 0.5, start: true, kind: "research" });
  });

  it("fills required fields from positionals, identifiers first, the last one taking the rest", () => {
    expect(parseInput(cardCreate, ["demo", "Fix", "the", "login"]).input).toEqual({ project: "demo", title: "Fix the login" });
    expect(parseInput(cardCreate, ["--project", "demo", "Fix login"]).input).toEqual({ project: "demo", title: "Fix login" });
  });

  it("collects repeated flags into arrays and accepts JSON arrays and objects", () => {
    expect(parseInput(cardCreate, ["--acceptance-criteria", "a, with comma", "--acceptance-criteria", "b"]).input.acceptance_criteria).toEqual(["a, with comma", "b"]);
    expect(parseInput(cardCreate, ["--acceptance_criteria", '["x","y"]']).input.acceptance_criteria).toEqual(["x", "y"]);
    expect(parseInput(cardCreate, ["--data", '{"a":1}']).input.data).toEqual({ a: 1 });
  });

  it("reads null for nullable fields, --no-x for false, and --json as a base under the flags", () => {
    expect(parseInput(cardCreate, ["--assignee", "null"]).input.assignee).toBeNull();
    expect(parseInput(cardCreate, ["--no-start"]).input.start).toBe(false);
    expect(parseInput(cardCreate, ["--json", '{"title":"a","priority":"low"}', "--priority", "high"]).input).toEqual({ title: "a", priority: "high" });
    expect(parseInput(cardCreate, ["--json", "-"]).stdin).toBe(true);
  });

  it("refuses unknown options, bad numbers and extra words", () => {
    expect(() => parseInput(cardCreate, ["--nope", "x"])).toThrow(ArgError);
    expect(() => parseInput(cardCreate, ["--budget-usd", "lots"])).toThrow(/number/);
    expect(() => parseInput({ type: "object", properties: { id: { type: "string" } }, required: [] }, ["extra"])).toThrow(/unexpected/);
  });
});

describe("cli output", () => {
  it("prints records as aligned tables, dropping empty columns", () => {
    const t = table([{ slug: "a", n: 1, empty: null }, { slug: "bbb", n: 22, empty: null }]).split("\n");
    expect(t[0]).toBe("slug  n");
    expect(t[3]).toBe("bbb   22");
  });

  it("prints objects as key: value with nested tables", () => {
    expect(human({ ok: true, rows: [{ a: 1 }] })).toBe("ok: true\n\nrows:\na\n─\n1");
  });
});
