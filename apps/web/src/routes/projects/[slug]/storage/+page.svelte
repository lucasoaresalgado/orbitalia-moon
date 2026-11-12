<script lang="ts">
  // A project's storage (scope §26): the folder its scripts write to (/storage),
  // and optionally an S3-compatible bucket. Browse, download, upload, delete.
  import { untrack } from "svelte";
  import { goto, invalidateAll } from "$app/navigation";
  import { Download, Trash2, Upload } from "@lucide/svelte";
  import { ago } from "#lib/format.ts";
  import { op } from "#lib/api.ts";

  let { data } = $props();
  const base = $derived(`/projects/${data.project.slug}/storage`);
  let err = $state("");
  let filter = $state("");
  const shown = $derived(data.items.filter((i) => !filter || i.key.includes(filter)));
  const size = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);

  async function download(key: string) {
    err = "";
    try {
      const o = await op<{ content: string; encoding: "utf8" | "base64" }>("storage.get", { project: data.project.slug, backend: data.backend, key });
      const bytes = o.encoding === "base64" ? Uint8Array.from(atob(o.content), (c) => c.charCodeAt(0)) : new TextEncoder().encode(o.content);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([bytes]));
      a.download = key.split("/").pop() ?? "file";
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      err = (e as Error).message;
    }
  }
  async function upload(ev: Event) {
    err = "";
    const input = ev.target as HTMLInputElement;
    for (const f of Array.from(input.files ?? [])) {
      const buf = new Uint8Array(await f.arrayBuffer());
      let bin = "";
      for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      const key = prompt("Save as (path in the storage):", `uploads/${f.name}`);
      if (!key) continue;
      try {
        await op("storage.put", { project: data.project.slug, backend: data.backend, key, content: btoa(bin), encoding: "base64" });
      } catch (e) {
        err = (e as Error).message;
      }
    }
    input.value = "";
    await invalidateAll();
  }
  async function remove(key: string) {
    if (!confirm(`Delete ${key}?`)) return;
    try {
      await op("storage.delete", { project: data.project.slug, backend: data.backend, key });
      await invalidateAll();
    } catch (e) {
      err = (e as Error).message;
    }
  }

  let s3 = $state(untrack(() => ({ endpoint: data.s3?.endpoint ?? "", bucket: data.s3?.bucket ?? "", prefix: data.s3?.prefix ?? "", region: data.s3?.region ?? "us-east-1", access_key_var: data.s3?.accessKeyVar ?? "S3_ACCESS_KEY_ID", secret_key_var: data.s3?.secretKeyVar ?? "S3_SECRET_ACCESS_KEY" })));
  async function saveS3(remove = false) {
    err = "";
    try {
      await op("storage.config", { project: data.project.slug, s3: remove ? null : { ...s3, endpoint: s3.endpoint.trim() || null } });
      await goto(remove ? base : `${base}?backend=s3`, { invalidateAll: true });
    } catch (e) {
      err = (e as Error).message;
    }
  }
</script>

<svelte:head><title>Storage · {data.project.name}</title></svelte:head>
<div class="max-w-5xl space-y-4 p-4">
  <div class="flex items-center gap-2">
    <a class="tab {data.backend === 'folder' ? 'tab-active' : ''}" href={base}>Folder <span class="mono text-[11px] text-muted">/storage</span></a>
    {#if data.s3}<a class="tab {data.backend === 's3' ? 'tab-active' : ''}" href="{base}?backend=s3">S3 <span class="mono text-[11px] text-muted">{data.s3.bucket}{data.s3.prefix ? `/${data.s3.prefix}` : ""}</span></a>{/if}
    <span class="flex-1"></span>
    <input class="input w-56" placeholder="Filter" bind:value={filter} aria-label="Filter" />
    <label class="btn cursor-pointer"><Upload size={13} /> Upload<input type="file" multiple class="hidden" onchange={upload} /></label>
  </div>
  {#if err || data.error}<p class="border-l-2 border-bad pl-2 text-bad">{err || data.error}</p>{/if}
  <div class="panel">
    {#each shown as i (i.key)}
      <div class="row text-[12.5px]">
        <span class="mono flex-1 truncate">{i.key}</span><span class="w-20 text-right text-muted">{size(i.size)}</span><span class="w-24 text-right text-muted">{i.modified ? ago(i.modified) : ""}</span>
        <button class="btn" onclick={() => download(i.key)} title="Download"><Download size={13} /></button>
        <button class="btn btn-danger" onclick={() => remove(i.key)} title="Delete"><Trash2 size={13} /></button>
      </div>
    {:else}<p class="p-4 text-muted">Empty. Scripts write here ({data.backend === "folder" ? "/storage" : "MINIASYS_S3"}); you can upload files too.</p>{/each}
  </div>

  <section class="panel space-y-2 p-3">
    <div class="label">S3-compatible storage (AWS, MinIO…) — optional</div>
    <p class="text-[12px] text-muted">Scripts get AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION, AWS_ENDPOINT_URL and MINIASYS_S3 (s3://bucket/prefix), and network access. The keys are secret variables of this project (Settings → Variables), named below.</p>
    <div class="grid grid-cols-3 gap-2">
      <input class="input" placeholder="endpoint (empty for AWS)" bind:value={s3.endpoint} aria-label="Endpoint" />
      <input class="input" placeholder="bucket" bind:value={s3.bucket} aria-label="Bucket" />
      <input class="input" placeholder="prefix (optional)" bind:value={s3.prefix} aria-label="Prefix" />
      <input class="input" placeholder="region" bind:value={s3.region} aria-label="Region" />
      <input class="input mono" bind:value={s3.access_key_var} aria-label="Access key variable" />
      <input class="input mono" bind:value={s3.secret_key_var} aria-label="Secret key variable" />
    </div>
    <div class="flex gap-2"><button class="btn" onclick={() => saveS3()} disabled={s3.bucket.length < 3}>Save S3</button>{#if data.s3}<button class="btn btn-danger" onclick={() => saveS3(true)}>Remove S3</button>{/if}</div>
  </section>
</div>
