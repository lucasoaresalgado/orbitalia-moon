// The registry is the platform's one list of capabilities: the HTTP API, the MCP
// server and the CLI are built from it, and the web UI goes through it too.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { buildMcpServer } from "@miniasys/harness/mcp";
import { toolName } from "@miniasys/harness";
import { allows, UI, type Ctx } from "../src/lib/server/ops/define.ts";
import { catalog, invoke, OPS } from "../src/lib/server/ops/registry.ts";

const ROUTES = join(import.meta.dirname, "../src/routes");
const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? files(join(dir, f)) : [join(dir, f)]));

/** route files that are not capabilities: auth, the scope cookie, the event stream, the API/MCP doors themselves, a redirect */
const NOT_CAPABILITIES = new Set([
  "login/+page.server.ts", "api/scope/+server.ts", "api/stream/+server.ts", "api/v1/stream/+server.ts",
  "api/v1/ops/+server.ts", "api/v1/ops/[name]/+server.ts", "api/v1/auth/token/+server.ts", "mcp/+server.ts", "cards/[project]/[number]/+page.server.ts",
]);

describe("operations", () => {
  it("have dotted names, summaries and JSON Schemas for every input", () => {
    const c = catalog("admin");
    expect(c.length).toBe(OPS.size);
    for (const op of c) {
      expect(op.name).toMatch(/^[a-z_]+(\.[a-z_]+)?$/);
      expect(op.summary.length).toBeGreaterThan(10);
      expect(op.inputSchema.type).toBe("object");
    }
    expect(new Set(c.map((o) => toolName(o.name))).size).toBe(c.length);
  });

  it("are the only way the UI reaches data: every capability route calls an operation, none touches the database", () => {
    const offenders: string[] = [];
    for (const f of files(ROUTES).filter((f) => /\+(server|page\.server|layout\.server)\.ts$/.test(f))) {
      const rel = relative(ROUTES, f);
      if (NOT_CAPABILITIES.has(rel)) continue;
      const src = readFileSync(f, "utf8");
      const dbImports = /import \{([^}]*)\} from "#lib\/server\/db\.ts"/.exec(src)?.[1] ?? "";
      if (!/\b(call|act)\s*[<(]/.test(src) || /\b(db|sql|database)\b/.test(dbImports)) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });

  it("are all MCP tools and filtered by access", () => {
    const tools = (access: Ctx["access"]) => Object.keys((buildMcpServer({ ops: catalog(access), call: async () => null }) as unknown as { _registeredTools: object })._registeredTools);
    expect(tools("admin").length).toBe(OPS.size);
    const read = tools("read");
    expect(read.length).toBe([...OPS.values()].filter((o) => o.access === "read").length);
    expect(read).not.toContain("settings_models");
  });

  it("check access before anything else", async () => {
    const reader: Ctx = { actor: "user:ro", access: "read", agent: null };
    await expect(invoke("tokens.create", { name: "x" }, reader)).rejects.toMatchObject({ status: 403 });
    await expect(invoke("nope.nope", {}, UI)).rejects.toMatchObject({ status: 404 });
    await expect(invoke("cards.create", { title: "a" }, UI)).rejects.toMatchObject({ status: 400 });
    expect(allows("write", "read") && !allows("write", "admin")).toBe(true);
  });

  it("keep approvals and admin away from agents", () => {
    for (const [name, op] of OPS) if (name.startsWith("settings.") && name !== "settings.get") expect(op.access, name).toBe("admin");
    for (const name of ["tokens.create", "tokens.list", "tokens.revoke", "secrets.set", "secrets.delete", "system.backup"]) expect(OPS.get(name)?.access, name).toBe("admin");
  });
});
