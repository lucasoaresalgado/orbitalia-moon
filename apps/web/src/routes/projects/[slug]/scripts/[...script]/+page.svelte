<script lang="ts">
  // A script (scope §26): edit and save it (a commit), run it with a form built
  // from main()'s arguments, follow its output live, and schedule it.
  import { onMount, untrack } from "svelte";
  import { invalidateAll } from "$app/navigation";
  import { ArrowLeft, Play, Square } from "@lucide/svelte";
  import CodeEditor from "#lib/components/CodeEditor.svelte";
  import { ago } from "#lib/format.ts";
  import { live, throttle } from "#lib/stream.ts";
  import { api, op } from "#lib/api.ts";

  let { data } = $props();
  type Prop = { type?: string; enum?: unknown[]; default?: unknown; anyOf?: Prop[]; items?: Prop };
  const STATUS: Record<string, string> = { succeeded: "text-ok", failed: "text-bad", running: "text-accent", queued: "text-muted", canceled: "text-muted", timed_out: "text-bad" };
  const FINAL = ["succeeded", "failed", "canceled", "timed_out"];

  let code = $state(untrack(() => data.code));
  let saved = $state(untrack(() => data.code));
  const dirty = $derived(code !== saved);
  let msg = $state("");
  let err = $state("");
  let busy = $state(false);

  // the arguments form, from the schema read off main()
  const fields = $derived(Object.entries((data.script.args.properties ?? {}) as Record<string, Prop>).sort(([a], [b]) => (data.script.args["x-order"] ?? []).indexOf(a) - (data.script.args["x-order"] ?? []).indexOf(b)));
  const typeOf = (p: Prop) => p.type ?? p.anyOf?.find((x) => x.type && x.type !== "null")?.type ?? (p.enum ? "enum" : "json");
  let values = $state<Record<string, string | boolean>>(untrack(() => Object.fromEntries(Object.entries((data.script.args.properties ?? {}) as Record<string, Prop>).map(([k, p]) => [k, p.default === undefined ? (typeOf(p) === "boolean" ? false : "") : typeOf(p) === "boolean" ? !!p.default : typeof p.default === "string" ? p.default : JSON.stringify(p.default)]))));
  function argsFromForm(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, p] of fields) {
      const v = values[k];
      const t = typeOf(p);
      if (t === "boolean") out[k] = !!v;
      else if (v === "" || v === undefined) continue;
      else if (t === "integer" || t === "number") out[k] = Number(v);
      else if (t === "string" || t === "enum") out[k] = v;
      else {
        try {
          out[k] = JSON.parse(String(v));
        } catch {
          throw new Error(`${k}: not valid JSON`);
        }
      }
    }
    return out;
  }

  // the run on screen: the one picked in the list, or the last one started here
  let runId = $state<string | null>(untrack(() => data.selectedRun ?? data.runs[0]?.id ?? null));
  let run = $state<{ status: string; result: unknown; error: string | null } | null>(null);
  let logs = $state<{ seq: number; text: string; stream: string }[]>([]);
  let stopFollow: (() => void) | null = null;
  async function follow(id: string) {
    stopFollow?.();
    runId = id;
    logs = [];
    run = null;
    let after = 0;
    const pull = async () => {
      const evs = await api<{ seq: number; type: string; data: { text?: string; stream?: string; message?: string } }[]>(`/api/runs/${id}/events?after=${after}`);
      for (const e of evs) {
        after = e.seq;
        if (e.type === "log") logs = [...logs, { seq: e.seq, text: e.data.text ?? "", stream: e.data.stream ?? "stdout" }];
      }
      const r = await api<{ run: { status: string; result: unknown; error: string | null } }>(`/api/runs/${id}`);
      run = r.run;
    };
    await pull();
    if (run && FINAL.includes((run as { status: string }).status)) return;
    stopFollow = live([`run:${id}`], throttle(() => void pull(), 300));
  }

  async function save() {
    if (!dirty) return;
    busy = true;
    err = msg = "";
    try {
      await op("scripts.save", { project: data.project.slug, script: data.path, code, ...(data.base ? { base: data.base } : {}) });
      saved = code;
      msg = "Saved.";
      await invalidateAll();
    } catch (e) {
      err = (e as Error).message;
    } finally {
      busy = false;
    }
  }
  async function start() {
    err = msg = "";
    try {
      if (dirty) await save();
      const r = await op<{ runId: string }>("scripts.run", { project: data.project.slug, script: data.path, args: argsFromForm() });
      await follow(r.runId);
    } catch (e) {
      err = (e as Error).message;
    }
  }
  async function stop() {
    if (runId) await op("runs.cancel", { id: runId });
  }

  let sched = $state(untrack(() => ({ network: data.script.network, timeout_s: data.script.timeoutS, mem_mb: data.script.memMb, schedule: data.script.schedule ?? "", schedule_args: JSON.stringify(data.script.scheduleArgs ?? {}), schedule_enabled: data.script.scheduleEnabled })));
  async function saveSettings() {
    err = msg = "";
    try {
      await op("scripts.settings", {
        project: data.project.slug, script: data.path, network: sched.network, timeout_s: Number(sched.timeout_s), mem_mb: Number(sched.mem_mb),
        schedule: sched.schedule.trim() || null, schedule_args: JSON.parse(sched.schedule_args || "{}"), schedule_enabled: sched.schedule_enabled,
      });
      msg = "Settings saved.";
      await invalidateAll();
    } catch (e) {
      err = (e as Error).message;
    }
  }

  onMount(() => {
    if (untrack(() => runId)) void follow(untrack(() => runId)!);
    return () => stopFollow?.();
  });
</script>

<svelte:head><title>{data.path} · Scripts</title></svelte:head>
<div class="flex h-full flex-col">
  <div class="flex items-center gap-2 border-b border-line px-3 py-1.5">
    <a href="/projects/{data.project.slug}/scripts" class="text-muted hover:text-fg" aria-label="Back"><ArrowLeft size={15} /></a>
    <span class="mono">{data.path}</span><span class="text-[12px] text-muted">{data.script.language}</span>
    {#if data.script.description}<span class="truncate text-[12px] text-fg-2">{data.script.description}</span>{/if}
    {#if dirty}<span class="text-[12px] text-warn">unsaved</span>{/if}
    <span class="flex-1"></span>
    {#if msg}<span class="text-[12px] text-ok">{msg}</span>{/if}
    <button class="btn" onclick={save} disabled={!dirty || busy}>Save</button>
  </div>
  {#if err}<p class="border-l-2 border-bad px-3 py-1 text-bad">{err}</p>{/if}
  <div class="flex min-h-0 flex-1">
    <div class="min-w-0 flex-1 p-2"><CodeEditor bind:value={code} path={data.path} onsave={save} height="calc(100vh - 160px)" /></div>
    <aside class="w-[26rem] shrink-0 space-y-4 overflow-auto border-l border-line p-3">
      <section>
        <div class="label mb-1">Run</div>
        <div class="space-y-2">
          {#each fields as [k, p]}
            {@const t = typeOf(p)}
            <div>
              <label class="label" for="a-{k}">{k} <span class="text-muted">{t}{(data.script.args.required ?? []).includes(k) ? " · required" : ""}</span></label>
              {#if t === "boolean"}<input id="a-{k}" type="checkbox" bind:checked={values[k] as boolean} />
              {:else if t === "enum"}<select id="a-{k}" class="input" bind:value={values[k]}>{#each p.enum ?? [] as o}<option value={o}>{o}</option>{/each}</select>
              {:else if t === "integer" || t === "number"}<input id="a-{k}" class="input" type="number" step={t === "integer" ? 1 : "any"} bind:value={values[k]} />
              {:else if t === "string"}<input id="a-{k}" class="input" bind:value={values[k]} />
              {:else}<textarea id="a-{k}" class="input mono" rows="2" placeholder="JSON" bind:value={values[k]}></textarea>{/if}
            </div>
          {:else}<p class="text-[12px] text-muted">No arguments (main takes none).</p>{/each}
          <div class="flex gap-2">
            <button class="btn btn-primary" onclick={start}><Play size={13} /> Run{dirty ? " (saves first)" : ""}</button>
            {#if run && !FINAL.includes(run.status)}<button class="btn btn-danger" onclick={stop}><Square size={13} /> Stop</button>{/if}
          </div>
        </div>
      </section>

      {#if runId}
        <section>
          <div class="label mb-1">Output <span class="mono text-muted">{runId.slice(0, 8)}</span> {#if run}<span class={STATUS[run.status] ?? ""}>{run.status}</span>{/if}</div>
          <pre class="max-h-72 overflow-auto rounded bg-surface-0 p-2 font-mono text-[11.5px]">{#each logs as l}<span class={l.stream === "stderr" ? "text-bad" : ""}>{l.text}
</span>{:else}<span class="text-muted">{run && FINAL.includes(run.status) ? "(no output)" : "waiting for output…"}</span>{/each}</pre>
          {#if run?.error}<p class="mt-1 whitespace-pre-wrap text-[12px] text-bad">{run.error}</p>{/if}
          {#if run && run.result !== null && run.result !== undefined}<div class="label mt-2">Result</div><pre class="max-h-60 overflow-auto rounded bg-surface-0 p-2 font-mono text-[11.5px]">{JSON.stringify(run.result, null, 2)}</pre>{/if}
        </section>
      {/if}

      <section>
        <div class="label mb-1">Settings and schedule</div>
        <div class="space-y-2 text-[12px]">
          <label class="flex items-center gap-2"><input type="checkbox" bind:checked={sched.network} /> Network access (off: no internet)</label>
          <div class="flex gap-2">
            <div class="flex-1"><label class="label" for="to">Timeout (s)</label><input id="to" class="input" type="number" min="5" max="3600" bind:value={sched.timeout_s} /></div>
            <div class="flex-1"><label class="label" for="mem">Memory (MB)</label><input id="mem" class="input" type="number" min="256" max="2048" step="256" bind:value={sched.mem_mb} /></div>
          </div>
          <div><label class="label" for="cron">Schedule (cron, {Intl.DateTimeFormat().resolvedOptions().timeZone})</label><input id="cron" class="input mono" placeholder="0 6 * * *  (every day at 06:00)" bind:value={sched.schedule} /></div>
          <div><label class="label" for="sargs">Scheduled run's arguments (JSON)</label><input id="sargs" class="input mono" bind:value={sched.schedule_args} /></div>
          <label class="flex items-center gap-2"><input type="checkbox" bind:checked={sched.schedule_enabled} /> Schedule enabled</label>
          <button class="btn" onclick={saveSettings}>Save settings</button>
        </div>
      </section>

      <section>
        <div class="label mb-1">Runs</div>
        {#each data.runs as r}
          <button class="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-[12px] hover:bg-surface-2 {runId === r.id ? 'bg-surface-2' : ''}" onclick={() => follow(r.id)}>
            <span class="w-20 {STATUS[r.status] ?? ''}">{r.status}</span><span class="w-20 text-muted">{r.trigger}</span><span class="mono flex-1 truncate text-fg-2">{r.error ?? r.summary ?? ""}</span><span class="text-muted">{ago(r.createdAt)}</span>
          </button>
        {:else}<p class="text-[12px] text-muted">Never run.</p>{/each}
      </section>
    </aside>
  </div>
</div>
