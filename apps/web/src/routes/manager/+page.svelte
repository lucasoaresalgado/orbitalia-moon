<script lang="ts">
  // The chat page: Luna by default, or any agent (?agent=<slug>), picked in the bar on top.
  import { untrack } from "svelte";
  import { replaceState } from "$app/navigation";
  import ManagerChat from "#lib/components/ManagerChat.svelte";
  import { page } from "$app/state";
  let agent = $state(untrack(() => page.url.searchParams.get("agent") || "luna"));
  $effect(() => {
    const a = agent;
    untrack(() => {
      if ((page.url.searchParams.get("agent") || "luna") === a) return;
      const u = new URL(page.url.href);
      if (a === "luna") u.searchParams.delete("agent");
      else u.searchParams.set("agent", a);
      replaceState(u, {});
    });
  });
</script>

<svelte:head><title>Chat · Orbitalia Moon</title></svelte:head>
<div class="h-full"><ManagerChat scope={page.data.scope} bind:agent picker /></div>
