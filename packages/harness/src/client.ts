// A small client for the Orbitalia Moon API: the catalog, operations and the event
// stream. Used by the CLI and its stdio MCP server; anything with fetch can use it.
import { ApiError, type Catalog } from "./catalog.ts";

export interface ClientOptions {
  url: string;
  token: string;
  /** act as this agent (X-Orbitalia Moon-Agent); only for a token not bound to an agent */
  agent?: string | null;
  fetch?: typeof fetch;
}

export class Client {
  readonly url: string;
  private f: typeof fetch;

  constructor(private o: ClientOptions) {
    this.url = o.url.replace(/\/+$/, "");
    this.f = o.fetch ?? fetch;
  }

  private headers(extra: Record<string, string> = {}) {
    return { authorization: `Bearer ${this.o.token}`, ...(this.o.agent ? { "x-miniasys-agent": this.o.agent } : {}), ...extra };
  }

  private async body(res: Response): Promise<unknown> {
    const text = await res.text();
    let b: { ok?: boolean; data?: unknown; error?: { code: string; message: string; issues?: unknown } } | null = null;
    try {
      b = JSON.parse(text);
    } catch {
      /* not JSON: an HTML error page or a proxy */
    }
    if (!res.ok || b?.ok === false) {
      const e = b?.error;
      throw new ApiError(res.status, e?.code ?? "error", e?.message ?? (text.slice(0, 300) || res.statusText), e?.issues);
    }
    return b && "data" in b ? b.data : b;
  }

  async catalog(): Promise<Catalog> {
    const res = await this.f(`${this.url}/api/v1/ops`, { headers: this.headers() });
    return (await this.body(res)) as Catalog;
  }

  async call<T = unknown>(op: string, input: unknown = {}): Promise<T> {
    const res = await this.f(`${this.url}/api/v1/ops/${encodeURIComponent(op)}`, {
      method: "POST",
      headers: this.headers({ "content-type": "application/json" }),
      body: JSON.stringify(input ?? {}),
    });
    return (await this.body(res)) as T;
  }

  /** Bus events (e.g. runs, run:<id>, cards:<projectId>, inbox, manager, journal:*) until the signal aborts. */
  async *events(topics: string[], signal?: AbortSignal): AsyncGenerator<{ topic: string; type: string; data: unknown }> {
    const res = await this.f(`${this.url}/api/v1/stream?topics=${encodeURIComponent(topics.join(","))}`, { headers: this.headers({ accept: "text/event-stream" }), signal });
    if (!res.ok || !res.body) throw new ApiError(res.status, "error", `stream: HTTP ${res.status}`);
    const dec = new TextDecoder();
    let buf = "";
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      buf += dec.decode(chunk, { stream: true });
      let i: number;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const frame = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const data = frame.split("\n").filter((l) => l.startsWith("data: ")).map((l) => l.slice(6)).join("\n");
        if (data) yield JSON.parse(data);
      }
    }
  }

  /** Trades Lucas's password for a new token (POST /api/v1/auth/token). */
  static async login(url: string, password: string, name: string, access: "read" | "write" | "admin" = "admin", f: typeof fetch = fetch) {
    const res = await f(`${url.replace(/\/+$/, "")}/api/v1/auth/token`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password, name, access }) });
    const b = (await res.json().catch(() => null)) as { ok: boolean; data?: { token: string; name: string; access: string }; error?: { code: string; message: string } } | null;
    if (!res.ok || !b?.ok || !b.data) throw new ApiError(res.status, b?.error?.code ?? "error", b?.error?.message ?? `HTTP ${res.status}`);
    return b.data;
  }
}
