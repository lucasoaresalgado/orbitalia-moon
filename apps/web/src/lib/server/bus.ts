// One LISTEN connection per web process, fanned out to SSE subscribers by topic
// (scope §18.7).
import { PG_CHANNEL, type BusEvent } from "@miniasys/core";
import { sql } from "./db.ts";

type Listener = (ev: BusEvent) => void;
const subs = new Set<{ topics: string[]; fn: Listener }>();
let listening: Promise<unknown> | null = null;

function matches(topics: string[], topic: string) {
  return topics.some((t) => t === topic || (t.endsWith("*") && topic.startsWith(t.slice(0, -1))));
}

export function subscribe(topics: string[], fn: Listener): () => void {
  listening ??= sql().listen(PG_CHANNEL, (payload) => {
    let ev: BusEvent;
    try {
      ev = JSON.parse(payload) as BusEvent;
    } catch {
      return;
    }
    for (const s of subs) if (matches(s.topics, ev.topic)) s.fn(ev);
  });
  const entry = { topics, fn };
  subs.add(entry);
  return () => subs.delete(entry);
}
