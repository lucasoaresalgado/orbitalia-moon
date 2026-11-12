// The Orbitalia Moon MCP server, built from the operation catalog: one tool per
// operation, resources for a project's board, journal and docs, and prompts that
// tell a harness agent how to work here. The web app serves it over Streamable
// HTTP at /mcp; the CLI serves the same thing over stdio (`miniasys mcp`).
import { fromJsonSchema, McpServer, ResourceTemplate, type jsonSchemaValidator } from "@modelcontextprotocol/server";
import { ApiError, toolName, type OpInfo } from "./catalog.ts";

export type CallOp = (op: string, input: unknown) => Promise<unknown>;

/**
 * Operations validate their input on the server (zod), with clearer messages
 * than a second check here would give, so the MCP layer passes arguments through.
 */
const passThrough: jsonSchemaValidator = { getValidator: () => (data: unknown) => ({ valid: true, data: data as never, errorMessage: undefined }) };

export const INSTRUCTIONS = `Orbitalia Moon is a self-hosted platform where agents plan, build and document software projects on kanban boards.
Use it to organize, log and document every step of your work:
- Projects hold cards (projects_board, cards_create, cards_update to move them: backlog → ready → in_progress → checks → in_review → done).
- Log what you do as you go: journal_add for project-level steps, decisions and milestones; cards_log for a card's own activity.
- Keep durable knowledge in project docs (docs_put / docs_get), versioned and searchable by agents.
- Talk to Luna, the manager agent, with manager_send (she plans and creates cards; read her answer with manager_thread).
- Agents: internal ones run inside Orbitalia Moon; external ones are identities a harness acts as (agents_create with runtime "external", then a token for it).
- Meetings gather agents on a topic in rounds (meetings_start, meetings_post, meetings_get).
Cards are named by id or "project#number". Approvals are Lucas's alone.`;

export interface BuildOptions {
  name?: string;
  version?: string;
  ops: OpInfo[];
  call: CallOp;
}

const text = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v));

export function buildMcpServer(o: BuildOptions): McpServer {
  const server = new McpServer({ name: o.name ?? "miniasys", version: o.version ?? "1" }, { instructions: INSTRUCTIONS });
  const have = new Set(o.ops.map((op) => op.name));

  for (const op of o.ops) {
    const readOnly = op.access === "read";
    server.registerTool(
      toolName(op.name),
      {
        description: op.summary,
        inputSchema: fromJsonSchema<Record<string, unknown>>(op.inputSchema as never, passThrough),
        annotations: { readOnlyHint: readOnly, destructiveHint: !readOnly && op.destructive, idempotentHint: readOnly, openWorldHint: false },
      },
      async (args: Record<string, unknown>) => {
        try {
          return { content: [{ type: "text" as const, text: text(await o.call(op.name, args ?? {})) }] };
        } catch (e) {
          const msg = e instanceof ApiError ? `${e.code}: ${e.message}` : (e as Error).message;
          return { content: [{ type: "text" as const, text: msg }], isError: true };
        }
      },
    );
  }

  const read = (op: string, input: unknown) => async (uri: URL) => ({ contents: [{ uri: uri.href, mimeType: "application/json", text: text(await o.call(op, input)) }] });
  const projectList = async () => ((await o.call("projects.list", {})) as { slug: string; name: string }[]);

  if (have.has("projects.board"))
    server.registerResource(
      "board",
      new ResourceTemplate("miniasys://projects/{project}/board", {
        list: async () => ({ resources: (await projectList()).map((p) => ({ uri: `miniasys://projects/${p.slug}/board`, name: `${p.name} board` })) }),
      }),
      { description: "A project's kanban board: every live card with status, assignee and PR", mimeType: "application/json" },
      (uri, v) => read("projects.board", { project: String(v.project) })(uri),
    );
  if (have.has("journal.list"))
    server.registerResource(
      "journal",
      new ResourceTemplate("miniasys://projects/{project}/journal", {
        list: async () => ({ resources: (await projectList()).map((p) => ({ uri: `miniasys://projects/${p.slug}/journal`, name: `${p.name} journal` })) }),
      }),
      { description: "A project's journal: the steps, decisions, milestones and issues logged so far", mimeType: "application/json" },
      (uri, v) => read("journal.list", { project: String(v.project), limit: 200 })(uri),
    );
  if (have.has("docs.get"))
    server.registerResource(
      "doc",
      new ResourceTemplate("miniasys://projects/{project}/docs/{doc}", { list: undefined }),
      { description: "A project document (markdown)", mimeType: "text/markdown" },
      async (uri, v) => {
        const d = (await o.call("docs.get", { project: String(v.project), doc: String(v.doc) })) as { body: string };
        return { contents: [{ uri: uri.href, mimeType: "text/markdown", text: d.body }] };
      },
    );

  const promptArgs = (props: Record<string, string>, required: string[]) =>
    fromJsonSchema<Record<string, string>>({ type: "object", properties: Object.fromEntries(Object.entries(props).map(([k, d]) => [k, { type: "string", description: d }])), required } as never, passThrough);

  server.registerPrompt(
    "kickoff_project",
    { description: "Start a project in Orbitalia Moon: create it, write its overview doc, and ask Luna for a plan.", argsSchema: promptArgs({ slug: "project slug (lowercase, dashes)", goal: "what the project should achieve" }, ["slug", "goal"]) },
    (a) => ({
      messages: [{
        role: "user",
        content: {
          type: "text",
          text: `Set up the project "${a.slug}" in Orbitalia Moon for this goal:\n\n${a.goal}\n\n1. projects_create (slug ${a.slug}).\n2. docs_put an "overview" doc: goal, scope, constraints, open questions.\n3. journal_add a milestone "Project started".\n4. manager_send Luna the goal and ask for a plan (project ${a.slug}); poll manager_thread for her answer and the plan waiting for Lucas's approval.`,
        },
      }],
    }),
  );
  server.registerPrompt(
    "log_step",
    { description: "How to log a step of work so the project's history stays complete.", argsSchema: promptArgs({ project: "project slug", what: "what was done" }, ["project", "what"]) },
    (a) => ({
      messages: [{
        role: "user",
        content: {
          type: "text",
          text: `Log this step in Orbitalia Moon project ${a.project}: ${a.what}\n\nUse journal_add with a short title, a markdown body (what, why, result, links), kind step|decision|milestone|issue|note, and the card ("${a.project}#N") when it belongs to one. If it changes what the project knows, update the relevant doc with docs_put.`,
        },
      }],
    }),
  );
  return server;
}
