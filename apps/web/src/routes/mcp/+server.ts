// The MCP server (Streamable HTTP, stateless): one tool per operation the
// caller's token allows, plus resources and prompts (packages/harness/src/mcp.ts).
// Add it to a harness with:
//   claude mcp add --transport http miniasys http://127.0.0.1:3000/mcp --header "Authorization: Bearer msy_…"
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/server";
import { buildMcpServer } from "@miniasys/harness/mcp";
import { ApiError } from "@miniasys/harness";
import { catalog, invoke } from "#lib/server/ops/registry.ts";
import { UI, type OpError } from "#lib/server/ops/define.ts";

const handle = async ({ request, locals }: { request: Request; locals: App.Locals }) => {
  const ctx = locals.ctx ?? UI;
  const server = buildMcpServer({
    ops: catalog(ctx.access),
    call: async (op, input) => {
      try {
        return await invoke(op, input, ctx);
      } catch (e) {
        const o = e as OpError;
        throw new ApiError(o.status, o.code, o.message, o.issues);
      }
    },
  });
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  return transport.handleRequest(request);
};

export const POST = handle;
export const GET = handle;
export const DELETE = handle;
