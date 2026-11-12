import { afterEach, describe, expect, it, vi } from "vitest";
import { Decider, OllamaDecisionEngine, type DecisionEngine } from "../src/decisions.ts";
import { closedSchema, dropNulls } from "../src/schema.ts";

const engine = (name: string, answer: unknown, confidence: number): DecisionEngine => ({
  name,
  decide: async () => ({ output: answer as never, confidence }),
});
const broken: DecisionEngine = { name: "down", decide: async () => { throw new Error("ECONNREFUSED"); } };

describe("decider", () => {
  it("accepts a confident System One answer", async () => {
    const d = await new Decider(engine("systemone:x", { role: "dev", model_tier: "haiku" }, 0.9), null).decide("route_card", {});
    expect(d).toMatchObject({ accepted: true, engine: "systemone:x", output: { role: "dev", model_tier: "haiku" } });
  });

  it("falls back to Haiku when Colibri is down", async () => {
    const d = await new Decider(broken, engine("haiku_fallback", { risk: "low" }, 0.95)).decide("risk_class", {});
    expect(d).toMatchObject({ engine: "haiku_fallback", output: { risk: "low" } });
  });

  it("uses the safe default below the threshold, keeping the raw answer", async () => {
    const d = await new Decider(engine("s", { risk: "low" }, 0.6), null).decide("risk_class", {});
    expect(d).toMatchObject({ accepted: false, output: { risk: "high" }, raw: { risk: "low" } });
  });

  it("closes a meeting only on a confident 'no'", async () => {
    expect((await new Decider(engine("s", { open_questions: "no" }, 0.8), null).decide("meeting_open_questions", {})).output).toEqual({ open_questions: "yes" });
    expect((await new Decider(engine("s", { open_questions: "no" }, 0.9), null).decide("meeting_open_questions", {})).output).toEqual({ open_questions: "no" });
  });

  it("returns the default when every engine fails; route_card has none (the manager decides)", async () => {
    expect(await new Decider(broken, broken).decide("triage", {})).toMatchObject({ engine: "default", output: { priority: "medium", needs_approval: true } });
    expect((await new Decider(null, null).decide("route_card", {})).output).toBeNull();
  });
});

describe("local decisions on Ollama", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("asks for the decision schema and reads the answer", async () => {
    const fetch = vi.fn(async () => Response.json({ message: { content: JSON.stringify({ decision: { risk: "low" }, confidence: 0.9 }) } }));
    vi.stubGlobal("fetch", fetch);
    const d = await new Decider(broken, new OllamaDecisionEngine("http://ollama", "small:1b")).decide("risk_class", { files: ["a.ts"] });
    expect(d).toMatchObject({ engine: "ollama:small:1b", accepted: true, output: { risk: "low" } });
    const body = JSON.parse((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body).toMatchObject({ model: "small:1b", stream: false, think: false });
    expect(body.format.properties).toHaveProperty("confidence");
  });

  it("is skipped when its answer doesn't match the schema", async () => {
    vi.stubGlobal("fetch", async () => Response.json({ message: { content: JSON.stringify({ decision: { risk: "maybe" }, confidence: 0.9 }) } }));
    const d = await new Decider(new OllamaDecisionEngine("http://ollama", "m"), engine("haiku_fallback", { risk: "medium" }, 0.9)).decide("risk_class", {});
    expect(d.engine).toBe("haiku_fallback");
  });
});

describe("strict schemas", () => {
  it("closes objects and makes optional fields nullable", () => {
    const s = closedSchema({ type: "object", properties: { a: { type: "string" }, b: { type: "number" } }, required: ["a"] });
    expect(s).toMatchObject({ additionalProperties: false, required: ["a", "b"], properties: { b: { anyOf: [{ type: "number" }, { type: "null" }] } } });
    expect(dropNulls({ a: 1, b: null, c: [{ d: null }] })).toEqual({ a: 1, c: [{}] });
  });
});
