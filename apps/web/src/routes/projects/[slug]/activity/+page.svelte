<script lang="ts">
  import { time } from "#lib/format.ts";
  let { data } = $props();
  const text = (e: (typeof data.events)[number]) => {
    const p = e.payload as Record<string, any>;
    if (e.type === "status_change") return `${p.from ?? "—"} → ${p.to}${p.reason ? ` (${p.reason})` : ""}`;
    return String(p.message ?? p.text ?? p.summary ?? p.type ?? "").slice(0, 200);
  };
</script>

<div class="p-4">
  <div class="panel">
    {#each data.events as e}
      <a class="row" href="/projects/{data.project.slug}?card={e.number}">
        <span class="w-28 text-muted">{time(e.created_at)}</span><span class="mono w-10 text-muted">#{e.number}</span>
        <span class="mono w-32 truncate">{e.actor}</span><span class="w-24 text-fg-2">{e.type.replace("_", " ")}</span>
        <span class="flex-1 truncate">{text(e)}</span>
      </a>
    {:else}<p class="p-4 text-muted">Nothing yet.</p>{/each}
  </div>
</div>
