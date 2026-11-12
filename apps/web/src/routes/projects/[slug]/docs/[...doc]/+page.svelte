<script lang="ts">
  import { untrack } from "svelte";
  import { page } from "$app/state";
  import { goto, invalidateAll } from "$app/navigation";
  import Markdown from "#lib/components/Markdown.svelte";
  import { time } from "#lib/format.ts";
  import { op } from "#lib/api.ts";

  let { data } = $props();
  const latest = $derived(data.history[0]?.version ?? 0);
  const old = $derived(!!data.doc && data.doc.version !== latest);
  let editing = $state(untrack(() => !data.doc || page.url.searchParams.has("edit")));
  let title = $state(untrack(() => data.doc?.title ?? data.slug.split("/").at(-1) ?? ""));
  let body = $state(untrack(() => data.doc?.body ?? ""));
  let note = $state("");
  let err = $state("");

  async function save() {
    err = "";
    try {
      await op("docs.put", { project: data.project.slug, doc: data.slug, title, body, base_version: latest, ...(note ? { note } : {}) });
      editing = false;
      note = "";
      await goto(`/projects/${data.project.slug}/docs/${data.slug}`, { invalidateAll: true });
    } catch (e) {
      err = (e as Error).message;
    }
  }
  async function remove() {
    if (!confirm(`Delete ${data.slug}? Its versions are kept for the record.`)) return;
    await op("docs.delete", { project: data.project.slug, doc: data.slug });
    await goto(`/projects/${data.project.slug}/docs`);
  }
</script>

<svelte:head><title>{data.doc?.title ?? data.slug} · Docs</title></svelte:head>
<div class="flex gap-6 p-4">
  <div class="min-w-0 max-w-4xl flex-1 space-y-3">
    <div class="flex items-center gap-2">
      <a class="text-muted hover:text-fg" href="/projects/{data.project.slug}/docs">Docs</a><span class="text-muted">/</span><span class="mono">{data.slug}</span>
      {#if data.doc}<span class="mono text-[12px] text-muted">v{data.doc.version} · {data.doc.updatedBy} · {time(data.doc.updatedAt)}</span>{/if}
      <span class="ml-auto"></span>
      {#if old}<a class="btn" href="/projects/{data.project.slug}/docs/{data.slug}">Latest</a>
      {:else if !editing}<button class="btn" onclick={() => (editing = true)}>Edit</button>{#if data.doc}<button class="btn btn-danger" onclick={remove}>Delete</button>{/if}{/if}
    </div>
    {#if old}<p class="border-l-2 border-warn pl-2 text-[12px] text-warn">An older version (v{data.doc?.version}); the latest is v{latest}.</p>{/if}
    {#if editing}
      <input class="input text-[15px] font-semibold" bind:value={title} aria-label="Title" />
      <textarea class="input mono min-h-[60vh] w-full" bind:value={body} aria-label="Body (markdown)"></textarea>
      <div class="flex items-center gap-2">
        <input class="input flex-1" placeholder="What changed (optional)" bind:value={note} aria-label="Change note" />
        {#if data.doc}<button class="btn" onclick={() => { editing = false; title = data.doc!.title; body = data.doc!.body; }}>Cancel</button>{/if}
        <button class="btn btn-primary" onclick={save} disabled={!title.trim()}>Save{data.doc ? ` v${latest + 1}` : ""}</button>
      </div>
      {#if err}<p class="border-l-2 border-bad pl-2 text-bad">{err}</p>{/if}
    {:else if data.doc}
      <h1 class="text-[18px] font-semibold">{data.doc.title}</h1>
      <div class="text-[14px]"><Markdown text={data.doc.body} /></div>
    {/if}
  </div>
  {#if data.history.length}
    <aside class="w-60 shrink-0">
      <div class="label mb-1">History</div>
      <div class="panel">
        {#each data.history as h}
          <a class="block px-2 py-1.5 text-[12px] hover:bg-surface-2 {data.doc?.version === h.version ? 'bg-surface-2' : ''}" href="?v={h.version}">
            <div class="flex"><span class="mono">v{h.version}</span><span class="ml-auto text-muted">{time(h.createdAt)}</span></div>
            <div class="mono truncate text-muted">{h.actor}</div>{#if h.note}<div class="truncate text-fg-2">{h.note}</div>{/if}
          </a>
        {/each}
      </div>
    </aside>
  {/if}
</div>
