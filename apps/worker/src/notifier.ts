// Inbox + ntfy (scope §16). One HTTP call per phone alert; the inbox row is
// always written first, so an ntfy outage never loses a notification.
import { CHANNELS } from "@miniasys/core";
import { notifications, publish, eq, type Database } from "@miniasys/db";
import type { Logger } from "pino";

export interface Notice {
  level: "info" | "warn" | "critical";
  title: string;
  body?: string;
  link?: string;
  /** phone priority, or false for inbox only */
  ntfy?: false | "low" | "default" | "high";
}

export class Notifier {
  constructor(
    private d: Database,
    private ntfy: { url: string; topic: string } | null,
    private publicUrl: string,
    private log: Logger,
  ) {}

  async notify(n: Notice): Promise<void> {
    const channels = n.ntfy && this.ntfy ? ["inbox", "ntfy"] : ["inbox"];
    const [row] = await this.d.db.insert(notifications).values({ level: n.level, title: n.title, body: n.body ?? null, link: n.link ?? null, channels }).returning();
    await publish(this.d.sql, { topic: CHANNELS.inbox, type: "notification", data: { id: row!.id } });
    if (!n.ntfy || !this.ntfy) return;
    try {
      const res = await fetch(`${this.ntfy.url.replace(/\/$/, "")}/${this.ntfy.topic}`, {
        method: "POST",
        body: (n.body ?? n.title).slice(0, 4000),
        headers: {
          Title: n.title.slice(0, 200),
          Priority: n.ntfy === "high" ? "high" : n.ntfy === "low" ? "low" : "default",
          ...(n.link ? { Click: new URL(n.link, this.publicUrl).toString() } : {}),
        },
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) await this.d.db.update(notifications).set({ sentAt: new Date() }).where(eq(notifications.id, row!.id));
      else this.log.warn({ status: res.status }, "ntfy refused the notification");
    } catch (e) {
      this.log.warn({ err: (e as Error).message }, "ntfy unreachable");
    }
  }
}
