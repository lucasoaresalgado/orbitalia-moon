<script lang="ts">
  import { page } from "$app/state";
  import RunDetail from "#lib/components/RunDetail.svelte";
</script>

<svelte:head><title>Run {page.params.id?.slice(0, 8)} · Orbitalia Moon</title></svelte:head>
<div class="mx-auto max-w-5xl"><RunDetail runId={page.params.id!} /></div>
