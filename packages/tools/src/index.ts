export * from "./confine.ts";
export * from "./registry.ts";
export * from "./workspace.ts";
export * from "./board.ts";

import { ToolRegistry } from "./registry.ts";
import { WORKSPACE_TOOLS } from "./workspace.ts";
import { BOARD_TOOLS } from "./board.ts";

export const defaultRegistry = () => new ToolRegistry().register(...WORKSPACE_TOOLS, ...BOARD_TOOLS);
