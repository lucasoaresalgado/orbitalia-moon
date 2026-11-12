// miniasys: the CLI. Every operation of the platform is a command, built from the
// server's catalog (GET /api/v1/ops), so the CLI can do whatever the web UI does:
//   miniasys <domain> <action> [--option value …] [--json '{…}' | --json -] [--raw]
// plus a few commands made for people: login, chat, tail, watch, board, mcp.
import { existsSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { hostname } from "node:os";
import { ApiError, Client, type Catalog, type OpInfo } from "@miniasys/harness";
import { ArgError, describe, parseInput } from "./args.ts";
import { CONFIG_FILE, DEFAULT_URL, forgetConfig, loadConfig, saveConfig } from "./config.ts";
import { human } from "./format.ts";

const argv = process.argv.slice(2);
const flag = (name: string) => {
  const i = argv.indexOf(name);
  if (i < 0) return false;
  argv.splice(i, 1);
  return true;
};
const option = (name: string) => {
  const i = argv.findIndex((a) => a === name || a.startsWith(`${name}=`));
  if (i < 0) return undefined;
  const a = argv[i]!;
  const v = a.includes("=") ? a.slice(a.indexOf("=") + 1) : argv[i + 1];
  argv.splice(i, a.includes("=") ? 1 : 2);
  return v;
};

const asJson = flag("--json-out") || flag("--raw");
const out = (v: unknown) => console.log(asJson ? JSON.stringify(v, null, 2) : human(v));
const die = (msg: string, code = 1): never => {
  console.error(msg);
  process.exit(code);
};

function client(): Client {
  const c = loadConfig();
  if (!c) die(`not logged in: run \`miniasys login\` (or set MINIASYS_URL and MINIASYS_TOKEN)`);
  const agent = option("--as") ?? c!.agent;
  return new Client({ url: c!.url, token: c!.token, agent });
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

function askHidden(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stderr, terminal: true });
    const out = rl as unknown as { _writeToOutput: (s: string) => void; output: NodeJS.WriteStream };
    process.stderr.write(prompt);
    out._writeToOutput = () => {};
    let answered = false;
    rl.question("", (answer) => {
      answered = true;
      rl.close();
      process.stderr.write("\n");
      resolve(answer);
    });
    // input ended without an answer (Ctrl+D): no password
    rl.on("close", () => {
      if (!answered) resolve("");
    });
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const FINAL = new Set(["succeeded", "failed", "canceled", "timed_out"]);

// ------------------------------------------------------------------ commands for people

async function login() {
  const url = option("--url") ?? process.env.MINIASYS_URL ?? DEFAULT_URL;
  const name = option("--name") ?? `cli-${hostname().toLowerCase().replace(/[^a-z0-9-]/g, "-")}-${Date.now().toString(36)}`;
  const access = (option("--access") ?? "admin") as "read" | "write" | "admin";
  const token = option("--token");
  if (token) {
    const c = new Client({ url, token });
    const cat = await c.catalog();
    saveConfig({ url, token });
    return console.log(`logged in to ${url} as ${cat.caller.actor} (${cat.caller.access}); saved in ${CONFIG_FILE}`);
  }
  const fromStdin = flag("--password-stdin");
  // a hidden prompt needs a terminal: without one (a pipe, `!` in a harness) say how else to log in
  if (!fromStdin && !process.env.MINIASYS_PASSWORD && !process.stdin.isTTY)
    die(`no terminal to ask for the password. Log in with one of:
  miniasys login --password-stdin < file-with-the-password
  miniasys login --token msy_…        (a token from Settings → API tokens)
or run \`miniasys login\` in a real terminal.`);
  const password = fromStdin ? (await readStdin()).trim() : process.env.MINIASYS_PASSWORD ?? (await askHidden(`Orbitalia Moon password (${url}): `));
  if (!password) die("no password given");
  const t = await Client.login(url, password, name, access);
  saveConfig({ url, token: t.token });
  console.log(`logged in to ${url} with a new ${t.access} token "${t.name}"; saved in ${CONFIG_FILE}`);
}

async function logout() {
  const c = loadConfig();
  if (c) {
    const cl = new Client(c);
    const me = await cl.catalog().catch(() => null);
    const name = me?.caller.actor.startsWith("user:") ? me.caller.actor.slice(5) : null;
    if (name && me?.caller.access === "admin") await cl.call("tokens.revoke", { name }).catch(() => {});
  }
  forgetConfig();
  console.log("logged out");
}

/** Sends Luna a message and waits for her answer (unless --no-wait). */
async function chat(c: Client) {
  const project = option("--project") ?? option("-p") ?? null;
  const wait = !flag("--no-wait");
  const text = argv.join(" ").trim() || (process.stdin.isTTY ? "" : (await readStdin()).trim());
  if (!text) die('usage: miniasys chat [--project <slug>] "message"   (or pipe the message in)');
  const { runId } = await c.call<{ runId: string }>("manager.send", { project, text });
  if (!wait) return console.log(`sent; Luna is answering in run ${runId}`);
  process.stderr.write("Luna is thinking");
  for (;;) {
    await sleep(2000);
    const { run } = await c.call<{ run: { status: string; error: string | null } }>("runs.get", { id: runId });
    process.stderr.write(".");
    if (!FINAL.has(run.status)) continue;
    process.stderr.write("\n");
    if (run.status !== "succeeded") die(`the run ${run.status}: ${run.error ?? ""}`);
    break;
  }
  const t = await c.call<{ messages: { role: string; text: string; runId: string | null }[]; plans: { approvalId: string; summary: string; cards: number }[] }>("manager.thread", { project, limit: 10 });
  const answer = t.messages.filter((m) => m.role === "assistant" && m.runId === runId).map((m) => m.text).join("\n\n");
  if (asJson) return out({ runId, answer, plans: t.plans });
  console.log(answer || "(no answer)");
  for (const p of t.plans) console.log(`\nplan waiting for approval (${p.cards} cards): ${p.summary}\n  approve: miniasys approvals decide ${p.approvalId} --decision approve`);
}

/** Follows a run's transcript until it ends. */
async function tail(c: Client) {
  const id = argv[0] ?? die("usage: miniasys tail <run id>");
  let after = 0;
  for (;;) {
    const evs = await c.call<{ seq: number; type: string; data: Record<string, unknown> }[]>("runs.events", { id, after });
    for (const e of evs) {
      after = e.seq;
      const d = e.data;
      const body = typeof d.text === "string" ? d.text : typeof d.summary === "string" ? d.summary : JSON.stringify(d);
      console.log(asJson ? JSON.stringify(e) : `${String(e.seq).padStart(4)} ${e.type.padEnd(12)} ${body.length > 400 ? `${body.slice(0, 400)}…` : body}`);
    }
    const { run } = await c.call<{ run: { status: string; error: string | null; summary: string | null } }>("runs.get", { id });
    if (FINAL.has(run.status) && !evs.length) {
      if (!asJson) console.log(`── ${run.status}${run.error ? `: ${run.error}` : ""}`);
      return;
    }
    await sleep(1500);
  }
}

/** Prints bus events as they happen (default: runs, inbox, manager, journal, meetings). */
async function watch(c: Client) {
  const topics = argv.length ? argv : ["runs", "inbox", "manager", "journal*", "meetings*", "cards*"];
  for await (const e of c.events(topics)) console.log(asJson ? JSON.stringify(e) : `${new Date().toTimeString().slice(0, 8)} ${e.topic} ${e.type} ${JSON.stringify(e.data)}`);
}

const COLUMNS = ["backlog", "ready", "in_progress", "checks", "in_review", "pr_open", "blocked", "done"];

async function board(c: Client) {
  const project = argv[0] ?? die("usage: miniasys board <project>");
  const b = await c.call<{ cards: { number: number; title: string; status: string; priority: string; agent: string | null; blocked_reason: string | null }[] }>("projects.board", { project });
  if (asJson) return out(b);
  for (const col of COLUMNS) {
    const cards = b.cards.filter((x) => x.status === col);
    if (!cards.length) continue;
    console.log(`\n${col.toUpperCase()} (${cards.length})`);
    for (const x of cards) console.log(`  #${x.number}  ${x.title}${x.agent ? `  @${x.agent}` : ""}${x.priority !== "medium" ? `  [${x.priority}]` : ""}${x.blocked_reason ? `  (${x.blocked_reason})` : ""}`);
  }
}

/** Runs a project's script with flags typed by its main() (`miniasys run demo etl.py --day 2026-11-01`), waits, prints its output and result. */
async function runScript(c: Client) {
  const [project, script, ...rest] = argv;
  if (!project || !script) die("usage: miniasys run <project> <script> [--arg value …] [--no-wait]");
  const wait = !rest.includes("--no-wait");
  const flags = rest.filter((a) => a !== "--no-wait");
  const sc = await c.call<{ script: { args: Record<string, unknown> } }>("scripts.get", { project, script });
  const parsed = parseInput(sc.script.args as never, flags);
  const args = parsed.stdin ? { ...JSON.parse((await readStdin()) || "{}"), ...parsed.input } : parsed.input;
  const r = await c.call<{ runId: string; status: string; result?: unknown; error?: string | null; output?: string; note?: string }>("scripts.run", { project, script, args, wait, wait_s: 900 });
  if (asJson) return out(r);
  if (!wait) return console.log(`started run ${r.runId}; follow it with: miniasys tail ${r.runId}`);
  if (r.output) console.log(r.output);
  console.error(`── ${r.status}${r.error ? `: ${r.error}` : ""}${r.note ? ` (${r.note})` : ""}  run ${r.runId}`);
  if (r.result !== undefined && r.result !== null) console.log(typeof r.result === "string" ? r.result : JSON.stringify(r.result, null, 2));
  if (r.status !== "succeeded") process.exitCode = 1;
}

/** The MCP server over stdio, for harnesses that don't speak HTTP: the same tools as /mcp. */
async function mcp(c: Client) {
  const { buildMcpServer } = await import("@miniasys/harness/mcp");
  const { StdioServerTransport } = await import("@modelcontextprotocol/server/stdio");
  const cat = await c.catalog();
  const server = buildMcpServer({ ops: cat.ops, call: (op, input) => c.call(op, input) });
  await server.connect(new StdioServerTransport());
}

// ------------------------------------------------------------------ every operation, from the catalog

function groups(ops: OpInfo[]) {
  const g = new Map<string, OpInfo[]>();
  for (const op of ops) {
    const [domain] = op.name.split(".");
    g.set(domain!, [...(g.get(domain!) ?? []), op]);
  }
  return g;
}

function usage(cat: Catalog | null) {
  const lines = [
    "miniasys: the Orbitalia Moon CLI. Every operation of the platform is a command.",
    "",
    "  miniasys <domain> <action> [--option value …]   run an operation (--help after it lists its options)",
    "  miniasys login [--url U] [--token T]            log in (password → a new API token)",
    "  miniasys chat [--project P] \"message\"           talk to Luna and wait for her answer",
    "  miniasys board <project>                        a project's board by column",
    "  miniasys run <project> <script> [--arg v …]     run a script (flags from its main()) and wait for its result",
    "  miniasys tail <run id>                          follow a run's transcript",
    "  miniasys watch [topics…]                        live events",
    "  miniasys mcp                                    the MCP server over stdio",
    "  miniasys ops                                    every operation with its summary",
    "  miniasys whoami | logout",
    "",
    "Options everywhere: --raw (JSON output), --as <agent> (act as an agent), --json '{…}' or --json - (input as JSON),",
    "  and any text option from a file or stdin: --body @notes.md, --body -.",
  ];
  if (cat) {
    lines.push("", "Domains:");
    for (const [d, ops] of groups(cat.ops)) lines.push(`  ${d.padEnd(10)} ${ops.map((o) => o.name.split(".").slice(1).join(".") || "(run)").join(", ")}`);
  }
  console.log(lines.join("\n"));
}

async function runOp(c: Client, cat: Catalog) {
  // `cards create …`, `search …` (a domain that is itself an operation), or the dotted name
  let op: OpInfo | undefined;
  let rest: string[] = [];
  const dotted = cat.ops.find((o) => o.name === argv[0]);
  const two = cat.ops.find((o) => o.name === `${argv[0]}.${argv[1]}`);
  if (two) [op, rest] = [two, argv.slice(2)];
  else if (dotted) [op, rest] = [dotted, argv.slice(1)];
  if (!op && argv[1] && !argv[1].startsWith("-")) {
    // not in this caller's catalog: the server says whether it exists and what access it needs
    return out(await c.call(`${argv[0]}.${argv[1]}`, {}));
  }
  if (!op) {
    const inDomain = cat.ops.filter((o) => o.name.startsWith(`${argv[0]}.`));
    if (inDomain.length) die(`${argv[1] ? `no action "${argv[1]}" in ${argv[0]}; ` : ""}${argv[0]} actions:\n${inDomain.map((o) => `  ${o.name.split(".")[1]!.padEnd(16)} ${o.summary}`).join("\n")}`);
    die(`unknown command: ${argv.join(" ")}\nrun \`miniasys help\` for the commands`);
  }
  if (rest.includes("--help") || rest.includes("-h")) {
    const lines = describe(op!.inputSchema as never);
    return console.log(`miniasys ${op!.name.replace(".", " ")} — ${op!.summary}\naccess: ${op!.access}${op!.destructive ? " (destructive)" : ""}\n${lines.length ? `\n${lines.join("\n")}` : "\n  (no options)"}`);
  }
  const parsed = parseInput(op!.inputSchema as never, rest);
  const input: Record<string, unknown> = parsed.stdin ? { ...JSON.parse((await readStdin()) || "{}"), ...parsed.input } : parsed.input;
  // long text from a file or stdin: --body @notes.md, --body -
  for (const [k, v] of Object.entries(input)) {
    if (v === "-" && !parsed.stdin) input[k] = await readStdin();
    else if (typeof v === "string" && v.startsWith("@") && existsSync(v.slice(1))) input[k] = readFileSync(v.slice(1), "utf8");
  }
  out(await c.call(op!.name, input));
}

async function main() {
  const cmd = argv[0];
  if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") {
    const c = loadConfig();
    return usage(c ? await new Client(c).catalog().catch(() => null) : null);
  }
  if (cmd === "login") return argv.shift(), login();
  if (cmd === "logout") return logout();
  const c = client();
  switch (cmd) {
    case "whoami": {
      const cat = await c.catalog();
      return out({ url: c.url, ...cat.caller, operations: cat.ops.length });
    }
    case "ops": {
      const cat = await c.catalog();
      return out(cat.ops.filter((o) => !argv[1] || o.name.includes(argv[1])).map((o) => ({ command: o.name.replace(".", " "), access: o.access, summary: o.summary })));
    }
    case "chat":
      return argv.shift(), chat(c);
    case "tail":
      return argv.shift(), tail(c);
    case "watch":
      return argv.shift(), watch(c);
    case "board":
      return argv.shift(), board(c);
    case "mcp":
      return mcp(c);
    case "run":
      return argv.shift(), runScript(c);
  }
  return runOp(c, await c.catalog());
}

main().catch((e: unknown) => {
  if (e instanceof ApiError) die(`${e.code}: ${e.message}`, e.status === 404 ? 4 : e.status === 401 || e.status === 403 ? 3 : 1);
  if (e instanceof ArgError) die(e.message, 2);
  if ((e as { cause?: { code?: string } })?.cause?.code === "ECONNREFUSED") die(`can't reach Orbitalia Moon at ${loadConfig()?.url ?? DEFAULT_URL}: is it running?`);
  die((e as Error)?.stack ?? String(e));
});
