<script lang="ts">
  // The agent editor (scope §18.5): configuration on the left, Test panel on the
  // right; Save draft, Test, Deploy (with a diff and a change note).
  import { untrack } from "svelte";
  import { invalidateAll } from "$app/navigation";
  import { page } from "$app/state";
  import { ArrowLeft, History, Play, Save, Rocket } from "@lucide/svelte";
  import Transcript from "#lib/components/Transcript.svelte";
  import Drawer from "#lib/components/Drawer.svelte";
  import ExternalAgent from "#lib/components/ExternalAgent.svelte";
  import { api } from "#lib/api.ts";
  import { estimateTokens } from "@miniasys/core/shared";

  let { data } = $props();
  type V = { model: string; fallback_model: string | null; system_prompt: string; tools: { name: string; requires_approval: boolean }[]; skills: string[]; permissions: Record<string, any>; limits: Record<string, any> };
  const toInput = (v: NonNullable<typeof data.draft>): V => ({
    model: v.model, fallback_model: v.fallbackModel, system_prompt: v.systemPrompt, tools: v.tools as V["tools"], skills: v.skills as string[],
    permissions: v.permissions as V["permissions"], limits: v.limits as V["limits"],
  });
  const base = untrack(() => data.draft ?? data.deployed);
  let form = $state<V>(base ? structuredClone(toInput(base)) : { model: "claude-haiku-5-5", fallback_model: null, system_prompt: "", tools: [], skills: [], permissions: {}, limits: {} });
  let saved = $state(JSON.stringify(form));
  const dirty = $derived(JSON.stringify(form) !== saved);
  let tab = $state(untrack(() => page.url.searchParams.get("tab") ?? "general"));
  let lim = $state(untrack(() => ({ ...data.limbic })));
  let sources = $state(untrack(() => data.cortex.sources.join("\n")));
  let cortexFilter = $state("");
  async function saveLimbic() {
    err = msg = "";
    try {
      await api(`/api/agents/${data.agent.slug}/limbic`, { method: "PUT", body: lim });
      msg = "Limbic saved: it goes into every run from now on.";
      await invalidateAll();
    } catch (e) {
      err = (e as Error).message;
    }
  }
  async function rebuildCortex() {
    err = msg = "";
    try {
      await api(`/api/agents/${data.agent.slug}/cortex`, { body: { sources: sources.split("\n").map((x) => x.trim()).filter(Boolean) } });
      msg = "Rebuilding the cortex map: you'll get a notification when it's done.";
    } catch (e) {
      err = (e as Error).message;
    }
  }
  let msg = $state("");
  let err = $state("");
  let testText = $state("");
  let testBudget = $state(0.3);
  let testRun = $state<string | null>(null);
  let deployOpen = $state(false);
  let changeNote = $state("");

  const has = (name: string) => form.tools.some((t) => t.name === name);
  function toggleTool(name: string) {
    form.tools = has(name) ? form.tools.filter((t) => t.name !== name) : [...form.tools, { name, requires_approval: false }];
  }
  async function saveDraft() {
    err = msg = "";
    try {
      await api(`/api/agents/${data.agent.slug}/draft`, { method: "PUT", body: form });
      saved = JSON.stringify(form);
      msg = "Draft saved.";
      await invalidateAll();
    } catch (e) {
      err = (e as Error).message;
    }
  }
  async function test() {
    if (dirty) await saveDraft();
    err = "";
    try {
      testRun = (await api<{ runId: string }>(`/api/agents/${data.agent.slug}/test`, { body: { text: testText, budgetUsd: testBudget } })).runId;
    } catch (e) {
      err = (e as Error).message;
    }
  }
  async function deploy() {
    if (dirty) await saveDraft();
    try {
      const r = await api<{ version: number }>(`/api/agents/${data.agent.slug}/deploy`, { body: { change_note: changeNote } });
      deployOpen = false;
      msg = `Deployed v${r.version}.`;
      await invalidateAll();
    } catch (e) {
      err = (e as Error).message;
    }
  }
  const diffLines = $derived.by(() => {
    if (!data.deployed) return ["(first deploy)"];
    const a = JSON.stringify(toInput(data.deployed), null, 2).split("\n");
    const b = JSON.stringify(form, null, 2).split("\n");
    const out: string[] = [];
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (a[i] === b[i]) continue;
      if (a[i] !== undefined) out.push(`- ${a[i]}`);
      if (b[i] !== undefined) out.push(`+ ${b[i]}`);
    }
    return out.length ? out : ["(no changes)"];
  });
  const risk: Record<string, string> = { low: "text-ok", medium: "text-warn", high: "text-bad" };
</script>

<svelte:head><title>a/{data.agent.slug} · Agent</title></svelte:head>

{#if data.agent.runtime === "external"}
<ExternalAgent agent={data.agent} assigned={data.assigned} activity={data.activity} />
{:else}
<div class="flex h-full flex-col">
  <div class="flex items-center gap-3 border-b border-line bg-surface-1 px-4 py-2">
    <a href="/agents" class="text-muted hover:text-fg" aria-label="Back"><ArrowLeft size={15} /></a>
    <span class="mono font-medium">a/{data.agent.slug}</span>
    <span class="truncate text-fg-2">{data.agent.description ?? ""}</span>
    <span class="text-[12px] text-muted">{data.deployed ? `v${data.deployed.version} deployed` : "not deployed"}{data.draft ? " · draft" : ""}{dirty ? " · unsaved" : ""}</span>
    <a class="btn ml-auto" href="/agents/{data.agent.slug}/versions"><History size={13} /> History</a>
    <button class="btn" onclick={saveDraft} disabled={!dirty}><Save size={13} /> Save draft</button>
    <button class="btn btn-primary" onclick={() => (deployOpen = true)} disabled={!data.draft && !dirty}><Rocket size={13} /> Deploy</button>
  </div>
  {#if err}<p class="border-l-2 border-bad px-4 py-1 text-bad">{err}</p>{/if}
  {#if msg}<p class="border-l-2 border-ok px-4 py-1 text-ok">{msg}</p>{/if}

  <div class="flex min-h-0 flex-1">
    <div class="flex min-w-0 flex-1 flex-col border-r border-line">
      <div class="flex border-b border-line px-3" role="tablist">
        {#each [["general", "General"], ["prompt", "Prompt"], ["limbic", "Limbic"], ["cortex", "Cortex"], ["tools", "Tools"], ["skills", "Skills"], ["permissions", "Permissions"], ["budget", "Budget"]] as [id, label]}
          <button role="tab" aria-selected={tab === id} class="tab {tab === id ? 'tab-active' : ''}" onclick={() => (tab = id!)}>{label}</button>
        {/each}
      </div>
      <div class="min-h-0 flex-1 overflow-y-auto p-4">
        {#if tab === "general"}
          <div class="grid max-w-xl grid-cols-2 gap-3">
            <div><label class="label" for="m">Model</label><select id="m" class="input mono" bind:value={form.model}>{#each data.modelChoices as m}<option>{m}</option>{/each}</select></div>
            <div><label class="label" for="fb">Fallback</label><select id="fb" class="input mono" bind:value={form.fallback_model}><option value={null}>none</option>{#each data.modelChoices as m}<option>{m}</option>{/each}</select></div>
            <div><label class="label" for="mt">Max turns</label><input id="mt" type="number" class="input" bind:value={form.limits.max_turns} /></div>
            <div><label class="label" for="mx">Max output tokens</label><input id="mx" type="number" class="input" bind:value={form.limits.max_tokens} /></div>
            <div><label class="label" for="ca">Compact at (tokens)</label><input id="ca" type="number" class="input" bind:value={form.limits.compact_at_tokens} /></div>
          </div>
          <p class="mt-3 text-[12px] text-muted">Role: {data.agent.role}. Model ids are configuration; prices live in Settings → Prices.</p>
        {:else if tab === "prompt"}
          <div class="mb-1 flex items-center text-[12px] text-muted"><span>System prompt (markdown)</span><span class="num ml-auto">≈ {estimateTokens(form.system_prompt)} tokens</span></div>
          <textarea class="input mono h-[60vh] text-[12px] leading-relaxed" bind:value={form.system_prompt} spellcheck="false"></textarea>
          <p class="mt-2 text-[12px] text-muted">The project's context and the card's brief are added after it (cached separately). Tool results always arrive marked as untrusted data.</p>
        {:else if tab === "limbic"}
          <div class="max-w-3xl space-y-3">
            <p class="text-[12px] text-muted">The Limbic goes into every run of a/{data.agent.slug}, on either engine. You write the start instructions; the agent writes its own memories (limbic_remember / limbic_forget, or a remember block on the subscription), and you can edit them here. Not versioned with the prompt: changes apply to the next run.</p>
            <div><label class="label" for="li">Start instructions</label><textarea id="li" class="input" rows="8" bind:value={lim.instructions} placeholder="What this agent should always keep in mind: conventions, preferences, context…"></textarea></div>
            <div><label class="label" for="lm">Memories</label><textarea id="lm" class="input mono text-[12px]" rows="12" bind:value={lim.memories} placeholder="- (2026-11-11) Lucas prefers small PRs with one commit"></textarea></div>
            <button class="btn btn-primary" onclick={saveLimbic}>Save limbic</button>
          </div>
        {:else if tab === "cortex"}
          <div class="space-y-3">
            <p class="max-w-3xl text-[12px] text-muted">The Cortex is the map of what a/{data.agent.slug} may read: one row per markdown or parquet file on the storage, with what it is about and an embedding. The agent searches it with cortex_search and reads files with cortex_read (parquet through read-only SQL); it can read nothing that isn't on the map. On the subscription engine, the most relevant entries are added to its prompt.</p>
            <div class="panel p-3 text-[12.5px]">
              <div class="mono text-[12px] text-fg-2">{data.cortex.file}</div>
              <div class="mt-1 text-muted">{data.cortex.count ? `${data.cortex.count} files${data.cortex.embedded ? " · with embeddings" : " · no embeddings (keyword search)"} · built ${new Date(data.cortex.builtAt ?? 0).toLocaleString()}` : "No map yet."}</div>
              <label class="label mt-3" for="cs">Folders to map, relative to the storage <span class="mono normal-case">{data.cortex.storage}</span>, one per line</label>
              <textarea id="cs" class="input mono" rows="3" bind:value={sources} placeholder="docs&#10;gold"></textarea>
              <button class="btn btn-primary mt-2" disabled={!sources.trim()} onclick={rebuildCortex}>{data.cortex.count ? "Rebuild map" : "Build map"}</button>
              <span class="ml-2 text-[11.5px] text-muted">Or write <span class="mono">{data.agent.slug}_ctx.parquet</span> yourself (columns: index, path, kind, about, embedding) from a pipeline.</span>
            </div>
            {#if data.cortex.count}
              <input class="input w-72" placeholder="Filter the map…" bind:value={cortexFilter} />
              <div class="panel">
                {#each data.cortex.entries.filter((e) => !cortexFilter || `${e.path} ${e.about}`.toLowerCase().includes(cortexFilter.toLowerCase())).slice(0, 300) as e}
                  <div class="row h-auto items-start py-1.5"><span class="mono w-10 text-muted">#{e.index}</span><span class="w-16 text-[11px] text-fg-2">{e.kind}</span><span class="mono w-64 truncate" title={e.path}>{e.path}</span><span class="flex-1 text-[12px] text-muted">{e.about}</span></div>
                {/each}
              </div>
            {/if}
          </div>
        {:else if tab === "tools"}
          <div class="panel">
            {#each data.tools as t}
              <div class="row h-auto py-2">
                <input type="checkbox" checked={has(t.name)} onchange={() => toggleTool(t.name)} aria-label={t.name} />
                <span class="mono w-40">{t.name}</span><span class="w-14 text-[11px] {risk[t.risk]}">{t.risk}</span>
                <span class="flex-1 text-[12px] text-muted">{t.description}</span>
                {#if has(t.name)}
                  {@const g = form.tools.find((x) => x.name === t.name)!}
                  <label class="flex items-center gap-1 text-[12px] text-fg-2"><input type="checkbox" bind:checked={g.requires_approval} /> requires approval</label>
                {/if}
              </div>
            {/each}
          </div>
        {:else if tab === "skills"}
          {#if !data.skills.length}<p class="text-muted">No skills in the skills folder yet.</p>{/if}
          {#each data.skills as s}
            <label class="row"><input type="checkbox" checked={form.skills.includes(s)} onchange={() => (form.skills = form.skills.includes(s) ? form.skills.filter((x) => x !== s) : [...form.skills, s])} /><span class="mono">{s}</span></label>
          {/each}
          <p class="mt-2 text-[12px] text-muted">Skills load on demand through load_skill (enable that tool), so they cost nothing until used.</p>
        {:else if tab === "permissions"}
          <div class="max-w-xl space-y-3">
            <div><label class="label" for="net">Network in sandboxes</label><select id="net" class="input" bind:value={form.permissions.network}><option value="never">never</option><option value="ask">ask (approval per command)</option><option value="allowlist">allowlist</option></select></div>
            {#if form.permissions.network === "allowlist"}<div><label class="label" for="al">Allowed domains, one per line</label><textarea id="al" class="input mono" rows="4" value={(form.permissions.network_allowlist ?? []).join("\n")} oninput={(e) => (form.permissions.network_allowlist = (e.target as HTMLTextAreaElement).value.split("\n").map((x) => x.trim()).filter(Boolean))}></textarea></div>{/if}
            <label class="flex items-center gap-2"><input type="checkbox" bind:checked={form.permissions.lakehouse_read} /> Read the lakehouse (mounted read-only)</label>
            <label class="flex items-center gap-2"><input type="checkbox" bind:checked={form.permissions.github_push} /> Commit on its card branch (pushes happen after review, to agent/* only)</label>
            <div><label class="label" for="mem">Sandbox memory (MB, max 2048)</label><input id="mem" type="number" min="256" max="2048" class="input w-32" bind:value={form.permissions.sandbox_mem_mb} /></div>
            <p class="text-[12px] text-muted">Workspace access is always confined to the card's workspace.</p>
          </div>
        {:else if tab === "budget"}
          <div class="grid max-w-xl grid-cols-2 gap-3">
            <div><label class="label" for="rb">Per-run budget (USD)</label><input id="rb" type="number" step="0.05" class="input" bind:value={form.limits.run_budget_usd} /></div>
            <div><label class="label" for="db">Per-day budget (USD, optional)</label><input id="db" type="number" step="0.5" class="input" bind:value={form.limits.day_budget_usd} /></div>
          </div>
        {/if}
      </div>
    </div>

    <aside class="flex w-[44%] max-w-[620px] min-w-[360px] flex-col">
      <div class="border-b border-line p-3">
        <div class="label">Test the {data.draft ? "draft" : "deployed version"}</div>
        <textarea class="input" rows="4" placeholder="Add a /health endpoint that returns…" bind:value={testText}></textarea>
        <div class="mt-2 flex items-center gap-2">
          <label class="text-[12px] text-muted" for="tb">Test budget $</label><input id="tb" type="number" step="0.05" min="0.05" max="5" class="input w-20" bind:value={testBudget} />
          <button class="btn btn-primary ml-auto whitespace-nowrap" disabled={!testText.trim()} onclick={test}><Play size={13} /> Run test</button>
        </div>
      </div>
      <div class="min-h-0 flex-1 overflow-y-auto p-3">
        {#if testRun}<div class="mb-2 text-[12px]"><a class="text-accent" href="/runs/{testRun}">open run {testRun.slice(0, 8)} ↗</a></div><Transcript runId={testRun} />{:else}<p class="text-muted">Runs the draft in a throwaway workspace, streaming tool calls and cost.</p>{/if}
      </div>
    </aside>
  </div>
</div>

<Drawer bind:open={deployOpen} title="Deploy a/{data.agent.slug}" width="640px">
  <div class="space-y-3 p-4">
    <div class="label">Changes against v{data.deployed?.version ?? "—"}</div>
    <pre class="max-h-[50vh] overflow-auto rounded-md bg-surface-0 p-2 font-mono text-[11.5px]">{#each diffLines as l}<span class={l.startsWith("+") ? "text-ok" : l.startsWith("-") ? "text-bad" : "text-muted"}>{l}
</span>{/each}</pre>
    <div><label class="label" for="cn">Change note</label><input id="cn" class="input" bind:value={changeNote} placeholder="What changed and why" /></div>
    <button class="btn btn-primary" onclick={deploy}><Rocket size={13} /> Deploy</button>
  </div>
</Drawer>
{/if}
