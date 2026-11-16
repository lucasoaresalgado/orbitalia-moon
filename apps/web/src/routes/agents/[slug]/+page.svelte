<script lang="ts">
  // An agent's page: its moon turning on its axis, what it is and how it's set up
  // (Overview, Configuration) and what it did (Logs). Edit opens the editor.
  import { onMount, untrack } from "svelte";
  import { goto, invalidateAll } from "$app/navigation";
  import Modal from "#lib/components/Modal.svelte";
  import { op } from "#lib/api.ts";
  import { page } from "$app/state";
  import { ArrowLeft, Pencil, History, MessageCircle, Activity, Settings2, ScrollText, CheckCircle2, XCircle, Coins, Timer, Wrench, Brain, ShieldCheck, Cpu, Trash2 } from "@lucide/svelte";
  import AgentMoon from "#lib/components/AgentMoon.svelte";
  import ExternalAgent from "#lib/components/ExternalAgent.svelte";
  import StatusBadge from "#lib/components/StatusBadge.svelte";
  import ModelBadge from "#lib/components/ModelBadge.svelte";
  import InfoTip from "#lib/components/InfoTip.svelte";
  import ReadMore from "#lib/components/ReadMore.svelte";
  import Markdown from "#lib/components/Markdown.svelte";
  import { live, throttle } from "#lib/stream.ts";
  import { usd, tokens, duration, between, ago, time } from "#lib/format.ts";

  let { data } = $props();
  const TABS = [["overview", "Overview", Activity], ["config", "Configuration", Settings2], ["logs", "Logs", ScrollText]] as const;
  let tab = $state<string>(untrack(() => page.url.searchParams.get("tab") ?? "overview"));
  onMount(() => live(["runs"], throttle(() => void invalidateAll(), 1500)));

  const v = $derived(data.deployed);
  const o = $derived(data.overview);
  const rate = $derived(o.stats.runs ? Math.round((o.stats.ok / o.stats.runs) * 100) : null);
  const perms = $derived((v?.permissions ?? {}) as Record<string, any>);
  const limits = $derived((v?.limits ?? {}) as Record<string, any>);
  const tools = $derived((v?.tools ?? []) as { name: string; requires_approval: boolean }[]);
  const catalog = $derived(new Map(data.tools.map((t) => [t.name, t])));
  const days = $derived.by(() => {
    const out: { day: string; runs: number }[] = [];
    for (let i = 13; i >= 0; i--) {
      const day = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
      out.push({ day, runs: o.daily.find((d) => d.day === day)?.runs ?? 0 });
    }
    return out;
  });
  const maxDay = $derived(Math.max(1, ...days.map((d) => d.runs)));
  const logLine = (l: (typeof o.logs)[number]) => {
    const d = l.data as Record<string, any>;
    if (l.type === "tool_start") return { icon: "→", text: `${d.name} ${JSON.stringify(d.input ?? {}).slice(0, 160)}`, tone: "" };
    if (l.type === "tool_end") return { icon: d.ok === false ? "✕" : "✓", text: `${d.name}${d.summary ? `: ${d.summary}` : ""}${d.ms ? ` · ${duration(d.ms)}` : ""}`, tone: d.ok === false ? "text-bad" : "text-ok" };
    if (l.type === "error") return { icon: "!", text: String(d.message ?? ""), tone: "text-bad" };
    if (l.type === "status") return { icon: "●", text: `run ${d.status}${d.detail ? `: ${d.detail}` : ""}`, tone: d.status === "failed" ? "text-bad" : "text-muted" };
    if (l.type === "approval") return { icon: "⏸", text: `waiting for approval (${d.kind})`, tone: "text-warn" };
    if (l.type === "compaction") return { icon: "⇣", text: `context compacted (${tokens(d.tokensBefore)} tokens)`, tone: "text-muted" };
    return { icon: "·", text: String(d.text ?? "").slice(0, 300), tone: "text-fg-2" };
  };
  // ---- change model / delete
  let modelOpen = $state(false);
  let deleteOpen = $state(false);
  let newModel = $state("");
  let newFallback = $state("");
  let busy = $state(false);
  let err = $state("");
  let msg = $state("");
  function openModel() {
    newModel = v?.model ?? "";
    newFallback = v?.fallbackModel ?? "";
    err = "";
    modelOpen = true;
  }
  async function saveModel() {
    busy = true;
    err = "";
    try {
      const r = await op<{ version: number; model: string }>("agents.set_model", { agent: data.agent.slug, model: newModel.trim(), fallback_model: newFallback.trim() || null });
      modelOpen = false;
      msg = `Now on ${r.model} (v${r.version} deployed).`;
      await invalidateAll();
    } catch (e) {
      err = (e as Error).message;
    } finally {
      busy = false;
    }
  }
  const mode = $derived((page.data as { agentMode?: { mode: string; agent: string } }).agentMode);
  const undeletable = $derived(data.agent.slug === "luna" ? "Luna is the manager: the platform needs her." : mode?.mode === "single" && mode.agent === data.agent.slug ? "This is the single agent: change the agent mode first." : null);
  let confirmSlug = $state("");
  async function remove() {
    busy = true;
    err = "";
    try {
      await op("agents.delete", { agent: data.agent.slug });
      deleteOpen = false;
      await goto("/agents", { refreshAll: true });
    } catch (e) {
      err = (e as Error).message;
    } finally {
      busy = false;
    }
  }
  const role: Record<string, string> = { manager: "Plans the work, talks with you and keeps the board moving.", worker: "Does the cards: writes and runs code in its sandbox.", reviewer: "Checks each change before it reaches you.", tester: "Tests everything once the checks pass: runs the suite, verifies each acceptance criterion, tries to break the change and writes the missing tests.", brief_writer: "Turns planned cards into briefs." };
</script>

<svelte:head><title>a/{data.agent.slug} · Agent</title></svelte:head>

{#if data.agent.runtime === "external"}
  <ExternalAgent agent={data.agent} assigned={data.assigned} activity={data.activity}>
    {#snippet actions()}<button class="btn btn-ghost text-bad" onclick={() => { err = ""; confirmSlug = ""; deleteOpen = true; }} disabled={!!undeletable} title={undeletable ?? "Delete this agent"}><Trash2 size={13} /> Delete</button>{/snippet}
  </ExternalAgent>
{:else}
<div class="mx-auto max-w-6xl p-3 sm:p-5">
  <a href="/agents" class="mb-3 inline-flex items-center gap-1 text-[12px] text-muted hover:text-fg"><ArrowLeft size={13} /> Agents</a>

  <!-- hero -->
  <section class="panel relative overflow-hidden p-4 sm:p-6">
    <div class="hero-glow" aria-hidden="true"></div>
    <div class="relative flex flex-col items-center gap-5 text-center sm:flex-row sm:text-left">
      <div class="shrink-0"><AgentMoon slug={data.agent.slug} size={132} spin /></div>
      <div class="min-w-0 flex-1">
        <div class="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
          <h2 class="text-[20px] font-semibold" style="font-family: var(--font-brand)">{data.agent.name}</h2>
          <span class="mono text-muted">a/{data.agent.slug}</span>
          {#if o.stats.active}<span class="inline-flex items-center gap-1 rounded-full bg-info/15 px-2 py-0.5 text-[11px] text-info"><span class="pulse h-1.5 w-1.5 rounded-full bg-info"></span>working</span>{/if}
        </div>
        <div class="mt-1 flex flex-wrap items-center justify-center gap-2 text-[12px] text-fg-2 sm:justify-start">
          <span class="rounded border border-line px-1.5">{data.agent.role}</span>
          {#if v}<button class="inline-flex items-center gap-1 rounded hover:ring-1 hover:ring-accent" onclick={openModel} title="Change the model"><ModelBadge model={v.model} full /></button><span class="text-muted">v{v.version}{data.draft ? " · draft pending" : ""}</span>{:else}<span class="text-warn">not deployed</span>{/if}
        </div>
        <p class="mt-2 max-w-2xl text-[12.5px] text-muted">{data.agent.description ?? role[data.agent.role] ?? ""}</p>
        <div class="mt-3 flex flex-wrap justify-center gap-2 sm:justify-start">
          <a class="btn btn-primary" href="/agents/{data.agent.slug}/edit"><Pencil size={13} /> Edit</a>
          <a class="btn" href="/manager?agent={data.agent.slug}"><MessageCircle size={13} /> Chat</a>
          {#if v}<button class="btn" onclick={openModel}><Cpu size={13} /> Change model</button>{/if}
          <a class="btn" href="/agents/{data.agent.slug}/versions"><History size={13} /> Versions</a>
          <button class="btn btn-ghost text-bad" onclick={() => { err = ""; confirmSlug = ""; deleteOpen = true; }} disabled={!!undeletable} title={undeletable ?? "Delete this agent"}><Trash2 size={13} /> Delete</button>
        </div>
        {#if msg}<p class="mt-2 text-[12px] text-ok">{msg}</p>{/if}
      </div>
    </div>
  </section>

  <!-- tabs -->
  <div class="mt-4 flex scroll-x border-b border-line" role="tablist">
    {#each TABS as [id, label, Icon]}
      <button role="tab" aria-selected={tab === id} class="tab flex shrink-0 items-center gap-1.5 {tab === id ? 'tab-active' : ''}" onclick={() => (tab = id)}><Icon size={13} />{label}</button>
    {/each}
  </div>

  <div class="pt-4">
    {#if tab === "overview"}
      <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {#each [
          { label: "Runs · 30 days", value: String(o.stats.runs), sub: o.stats.last_at ? `last ${ago(o.stats.last_at)}` : "never ran", icon: Activity },
          { label: "Success rate", value: rate === null ? "—" : `${rate}%`, sub: `${o.stats.ok} ok · ${o.stats.failed} failed`, icon: CheckCircle2 },
          { label: "Tokens · 30 days", value: tokens(o.stats.tokens), sub: usd(o.stats.cost), icon: Coins },
          { label: "Average run", value: o.stats.avgS == null ? "—" : duration(o.stats.avgS * 1000), sub: "start to finish", icon: Timer },
        ] as k}
          {@const Icon = k.icon}
          <div class="panel px-3 py-2.5"><div class="label flex items-center gap-1.5"><Icon size={12} />{k.label}</div><div class="num text-[20px] font-semibold">{k.value}</div><div class="text-[11.5px] text-muted">{k.sub}</div></div>
        {/each}
      </div>

      <div class="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div class="panel p-3">
          <div class="label">Runs per day · 14 days</div>
          <div class="mt-2 flex h-24 items-end gap-1" role="img" aria-label="Runs per day">
            {#each days as d}
              <div class="group relative flex flex-1 flex-col items-center justify-end" title="{d.day}: {d.runs} runs">
                <div class="w-full rounded-t-sm bg-accent/80 transition group-hover:bg-accent" style="height: {Math.max(d.runs ? 6 : 2, (d.runs / maxDay) * 88)}px; opacity: {d.runs ? 1 : 0.25}"></div>
              </div>
            {/each}
          </div>
          <div class="mt-1 flex justify-between text-[10.5px] text-muted"><span>{days[0]?.day.slice(5)}</span><span>today</span></div>
        </div>
        <div class="panel">
          <div class="label px-3 pt-3">Cards it holds · {data.assigned.length}</div>
          {#each data.assigned.slice(0, 6) as c}
            <a class="row" href="/cards/{c.ref.replace('#', '/')}"><StatusBadge status={c.status} compact /><span class="mono w-28 shrink-0 truncate text-muted">p/{c.ref}</span><span class="min-w-0 flex-1 truncate">{c.title}</span></a>
          {:else}<p class="px-3 pb-3 text-[12px] text-muted">No cards assigned.</p>{/each}
        </div>
      </div>

      <div class="panel mt-4">
        <div class="label px-3 pt-3">Latest runs</div>
        {#each o.recent.slice(0, 10) as r}
          <a class="row" href="/runs/{r.id}">
            <StatusBadge status={r.status} compact />
            <span class="w-16 shrink-0 text-[11.5px] text-muted">{r.kind}</span>
            <span class="min-w-0 flex-1 truncate">{r.card ? `p/${r.card} ${r.title ?? ""}` : (r.summary ?? r.error ?? "—")}</span>
            <span class="num hidden w-16 text-right text-[11.5px] text-muted sm:inline">{tokens(r.tokens)}</span>
            <span class="num hidden w-16 text-right text-[11.5px] text-muted md:inline">{duration(between(r.started_at, r.finished_at))}</span>
            <span class="w-16 text-right text-[11.5px] text-muted">{ago(r.created_at)}</span>
          </a>
        {:else}<p class="px-3 pb-3 text-[12px] text-muted">No runs yet. <a class="text-accent" href="/agents/{data.agent.slug}/edit?tab=general">Test it in the editor</a>.</p>{/each}
      </div>

    {:else if tab === "config"}
      {#if !v}
        <p class="text-muted">Not deployed yet. <a class="text-accent" href="/agents/{data.agent.slug}/edit">Open the editor</a> to set it up and deploy.</p>
      {:else}
        <div class="grid gap-4 lg:grid-cols-2">
          <section class="panel p-3">
            <h3 class="mb-2 flex items-center gap-1.5 font-semibold"><Settings2 size={14} /> General</h3>
            <dl class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-[12.5px]">
              <dt class="text-muted">Model</dt><dd class="flex items-center gap-2"><ModelBadge model={v.model} full /><button class="text-[11.5px] text-accent hover:underline" onclick={openModel}>change</button></dd>
              <dt class="text-muted">Fallback</dt><dd class="mono">{v.fallbackModel ?? "none"}</dd>
              <dt class="text-muted">Max turns</dt><dd class="num">{limits.max_turns ?? "—"}</dd>
              <dt class="text-muted">Max output</dt><dd class="num">{limits.max_tokens ? tokens(limits.max_tokens) : "—"}</dd>
              <dt class="text-muted flex items-center gap-1">Compact at <InfoTip text="When the conversation reaches this many tokens, older turns are summarized to keep the context small." /></dt><dd class="num">{limits.compact_at_tokens ? tokens(limits.compact_at_tokens) : "—"}</dd>
              <dt class="text-muted">Run budget</dt><dd class="num">{limits.run_budget_usd != null ? usd(limits.run_budget_usd) : "—"}{limits.day_budget_usd ? ` · ${usd(limits.day_budget_usd)}/day` : ""}</dd>
              <dt class="text-muted">Version</dt><dd>v{v.version} · {time(v.createdAt)}{v.changeNote ? ` · ${v.changeNote}` : ""}</dd>
            </dl>
          </section>
          <section class="panel p-3">
            <h3 class="mb-2 flex items-center gap-1.5 font-semibold"><ShieldCheck size={14} /> Permissions</h3>
            <dl class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-[12.5px]">
              <dt class="text-muted">Network</dt><dd>{perms.network ?? "never"}{perms.network === "allowlist" && perms.network_allowlist?.length ? `: ${perms.network_allowlist.join(", ")}` : ""}</dd>
              <dt class="text-muted">Lakehouse</dt><dd>{perms.lakehouse_read ? "read-only" : "no access"}</dd>
              <dt class="text-muted">Commits</dt><dd>{perms.github_push ? "on its card branch" : "no"}</dd>
              <dt class="text-muted">Sandbox memory</dt><dd class="num">{perms.sandbox_mem_mb ?? "—"} MB</dd>
            </dl>
          </section>
          <section class="panel p-3 lg:col-span-2">
            <h3 class="mb-2 flex items-center gap-1.5 font-semibold"><Wrench size={14} /> Tools · {tools.length}</h3>
            <div class="flex flex-wrap gap-1.5">
              {#each tools as t}
                {@const c = catalog.get(t.name)}
                <span class="inline-flex items-center gap-1 rounded-md border border-line px-1.5 py-0.5 text-[12px]" title={c?.description ?? ""}>
                  <span class="mono">{t.name}</span>
                  {#if c}<span class="text-[10px] {c.risk === 'high' ? 'text-bad' : c.risk === 'medium' ? 'text-warn' : 'text-ok'}">{c.risk}</span>{/if}
                  {#if t.requires_approval}<span class="rounded bg-warn/15 px-1 text-[10px] text-warn">approval</span>{/if}
                </span>
              {:else}<span class="text-muted">No tools.</span>{/each}
            </div>
            <div class="mt-3 flex items-center gap-2"><span class="label mb-0">Skills · {(v.skills as string[]).length}</span><a class="text-[11.5px] text-accent hover:underline" href="/agents/{data.agent.slug}/edit?tab=skills">change</a></div>
            <div class="mt-1 flex flex-wrap gap-1.5">
              {#each v.skills as string[] as sk}
                {@const info = data.skills.find((x) => x.name === sk)}
                <span class="inline-flex items-center gap-1 rounded-md border border-line px-1.5 py-0.5 text-[12px] {info ? '' : 'opacity-50 line-through'}" title={info?.description ?? "this skill was removed"}><span class="mono">{sk}</span>{#if info?.source.kind === "github"}<span class="text-[10px] text-muted">{info.source.repo}</span>{/if}</span>
              {:else}<span class="text-[12px] text-muted">None attached{data.skills.some((x) => x.source.kind === "local") && tools.some((t) => t.name === "load_skill") ? "; your local skills are available to it" : ""}.</span>{/each}
            </div>
          </section>
          <section class="panel p-3 lg:col-span-2">
            <h3 class="mb-2 flex items-center gap-1.5 font-semibold"><Brain size={14} /> Prompt & memory</h3>
            <div class="label">System prompt</div>
            <ReadMore lines={4}><div class="prose-sm text-fg-2"><Markdown text={v.systemPrompt} /></div></ReadMore>
            <div class="mt-3 grid gap-3 md:grid-cols-2">
              <div><div class="label">Limbic · start instructions</div><ReadMore lines={3}><div class="whitespace-pre-wrap text-fg-2">{data.limbic.instructions || "—"}</div></ReadMore></div>
              <div><div class="label">Limbic · memories</div><ReadMore lines={3}><div class="mono whitespace-pre-wrap text-fg-2">{data.limbic.memories || "—"}</div></ReadMore></div>
            </div>
            <div class="mt-3 text-[12px] text-muted">Cortex: {data.cortex.count ? `${data.cortex.count} files on its map` : "no map"}</div>
          </section>
        </div>
      {/if}

    {:else if tab === "logs"}
      <p class="mb-2 text-[12px] text-muted">What a/{data.agent.slug} did in its last 10 runs, newest first: tool calls, results, errors and status changes. Click a line to open its run.</p>
      <div class="panel overflow-hidden">
        {#each o.logs as l (l.run_id + l.seq)}
          {@const line = logLine(l)}
          <a href="/runs/{l.run_id}" class="flex items-start gap-2 border-b border-line px-3 py-1.5 font-mono text-[11.5px] last:border-b-0 hover:bg-surface-2">
            <span class="w-14 shrink-0 text-muted sm:w-20">{new Date(l.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
            <span class="w-4 shrink-0 text-center {line.tone}">{line.icon}</span>
            <span class="min-w-0 flex-1 break-words {line.tone}">{line.text}</span>
            <span class="hidden shrink-0 text-muted sm:inline">{l.run_id.slice(0, 6)}</span>
          </a>
        {:else}<p class="p-3 text-muted">No run logs yet.</p>{/each}
      </div>
      <h3 class="mt-5 mb-1 font-semibold">Actions as a/{data.agent.slug}</h3>
      <p class="mb-2 text-[12px] text-muted">What was done in its name through the API, MCP or CLI: a harness acting as it, or its own token.</p>
      <div class="panel overflow-hidden">
        {#each o.actions as a (a.id)}
          <div class="flex items-start gap-2 border-b border-line px-3 py-1.5 text-[12px] last:border-b-0">
            <span class="w-24 shrink-0 text-muted">{ago(a.created_at)}</span>
            <span class="mono shrink-0 text-accent">{a.action}</span>
            <span class="mono min-w-0 flex-1 truncate text-fg-2" title={JSON.stringify(a.details ?? {})}>{a.target_type ? `${a.target_type} ${a.target_id ?? ""}` : ""} {a.details ? JSON.stringify(a.details).slice(0, 140) : ""}</span>
          </div>
        {:else}<p class="p-3 text-[12px] text-muted">Nothing yet.</p>{/each}
      </div>
    {/if}
  </div>
</div>
{/if}

<Modal bind:open={modelOpen} title="Change the model of a/{data.agent.slug}" subtitle="Applies to its next run: a new version with this model is deployed right away." width="520px">
  {#snippet icon()}<AgentMoon slug={data.agent.slug} size={36} />{/snippet}
  <form id="model-form" class="space-y-3" onsubmit={(e) => { e.preventDefault(); void saveModel(); }}>
    <datalist id="agent-models">{#each data.modelChoices as m}<option value={m}></option>{/each}</datalist>
    <div><label class="label flex items-center gap-1" for="nm">Model <InfoTip text="claude-… uses the Anthropic API (or your subscription, per Engines); azure:<deployment> uses Azure Foundry. Pick from the list or type any id." /></label><input id="nm" class="input mono h-8" list="agent-models" bind:value={newModel} required autocomplete="off" /></div>
    <div><label class="label flex items-center gap-1" for="nf">Fallback <InfoTip text="Used when the model fails or is overloaded. Empty: none." /></label><input id="nf" class="input mono h-8" list="agent-models" bind:value={newFallback} placeholder="none" autocomplete="off" /></div>
    {#if data.draft}<p class="text-[12px] text-muted">The draft you're editing keeps its other changes and gets the new model too.</p>{/if}
    {#if err}<p class="border-l-2 border-bad pl-2 text-[12px] text-bad">{err}</p>{/if}
  </form>
  {#snippet footer()}<button class="btn" onclick={() => (modelOpen = false)}>Cancel</button><button class="btn btn-primary" form="model-form" disabled={busy || !newModel.trim() || newModel.trim() === v?.model && (newFallback.trim() || null) === (v?.fallbackModel ?? null)}>Apply</button>{/snippet}
</Modal>

<Modal bind:open={deleteOpen} title="Delete a/{data.agent.slug}?" width="500px">
  {#snippet icon()}<span class="grid h-9 w-9 place-items-center rounded-lg bg-bad/15 text-bad"><Trash2 size={18} /></span>{/snippet}
  <ul class="list-disc space-y-1 pl-5 text-[12.5px] text-fg-2">
    <li>It leaves every list and chat, and is never run again.</li>
    <li>Its active runs stop now; its open cards ({data.assigned.length}) go back unassigned.</li>
    <li>Tokens that act as it are revoked.</li>
    <li>Its runs, logs and history stay, under the name <span class="mono">{data.agent.slug}~deleted</span>. The name a/{data.agent.slug} becomes free again.</li>
  </ul>
  <label class="label mt-4" for="cs">Type <span class="mono normal-case">{data.agent.slug}</span> to confirm</label>
  <input id="cs" class="input mono h-8" bind:value={confirmSlug} autocomplete="off" />
  {#if err}<p class="mt-2 border-l-2 border-bad pl-2 text-[12px] text-bad">{err}</p>{/if}
  {#snippet footer()}<button class="btn" onclick={() => (deleteOpen = false)}>Cancel</button><button class="btn btn-danger" disabled={busy || confirmSlug !== data.agent.slug} onclick={remove}><Trash2 size={13} /> Delete agent</button>{/snippet}
</Modal>

<style>
  .hero-glow {
    position: absolute;
    inset: -40% -10% auto auto;
    width: 60%;
    height: 180%;
    background: radial-gradient(closest-side, color-mix(in srgb, var(--accent) 22%, transparent), transparent);
    pointer-events: none;
  }
</style>
