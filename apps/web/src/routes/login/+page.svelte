<script lang="ts">
  let { data, form } = $props();
</script>

<svelte:head><title>Miniasys · Log in</title></svelte:head>

<div class="flex min-h-screen items-center justify-center p-4">
  <form method="POST" action="?/login" class="panel w-80 p-6">
    <div class="mb-5 flex items-center gap-2">
      <svg viewBox="0 0 32 32" class="h-6 w-6" aria-hidden="true"><circle cx="16" cy="16" r="8" fill="var(--opus)" /><circle cx="16" cy="16" r="13" fill="none" stroke="var(--accent)" stroke-width="1.5" stroke-dasharray="3 4" /><circle cx="27.5" cy="10" r="2.2" fill="var(--haiku)" /></svg>
      <span class="text-[15px] font-semibold">Miniasys</span>
    </div>
    {#if !data.configured}
      <p class="mb-3 border-l-2 border-warn pl-2 text-[12px] text-warn">No password set. Run <span class="mono">pnpm --filter @miniasys/web hash-password</span> and put the hash in APP_PASSWORD_HASH.</p>
    {/if}
    <label class="label" for="pw">Password</label>
    <input id="pw" name="password" type="password" class="input" autocomplete="current-password" required />
    {#if form?.error}<p class="mt-2 border-l-2 border-bad pl-2 text-[12px] text-bad">{form.error}</p>{/if}
    <button class="btn btn-primary mt-4 w-full justify-center">Log in</button>
  </form>
</div>
