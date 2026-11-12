// Types for callers in the web app: an operation's output by its name.
import type * as agents from "./agents.ts";
import type * as cards from "./cards.ts";
import type * as inbox from "./inbox.ts";
import type * as manager from "./manager.ts";
import type * as projects from "./projects.ts";
import type * as runs from "./runs.ts";
import type * as settings from "./settings.ts";
import type * as system from "./system.ts";
import type * as tokens from "./tokens.ts";
import type * as journal from "./journal.ts";
import type * as docs from "./docs.ts";
import type * as meetings from "./meetings.ts";
import type * as files from "./files.ts";
import type * as variables from "./variables.ts";
import type * as storage from "./storage.ts";
import type * as scripts from "./scripts.ts";

// a module may export other things too (constants): only its operations count
type Values<T> = Extract<T[keyof T], { name: string; run: unknown }>;
type AllOps = Values<typeof agents> | Values<typeof cards> | Values<typeof inbox> | Values<typeof manager> | Values<typeof projects> | Values<typeof runs> | Values<typeof settings> | Values<typeof system> | Values<typeof tokens> | Values<typeof journal> | Values<typeof docs> | Values<typeof meetings> | Values<typeof files> | Values<typeof variables> | Values<typeof storage> | Values<typeof scripts>;

export type OpName = AllOps["name"];
export type OpOutput<N extends OpName> = Awaited<ReturnType<Extract<AllOps, { name: N }>["run"]>>;
