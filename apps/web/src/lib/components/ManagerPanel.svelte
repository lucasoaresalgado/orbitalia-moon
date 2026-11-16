<script lang="ts">
  // The chat side panel (Ctrl J), on every page: Luna by default, or any agent.
  // Full screen on phones.
  import { Maximize2, X } from "@lucide/svelte";
  import ManagerChat from "./ManagerChat.svelte";
  import AgentMoon from "./AgentMoon.svelte";
  let { scope, onclose }: { scope: { slug: string; name: string } | null; onclose: () => void } = $props();
  let agent = $state("luna");
</script>

<aside class="fixed inset-0 z-50 flex flex-col bg-surface-1 sm:static sm:inset-auto sm:z-auto sm:w-[380px] sm:shrink-0 sm:border-l sm:border-line" aria-label="Chat">
  <div class="flex h-12 items-center gap-2 border-b border-line px-3">
    <AgentMoon slug={agent} size={22} />
    <span class="font-semibold">{agent === "luna" ? "Luna" : `a/${agent}`}</span>
    <span class="truncate text-[11px] text-muted">{scope ? `p/${scope.slug}` : "all projects"}</span>
    <a class="btn btn-ghost ml-auto px-1" href="/manager?agent={agent}" title="Expand" aria-label="Open the full chat"><Maximize2 size={14} /></a>
    <button class="btn btn-ghost px-1" onclick={onclose} aria-label="Close chat panel"><X size={16} /></button>
  </div>
  <ManagerChat {scope} bind:agent dense picker />
</aside>
