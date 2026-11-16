<script lang="ts">
  import Logo from "#lib/components/Logo.svelte";
  let { data, form } = $props();
</script>

<svelte:head><title>Orbitalia Moon · Log in</title></svelte:head>

<div class="login relative flex min-h-screen flex-col items-center justify-center gap-8 overflow-hidden p-4">
  <div class="stars" aria-hidden="true"></div>
  <div class="relative flex flex-col items-center gap-3 text-center">
    <Logo size={72} wordmark orbit />
    <p class="text-[11px] tracking-[0.35em] text-muted uppercase">Self-hosted AI engineering agent platform</p>
  </div>
  <form method="POST" action="?/login" class="panel relative w-full max-w-80 p-6 shadow-2xl shadow-black/40">
    {#if !data.configured}
      <p class="mb-3 border-l-2 border-warn pl-2 text-[12px] text-warn">No password set. Run <span class="mono">pnpm --filter @miniasys/web hash-password</span> and put the hash in APP_PASSWORD_HASH.</p>
    {/if}
    <label class="label" for="pw">Password</label>
    <input id="pw" name="password" type="password" class="input h-9" autocomplete="current-password" required />
    {#if form?.error}<p class="mt-2 border-l-2 border-bad pl-2 text-[12px] text-bad">{form.error}</p>{/if}
    <button class="btn btn-primary mt-4 h-9 w-full justify-center">Log in</button>
  </form>
  <p class="relative text-[11px] tracking-[0.25em] text-accent uppercase">Build. Deploy. Automate. With your AI agents.</p>
  <div class="horizon" aria-hidden="true"></div>
</div>

<style>
  .stars {
    position: absolute;
    inset: 0;
    background-image:
      radial-gradient(1px 1px at 12% 18%, #fff8 50%, transparent 51%), radial-gradient(1px 1px at 72% 12%, #fff6 50%, transparent 51%),
      radial-gradient(1.5px 1.5px at 85% 40%, #c9b8ff99 50%, transparent 51%), radial-gradient(1px 1px at 30% 70%, #fff5 50%, transparent 51%),
      radial-gradient(1px 1px at 55% 30%, #fff4 50%, transparent 51%), radial-gradient(1.5px 1.5px at 8% 82%, #c9b8ff88 50%, transparent 51%),
      radial-gradient(1px 1px at 92% 78%, #fff5 50%, transparent 51%), radial-gradient(1px 1px at 44% 8%, #fff6 50%, transparent 51%);
    opacity: 0.8;
  }
  .horizon {
    position: absolute;
    left: 50%;
    bottom: -78vh;
    width: 180vw;
    height: 90vh;
    transform: translateX(-50%);
    border-radius: 50%;
    background: radial-gradient(ellipse at 50% 0%, #4b2fb0 0%, #1c1150 35%, transparent 70%);
    box-shadow: 0 -8px 60px #8b6cf055;
    pointer-events: none;
  }
  :global([data-theme="light"]) .horizon,
  :global([data-theme="win98"]) .horizon,
  :global([data-theme="light"]) .stars,
  :global([data-theme="win98"]) .stars {
    display: none;
  }
</style>
