<script lang="ts">
  // A project's scripts (scope §26): Python, TypeScript, Bash and DuckDB SQL files
  // under scripts/ in its code, run in the sandbox with its variables and storage.
  import { onMount, untrack } from "svelte";
  import { goto, invalidateAll } from "$app/navigation";
  import { ago } from "#lib/format.ts";
  import { live, throttle } from "#lib/stream.ts";
  import { op } from "#lib/api.ts";

  let { data } = $props();
  const base = $derived(`/projects/${data.project.slug}/scripts`);
  let name = $state("");
  let lang = $state("py");
  let err = $state("");
  const STATUS: Record<string, string> = { succeeded: "text-ok", failed: "text-bad", running: "text-accent", queued: "text-muted", canceled: "text-muted", timed_out: "text-bad" };
  const TEMPLATES: Record<string, string> = {
    py: '"""What this script does."""\n# requirements: (optional) e.g. pandas==2.2 requests\nimport os\n\n\ndef main(name: str = "world", times: int = 1):\n    # variables are environment variables (os.environ); write files to /storage\n    return {"greeting": f"hello {name}", "times": times}\n',
    ts: '// What this script does.\n// npm packages: add them to the project\'s package.json\n\nexport async function main(name = "world", times = 1) {\n  // variables are in process.env; write files to /storage\n  return { greeting: `hello ${name}`, times };\n}\n',
    sh: '#!/bin/bash\n# What this script does.\n# arg: name string world\n# arg: times integer 1\nset -euo pipefail\nfor i in $(seq 1 "$2"); do echo "hello $1"; done\necho \'{"ok": true}\'\n',
    sql: "-- What this query does (DuckDB; runs in /storage).\n-- arg: min_rows integer 0\nSELECT 42 AS answer WHERE 1 >= getvariable('min_rows');\n",
  };

  async function create() {
    err = "";
    const file = `${name.replace(/\.(py|ts|sh|sql)$/, "")}.${lang}`;
    try {
      await op("scripts.save", { project: data.project.slug, script: file, code: TEMPLATES[lang], message: `create scripts/${file}` });
      await goto(`${base}/scripts/${file}`);
    } catch (e) {
      err = (e as Error).message;
    }
  }
  onMount(() => live([`scripts:${untrack(() => data.project.id)}`, `files:${untrack(() => data.project.id)}`], throttle(() => void invalidateAll(), 600)));
</script>

<svelte:head><title>Scripts · {data.project.name}</title></svelte:head>
<div class="max-w-5xl space-y-6 p-4">
  {#if data.pending}<p class="border-l-2 border-warn pl-2 text-warn">{data.pending}</p>{/if}
  <form class="flex items-center gap-2" onsubmit={(e) => { e.preventDefault(); void create(); }}>
    <input class="input mono w-64" placeholder="new script name, e.g. daily_sync" bind:value={name} aria-label="Script name" />
    <select class="input w-36" bind:value={lang} aria-label="Language"><option value="py">Python</option><option value="ts">TypeScript</option><option value="sh">Bash</option><option value="sql">DuckDB SQL</option></select>
    <button class="btn btn-primary" disabled={!/^[a-zA-Z0-9][a-zA-Z0-9_/-]*$/.test(name)}>New script</button>
    {#if err}<span class="text-[12px] text-bad">{err}</span>{/if}
  </form>

  <div class="panel">
    {#each data.scripts as s}
      <a class="row hover:bg-surface-2" href="{base}/{s.path}">
        <span class="mono w-64 truncate">{s.path.replace(/^scripts\//, "")}</span>
        <span class="w-24 text-[12px] text-muted">{s.language}</span>
        <span class="flex-1 truncate text-fg-2">{s.description ?? ""}</span>
        {#if s.scheduleEnabled}<span class="mono text-[12px] text-accent" title="schedule">⏱ {s.schedule}</span>{/if}
        {#if s.network}<span class="text-[11px] text-warn">network</span>{/if}
        <span class="w-24 text-right text-[12px] {STATUS[s.lastStatus ?? ''] ?? 'text-muted'}">{s.lastStatus ?? "never run"}</span>
        <span class="w-20 text-right text-[12px] text-muted">{s.lastAt ? ago(s.lastAt) : ""}</span>
      </a>
    {:else}<p class="p-4 text-muted">No scripts yet. Create one above; scripts are files under <span class="mono">scripts/</span> in the project's code.</p>{/each}
  </div>

  {#if data.runs.length}
    <section>
      <h2 class="mb-2 text-[14px] font-semibold">Recent runs</h2>
      <div class="panel">
        {#each data.runs as r}
          <a class="row text-[12px] hover:bg-surface-2" href="{base}/{r.path}?run={r.id}">
            <span class="w-24 {STATUS[r.status] ?? ''}">{r.status}</span><span class="mono w-56 truncate">{r.path.replace(/^scripts\//, "")}</span>
            <span class="w-24 text-muted">{r.trigger}</span><span class="mono flex-1 truncate text-fg-2">{r.error ?? r.summary ?? ""}</span><span class="w-20 text-right text-muted">{ago(r.created_at)}</span>
          </a>
        {/each}
      </div>
    </section>
  {/if}
</div>
