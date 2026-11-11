<script lang="ts">
  // Monospace path identifiers (p/…, p/…#n, a/…), copied on click.
  let { path, href = null }: { path: string; href?: string | null } = $props();
  let copied = $state(false);
  async function copy(e: MouseEvent) {
    if (href) return;
    e.preventDefault();
    await navigator.clipboard?.writeText(path);
    copied = true;
    setTimeout(() => (copied = false), 900);
  }
</script>

{#if href}
  <a {href} class="mono text-fg-2 hover:text-accent">{path}</a>
{:else}
  <button type="button" class="mono text-fg-2 hover:text-accent" onclick={copy} title="Copy">{copied ? "copied" : path}</button>
{/if}
