<script lang="ts">
  import { Maximize2, X } from "@lucide/svelte";
  import ManagerChat from "./ManagerChat.svelte";
  let { scope, onclose }: { scope: { slug: string; name: string } | null; onclose: () => void } = $props();
</script>

<aside class="flex w-[380px] shrink-0 flex-col border-l border-line bg-surface-1" aria-label="Manager">
  <div class="flex h-11 items-center gap-2 border-b border-line px-3">
    <span class="font-semibold">Luna</span><span class="mono text-muted">a/luna</span>
    <span class="text-[11px] text-muted">{scope ? `p/${scope.slug}` : "all projects"}</span>
    <a class="btn btn-ghost ml-auto px-1" href="/manager" title="Expand"><Maximize2 size={14} /></a>
    <button class="btn btn-ghost px-1" onclick={onclose} aria-label="Close manager panel"><X size={14} /></button>
  </div>
  <ManagerChat {scope} dense />
</aside>
