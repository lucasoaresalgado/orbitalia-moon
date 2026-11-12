// The shape of the operation catalog (GET /api/v1/ops), shared by the web app,
// the CLI and the MCP server builder.

export type Access = "read" | "write" | "admin";

export interface OpInfo {
  /** dotted: <domain>.<action> */
  name: string;
  summary: string;
  access: Access;
  destructive: boolean;
  /** JSON Schema of the input */
  inputSchema: Record<string, unknown>;
}

export interface Catalog {
  version: string;
  caller: { actor: string; access: Access; agent: string | null };
  ops: OpInfo[];
}

/** cards.create → cards_create (MCP tool names) */
export const toolName = (op: string) => op.replace(/\./g, "_");

/** The error every door reports: { code, message, issues? }. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly issues?: unknown,
  ) {
    super(message);
  }
}
