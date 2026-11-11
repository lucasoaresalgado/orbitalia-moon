<script lang="ts">
  // Global shortcuts (scope §18.8): Ctrl+K palette, Ctrl+J manager, g h/b/r/c/i, ? help.
  import { goto } from "$app/navigation";
  let { helpOpen = $bindable(false), onpalette, onmanager }: { helpOpen?: boolean; onpalette: () => void; onmanager: () => void } = $props();
  let pendingG = false;
  let gTimer: ReturnType<typeof setTimeout>;
  const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));

  function key(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") return e.preventDefault(), onpalette();
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "j") return e.preventDefault(), onmanager();
    if (typing(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === "?") return (helpOpen = !helpOpen);
    if (e.key === "Escape") helpOpen = false;
    if (pendingG) {
      pendingG = false;
      const to = { h: "/", b: "/projects", r: "/runs", c: "/costs", i: "/inbox" }[e.key];
      if (to) void goto(to);
      return;
    }
    if (e.key === "g") {
      pendingG = true;
      clearTimeout(gTimer);
      gTimer = setTimeout(() => (pendingG = false), 800);
    }
  }
  const rows = [["Ctrl K", "Command palette"], ["Ctrl J", "Toggle manager panel"], ["g h / g b / g r / g c / g i", "Home / Board / Runs / Costs / Inbox"], ["n", "New card (on a board)"], ["Esc", "Close the top drawer"], ["?", "This help"]];
</script>

<svelte:window onkeydown={key} />

{#if helpOpen}
  <div class="fixed inset-0 z-50 bg-black/40" role="presentation" onclick={() => (helpOpen = false)}></div>
  <div class="panel fixed top-1/4 left-1/2 z-50 w-[420px] -translate-x-1/2 p-4 shadow-2xl" role="dialog" aria-label="Keyboard shortcuts">
    <h2 class="mb-2 font-semibold">Keyboard shortcuts</h2>
    {#each rows as [k, v]}<div class="flex justify-between py-1"><kbd class="mono text-fg-2">{k}</kbd><span class="text-muted">{v}</span></div>{/each}
  </div>
{/if}
