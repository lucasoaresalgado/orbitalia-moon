// Live updates from /api/stream (SSE). The browser's EventSource reconnects by itself.
import type { BusEvent } from "@miniasys/core/shared";

export function live(topics: string[], onEvent: (ev: BusEvent) => void): () => void {
  const es = new EventSource(`/api/stream?topics=${encodeURIComponent(topics.join(","))}`);
  es.onmessage = (m) => {
    try {
      onEvent(JSON.parse(m.data) as BusEvent);
    } catch {
      /* keep-alive */
    }
  };
  return () => es.close();
}

/** Calls `f` at most once per `ms`, trailing. */
export function throttle(f: () => void, ms = 400) {
  let t: ReturnType<typeof setTimeout> | null = null;
  return () => {
    if (t) return;
    t = setTimeout(() => {
      t = null;
      f();
    }, ms);
  };
}
