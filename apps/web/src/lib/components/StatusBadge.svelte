<script lang="ts">
  // Status is never conveyed by color alone (scope §18.2): an icon and a label go with it.
  import { Circle, LoaderCircle, PauseCircle, CheckCircle2, XCircle, MinusCircle, Clock, GitPullRequest, Eye } from "@lucide/svelte";
  let { status, reason = null, compact = false }: { status: string; reason?: string | null; compact?: boolean } = $props();

  const map: Record<string, { c: string; icon: typeof Circle; label?: string }> = {
    queued: { c: "text-muted", icon: Clock },
    backlog: { c: "text-muted", icon: Circle },
    ready: { c: "text-fg-2", icon: Circle },
    running: { c: "text-info", icon: LoaderCircle },
    in_progress: { c: "text-info", icon: LoaderCircle, label: "in progress" },
    checks: { c: "text-info", icon: Eye },
    in_review: { c: "text-info", icon: Eye, label: "in review" },
    pr_open: { c: "text-accent", icon: GitPullRequest, label: "PR open" },
    waiting_approval: { c: "text-warn", icon: PauseCircle, label: "waiting approval" },
    waiting_input: { c: "text-warn", icon: PauseCircle, label: "waiting input" },
    blocked: { c: "text-warn", icon: PauseCircle },
    pending: { c: "text-warn", icon: PauseCircle },
    succeeded: { c: "text-ok", icon: CheckCircle2 },
    done: { c: "text-ok", icon: CheckCircle2 },
    approved: { c: "text-ok", icon: CheckCircle2 },
    ok: { c: "text-ok", icon: CheckCircle2 },
    failed: { c: "text-bad", icon: XCircle },
    timed_out: { c: "text-bad", icon: XCircle, label: "timed out" },
    rejected: { c: "text-bad", icon: XCircle },
    error: { c: "text-bad", icon: XCircle },
    denied: { c: "text-bad", icon: XCircle },
    canceled: { c: "text-muted", icon: MinusCircle },
  };
  const m = $derived(map[status] ?? { c: "text-muted", icon: Circle });
  const Icon = $derived(m.icon);
</script>

<span class="inline-flex items-center gap-1 {m.c}" title={reason ? `${status}: ${reason}` : status}>
  <Icon size={13} class={status === "running" || status === "in_progress" ? "pulse" : ""} />
  {#if !compact}<span class="text-[12px]">{m.label ?? status}{reason ? ` · ${reason.replace("_", " ")}` : ""}</span>{/if}
</span>
