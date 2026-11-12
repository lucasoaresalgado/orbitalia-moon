<script lang="ts">
  import ManagerChat from "#lib/components/ManagerChat.svelte";
  import { page } from "$app/state";
</script>

<svelte:head><title>Manager · Orbitalia Moon</title></svelte:head>
<div class="h-full"><ManagerChat scope={page.data.scope} /></div>
