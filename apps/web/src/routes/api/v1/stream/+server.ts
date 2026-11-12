// Server-Sent Events fed by Postgres LISTEN/NOTIFY (scope §18.7).
import { subscribe } from "#lib/server/bus.ts";

export const GET = ({ url, request }) => {
  const topics = (url.searchParams.get("topics") ?? "").split(",").map((t) => t.trim()).filter(Boolean).slice(0, 20);
  let unsub = () => {};
  let ping: ReturnType<typeof setInterval>;
  const stream = new ReadableStream({
    start(ctrl) {
      const enc = new TextEncoder();
      const send = (s: string) => {
        try {
          ctrl.enqueue(enc.encode(s));
        } catch {
          /* closed */
        }
      };
      send(": connected\n\n");
      unsub = subscribe(topics, (ev) => send(`data: ${JSON.stringify(ev)}\n\n`));
      ping = setInterval(() => send(": ping\n\n"), 25_000);
      request.signal.addEventListener("abort", () => {
        unsub();
        clearInterval(ping);
        try {
          ctrl.close();
        } catch {}
      });
    },
    cancel() {
      unsub();
      clearInterval(ping);
    },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" } });
};
