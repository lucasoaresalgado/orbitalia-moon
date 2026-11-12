<script lang="ts">
  // A project's code (scope §26): its folder in Orbitalia Moon, a git repository. Every
  // save is a commit by you; agents' merged cards and harness edits show up here too.
  import { onMount, untrack } from "svelte";
  import { goto, invalidateAll } from "$app/navigation";
  import { File, Folder, History, Plus, Trash2, Pencil } from "@lucide/svelte";
  import CodeEditor from "#lib/components/CodeEditor.svelte";
  import { ago } from "#lib/format.ts";
  import { live, throttle } from "#lib/stream.ts";
  import { op } from "#lib/api.ts";

  let { data } = $props();
  const base = $derived(`/projects/${data.project.slug}/code`);
  let text = $state(untrack(() => (data.file?.encoding === "utf8" ? data.file.content : "")));
  let saved = $state(untrack(() => text));
  let message = $state("");
  let err = $state("");
  let busy = $state(false);
  const dirty = $derived(text !== saved);
  const old = $derived(!!data.version);

  // re-sync the editor when the loaded file changes (navigation, or a change made elsewhere)
  $effect(() => {
    const f = data.file;
    untrack(() => {
      if (dirty && f?.path === data.path) return;
      text = f?.encoding === "utf8" ? f.content : "";
      saved = text;
    });
  });

  const depth = (p: string) => p.split("/").length - 1;
  const name = (p: string) => p.split("/").pop();
  let closed = $state<Record<string, boolean>>({});
  const visible = $derived(data.tree.entries.filter((e) => !Object.keys(closed).some((d) => closed[d] && e.path.startsWith(`${d}/`))));
  const open = (path: string) => goto(`${base}?path=${encodeURIComponent(path)}`);

  async function save() {
    if (!data.path || old || !dirty) return;
    busy = true;
    err = "";
    try {
      await op("files.put", { project: data.project.slug, path: data.path, content: text, ...(message ? { message } : {}), ...(data.file?.base ? { base: data.file.base } : {}) });
      saved = text;
      message = "";
      await invalidateAll();
    } catch (e) {
      err = (e as Error).message;
    } finally {
      busy = false;
    }
  }
  async function newFile() {
    const p = prompt("New file (path in the project, e.g. scripts/etl.py):", data.path?.includes("/") ? `${data.path.slice(0, data.path.lastIndexOf("/"))}/` : "scripts/");
    if (!p) return;
    try {
      await op("files.put", { project: data.project.slug, path: p, content: "", message: `create ${p}` });
      await open(p);
    } catch (e) {
      err = (e as Error).message;
    }
  }
  async function rename() {
    if (!data.path) return;
    const to = prompt(`Move ${data.path} to:`, data.path);
    if (!to || to === data.path) return;
    try {
      await op("files.move", { project: data.project.slug, from: data.path, to });
      await open(to);
    } catch (e) {
      err = (e as Error).message;
    }
  }
  async function remove(path: string) {
    if (!confirm(`Delete ${path}? It stays in the history.`)) return;
    try {
      await op("files.delete", { project: data.project.slug, path });
      await goto(base);
    } catch (e) {
      err = (e as Error).message;
    }
  }
  onMount(() => live([`files:${untrack(() => data.project.id)}`], throttle(() => void invalidateAll(), 600)));
</script>

<svelte:head><title>Code · {data.project.name}</title></svelte:head>
{#if data.pending}
  <p class="m-4 border-l-2 border-warn pl-2 text-warn">{data.pending}</p>
{:else}
  <div class="flex h-full min-h-0">
    <aside class="flex w-64 shrink-0 flex-col border-r border-line">
      <div class="flex items-center gap-1 border-b border-line px-2 py-1.5">
        <span class="mono flex-1 truncate text-[11px] text-muted" title="the folder's current commit">{data.tree.head.slice(0, 8)}</span>
        <button class="btn" onclick={newFile} title="New file"><Plus size={13} /></button>
      </div>
      <nav class="min-h-0 flex-1 overflow-auto py-1 text-[12.5px]" aria-label="Files">
        {#each visible as e (e.path)}
          {#if e.type === "dir"}
            <button class="flex w-full items-center gap-1.5 px-2 py-0.5 text-left text-fg-2 hover:bg-surface-2" style="padding-left: {8 + depth(e.path) * 12}px" onclick={() => (closed[e.path] = !closed[e.path])}>
              <Folder size={13} /><span class="truncate">{name(e.path)}</span>
            </button>
          {:else}
            <button class="flex w-full items-center gap-1.5 px-2 py-0.5 text-left hover:bg-surface-2 {data.path === e.path ? 'bg-surface-3 text-fg' : 'text-fg-2'}" style="padding-left: {8 + depth(e.path) * 12}px" onclick={() => open(e.path)}>
              <File size={13} /><span class="truncate">{name(e.path)}</span>
            </button>
          {/if}
        {:else}<p class="p-3 text-muted">Empty.</p>{/each}
      </nav>
    </aside>

    <section class="flex min-w-0 flex-1 flex-col">
      {#if data.path && data.file}
        <div class="flex items-center gap-2 border-b border-line px-3 py-1.5">
          <span class="mono truncate">{data.path}</span>
          {#if old}<span class="text-[12px] text-warn">at {data.version?.slice(0, 8)} (read-only)</span><a class="btn" href="{base}?path={encodeURIComponent(data.path)}">Latest</a>{/if}
          {#if dirty}<span class="text-[12px] text-warn">unsaved</span>{/if}
          <span class="flex-1"></span>
          {#if !old}
            <input class="input w-64" placeholder="Commit message (optional)" bind:value={message} aria-label="Commit message" />
            <button class="btn btn-primary" onclick={save} disabled={!dirty || busy}>Save</button>
            <button class="btn" onclick={rename} title="Move or rename"><Pencil size={13} /></button>
            <button class="btn btn-danger" onclick={() => remove(data.path!)} title="Delete"><Trash2 size={13} /></button>
          {/if}
        </div>
        {#if err}<p class="border-l-2 border-bad px-3 py-1 text-bad">{err}</p>{/if}
        <div class="flex min-h-0 flex-1">
          <div class="min-w-0 flex-1 p-2">
            {#if data.file.encoding === "base64"}<p class="p-4 text-muted">A binary file ({data.file.size} bytes).</p>
            {:else}<CodeEditor bind:value={text} path={data.path} readonly={old} onsave={save} height="calc(100vh - 170px)" />{/if}
          </div>
          <aside class="w-56 shrink-0 overflow-auto border-l border-line p-2">
            <div class="label mb-1 flex items-center gap-1"><History size={12} /> History</div>
            {#each data.history as c}
              <a class="block rounded px-1.5 py-1 text-[12px] hover:bg-surface-2 {data.version === c.sha ? 'bg-surface-2' : ''}" href="{base}?path={encodeURIComponent(data.path)}&v={c.sha}">
                <div class="flex"><span class="mono text-muted">{c.sha.slice(0, 7)}</span><span class="ml-auto text-muted">{ago(c.date)}</span></div>
                <div class="truncate">{c.message}</div><div class="mono truncate text-muted">{c.author}</div>
              </a>
            {/each}
          </aside>
        </div>
      {:else}
        <div class="p-6 text-muted">
          <p>This project's code lives here, in Orbitalia Moon{data.project.repoFullName ? `, mirrored with ${data.project.repoFullName}` : ""}. Pick a file, or create one.</p>
          <p class="mt-2 text-[12px]">Cards work on branches of it; a reviewed card is merged in after you approve{data.project.repoFullName ? " (on GitHub, through its pull request)" : ""}. Scripts go in <span class="mono">scripts/</span>.</p>
          {#if err}<p class="mt-2 text-bad">{err}</p>{/if}
        </div>
      {/if}
    </section>
  </div>
{/if}
