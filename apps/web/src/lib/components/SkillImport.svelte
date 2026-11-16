<script lang="ts">
  // Importing skills from GitHub (scope §27), in a window: paste the address → the
  // worker fetches and checks it → read the preview (each SKILL.md, its files, the
  // flagged lines) → pick the skills, their names and the agents to give them to → install.
  // Opened with an import id (an update check), it starts at the review.
  import { onDestroy, untrack } from "svelte";
  import { invalidateAll } from "$app/navigation";
  import { FolderGit2, LoaderCircle, TriangleAlert, FileCode2, FileText, Check, ChevronDown, ExternalLink, Ban } from "@lucide/svelte";
  import Modal from "./Modal.svelte";
  import AgentMoon from "./AgentMoon.svelte";
  import Markdown from "./Markdown.svelte";
  import InfoTip from "./InfoTip.svelte";
  import { op } from "#lib/api.ts";
  import { live, throttle } from "#lib/stream.ts";

  type Warning = { file: string; line: number; reason: string; text: string };
  type Found = { key: number; name: string; path: string; description: string; skillMd: string; files: { path: string; size: number; script: boolean; skipped?: string }[]; warnings: Warning[]; domains: string[]; exists: null | { source: "local" } | { source: "github"; repo: string; path: string; sha: string }; hash: string; invalid?: string };
  type Import = { id: string; url: string; repo: string; path: string; ref: string | null; sha: string | null; status: string; error: string | null; found: Found[] };

  let { open = $bindable(false), agents, importId = null, currentSha = null }: { open?: boolean; agents: { slug: string; name: string; role: string }[]; importId?: string | null; currentSha?: string | null } = $props();

  let url = $state("");
  let ref = $state("");
  let error = $state("");
  let imp = $state<Import | null>(null);
  let picked = $state<Record<number, boolean>>({});
  let names = $state<Record<number, string>>({});
  let expanded = $state<Record<number, boolean>>({});
  let attach = $state<string[]>([]);
  let acknowledged = $state(false);
  let busy = $state(false);
  let installed = $state<string[] | null>(null);
  let stop: (() => void) | null = null;
  let poll: ReturnType<typeof setInterval> | null = null;

  const step = $derived(installed ? "done" : !imp ? "url" : imp.status === "fetching" ? "fetching" : imp.status === "failed" ? "failed" : "review");

  function reset() {
    url = ref = error = "";
    imp = null;
    picked = {};
    names = {};
    expanded = {};
    attach = [];
    acknowledged = false;
    installed = null;
    stopFollow();
  }
  function stopFollow() {
    stop?.();
    stop = null;
    if (poll) clearInterval(poll);
    poll = null;
  }
  onDestroy(stopFollow);

  async function refresh(id: string) {
    const row = await op<Import>("skills.import_get", { id });
    imp = row;
    if (row.status !== "fetching") {
      stopFollow();
      if (row.status === "ready") {
        for (const f of row.found) {
          names[f.key] ??= f.name;
          // one skill (or an update): picked; a whole repository: you choose
          picked[f.key] ??= !f.invalid && (row.found.length <= 3 || !!(f.exists && f.exists.source === "github"));
        }
      }
    }
  }
  function follow(id: string) {
    stopFollow();
    const tick = throttle(() => void refresh(id).catch(() => {}), 300);
    stop = live(["skills"], tick);
    poll = setInterval(tick, 1500);
    void refresh(id);
  }
  // opened on an existing import (an update check)
  $effect(() => {
    if (!open) return;
    const id = importId;
    untrack(() => {
      reset();
      if (id) follow(id);
    });
  });

  async function fetchIt(e: Event) {
    e.preventDefault();
    error = "";
    busy = true;
    try {
      const r = await op<{ id: string }>("skills.import", { url: url.trim(), ...(ref.trim() ? { ref: ref.trim() } : {}) });
      follow(r.id);
    } catch (err) {
      error = (err as Error).message;
    } finally {
      busy = false;
    }
  }

  const chosen = $derived(imp?.found.filter((f) => picked[f.key]) ?? []);
  const flagged = $derived(chosen.reduce((n, f) => n + f.warnings.length, 0));
  /** a pick whose name is taken by something else than an earlier import of this same folder */
  const conflict = (f: Found) => {
    const n = names[f.key] ?? f.name;
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(n)) return "use lowercase letters, digits and dashes";
    if (chosen.filter((x) => (names[x.key] ?? x.name) === n).length > 1) return "two skills have this name";
    if (n === f.name && f.exists) return f.exists.source === "github" && f.exists.repo === imp?.repo && f.exists.path === f.path ? null : `taken by ${f.exists.source === "local" ? "one of your skills" : `a skill from ${f.exists.repo}`}: rename it`;
    return null;
  };
  const isUpdate = (f: Found) => (names[f.key] ?? f.name) === f.name && f.exists?.source === "github" && f.exists.repo === imp?.repo && f.exists.path === f.path;
  const canInstall = $derived(!!chosen.length && chosen.every((f) => !conflict(f)) && (!flagged || acknowledged) && !busy);

  async function installIt() {
    if (!imp) return;
    busy = true;
    error = "";
    try {
      const r = await op<{ installed: string[] }>("skills.install", {
        id: imp.id, picks: chosen.map((f) => ({ key: f.key, name: names[f.key] ?? f.name })), replace: chosen.some(isUpdate), attach,
      });
      installed = r.installed;
      await invalidateAll();
    } catch (err) {
      error = (err as Error).message;
    } finally {
      busy = false;
    }
  }
  const kb = (n: number) => (n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`);
  const ghTree = (i: Import, path: string) => `https://github.com/${i.repo}/tree/${i.sha}/${path}`;
</script>

<Modal bind:open title={importId ? "Update a skill" : "Import skills from GitHub"} subtitle={step === "review" && imp ? `${imp.repo}${imp.path ? `/${imp.path}` : ""} · commit ${imp.sha?.slice(0, 7)}` : "Paste a repository, or a folder with a SKILL.md"} width="820px" onclose={stopFollow}>
  {#snippet icon()}<span class="grid h-9 w-9 place-items-center rounded-lg bg-accent/15 text-accent"><FolderGit2 size={18} /></span>{/snippet}

  {#if step === "url"}
    <form id="skill-url" class="space-y-3" onsubmit={fetchIt}>
      <div><label class="label" for="su">GitHub address</label><input id="su" class="input mono h-9" placeholder="https://github.com/anthropics/skills/tree/main/skills/pdf" bind:value={url} required autocomplete="off" /></div>
      <div class="grid gap-3 sm:grid-cols-[1fr_2fr]">
        <div><label class="label flex items-center gap-1" for="sr">Branch, tag or commit <InfoTip text="Optional. Empty: the branch in the address, or the repository's default branch. Either way the skill is pinned to the exact commit fetched." /></label><input id="sr" class="input mono" placeholder="main" bind:value={ref} autocomplete="off" /></div>
        <div class="self-end text-[12px] text-muted">A repository shows every skill in it; a folder (…/tree/&lt;branch&gt;/&lt;folder&gt;) only that one. Private repositories work when the GitHub App can see them.</div>
      </div>
      <div class="rounded-md border border-line bg-surface-2/50 p-3 text-[12px] text-fg-2">
        <div class="mb-1 flex items-center gap-1.5 font-medium text-fg"><TriangleAlert size={13} class="text-warn" /> A skill becomes an agent's instructions</div>
        Whoever wrote it steers the agents that load it. You'll read every SKILL.md before anything is installed; lines that ask for secrets, network calls, pushes or hiding things are flagged. Scripts in a skill are kept as text: nothing runs them.
      </div>
      {#if error}<p class="border-l-2 border-bad pl-2 text-[12px] text-bad">{error}</p>{/if}
    </form>
  {:else if step === "fetching"}
    <div class="flex flex-col items-center gap-3 py-10 text-center text-muted">
      <LoaderCircle size={28} class="animate-spin text-accent" />
      <div>Fetching <span class="mono text-fg">{imp?.repo}{imp?.path ? `/${imp.path}` : ""}</span>{imp?.ref ? ` at ${imp.ref}` : ""} and checking its files…</div>
    </div>
  {:else if step === "failed"}
    <div class="space-y-3">
      <p class="border-l-2 border-bad pl-2 text-bad">{imp?.error}</p>
      <button class="btn" onclick={reset}>Try another address</button>
    </div>
  {:else if step === "review" && imp}
    {#if currentSha && imp.sha === currentSha}
      <p class="mb-3 flex items-center gap-1.5 rounded-md bg-ok/10 px-3 py-2 text-[12.5px] text-ok"><Check size={14} /> Already up to date (commit {currentSha.slice(0, 7)}).</p>
    {:else if currentSha}
      <p class="mb-3 rounded-md bg-accent/10 px-3 py-2 text-[12.5px] text-fg-2">New version: {currentSha.slice(0, 7)} → <span class="mono text-fg">{imp.sha?.slice(0, 7)}</span>. Read it before updating.</p>
    {/if}
    <div class="mb-2 flex items-center gap-2 text-[12px] text-muted">
      <span>{imp.found.length} skill{imp.found.length === 1 ? "" : "s"} found · pick the ones to install</span>
      {#if imp.found.length > 1}<button class="ml-auto text-accent" onclick={() => { const on = !chosen.length; imp!.found.forEach((f) => (picked[f.key] = on && !f.invalid)); }}>{chosen.length ? "Unpick all" : "Pick all"}</button>{/if}
    </div>
    <div class="space-y-2">
      {#each imp.found as f (f.key)}
        {@const c = picked[f.key] ? conflict(f) : null}
        <div class="rounded-lg border {picked[f.key] ? 'border-accent/60 bg-accent/5' : 'border-line'}">
          <div class="flex flex-wrap items-start gap-3 p-3">
            <input type="checkbox" class="mt-1" bind:checked={picked[f.key]} disabled={!!f.invalid} aria-label="Install {f.name}" />
            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-center gap-2">
                <input class="input mono h-7 w-56" bind:value={names[f.key]} aria-label="Name of {f.name}" disabled={!picked[f.key]} />
                {#if isUpdate(f)}<span class="rounded bg-info/15 px-1.5 text-[11px] text-info">updates the installed one</span>{/if}
                <a class="inline-flex items-center gap-0.5 text-[11.5px] text-muted hover:text-accent" href={ghTree(imp, f.path)} target="_blank" rel="noopener noreferrer">{f.path || "/"} <ExternalLink size={11} /></a>
              </div>
              {#if f.invalid}<p class="mt-1 text-[12px] text-bad">Can't be installed: {f.invalid}</p>{:else}<p class="mt-1 line-clamp-3 text-[12px] text-muted" title={f.description}>{f.description}</p>{/if}
              <div class="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11.5px]">
                <span class="text-fg-2">{f.files.filter((x) => !x.skipped).length} files</span>
                {#if f.files.some((x) => x.script && !x.skipped)}<span class="text-fg-2">{f.files.filter((x) => x.script && !x.skipped).length} scripts (kept as text, never run)</span>{/if}
                {#if f.files.some((x) => x.skipped)}<span class="text-warn">{f.files.filter((x) => x.skipped).length} left out</span>{/if}
                {#if f.warnings.length}<span class="inline-flex items-center gap-1 text-warn"><TriangleAlert size={12} /> {f.warnings.length} flagged line{f.warnings.length === 1 ? "" : "s"}</span>{:else}<span class="text-ok">nothing flagged</span>{/if}
                {#if f.domains.length}<span class="text-muted">links: {f.domains.slice(0, 4).join(", ")}{f.domains.length > 4 ? "…" : ""}</span>{/if}
              </div>
              {#if c}<p class="mt-1 text-[12px] text-bad">{c}</p>{/if}
            </div>
            <button class="btn btn-ghost h-7 px-1.5" onclick={() => (expanded[f.key] = !expanded[f.key])} aria-expanded={!!expanded[f.key]}>Read <ChevronDown size={13} class="transition-transform {expanded[f.key] ? 'rotate-180' : ''}" /></button>
          </div>
          {#if expanded[f.key]}
            <div class="space-y-3 border-t border-line p-3">
              {#if f.warnings.length}
                <div>
                  <div class="label">Flagged lines</div>
                  <ul class="space-y-1">{#each f.warnings as w}<li class="rounded bg-warn/10 px-2 py-1 text-[12px]"><span class="mono text-muted">{w.file}:{w.line}</span> <span class="text-warn">{w.reason}</span><div class="mono mt-0.5 break-words text-fg">{w.text}</div></li>{/each}</ul>
                </div>
              {/if}
              <div>
                <div class="label">SKILL.md</div>
                <div class="max-h-80 overflow-auto rounded-md border border-line bg-surface-0 p-3"><Markdown text={f.skillMd} /></div>
              </div>
              <div>
                <div class="label">Files</div>
                <ul class="grid gap-x-4 gap-y-0.5 text-[12px] sm:grid-cols-2">
                  {#each f.files as x}<li class="flex items-center gap-1.5 {x.skipped ? 'text-muted line-through' : ''}" title={x.skipped ?? ""}>{#if x.script}<FileCode2 size={12} />{:else}<FileText size={12} />{/if}<span class="mono min-w-0 truncate">{x.path}</span><span class="ml-auto shrink-0 text-muted">{x.skipped ? x.skipped : kb(x.size)}</span></li>{/each}
                </ul>
              </div>
            </div>
          {/if}
        </div>
      {/each}
    </div>

    {#if agents.length}
      <div class="mt-4">
        <div class="label flex items-center gap-1">Give them to <InfoTip text="Optional. Each agent picked gets every skill installed here, in a new deployed version (load_skill turned on). An agent can carry many skills; you can change them later in its editor." /></div>
        <div class="flex flex-wrap gap-1.5">
          {#each agents as a}
            {@const on = attach.includes(a.slug)}
            <button type="button" class="flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[12px] {on ? 'border-accent bg-accent/15 text-fg' : 'border-line text-fg-2 hover:bg-surface-2'}" aria-pressed={on} onclick={() => (attach = on ? attach.filter((x) => x !== a.slug) : [...attach, a.slug])}>
              <AgentMoon slug={a.slug} size={14} />{a.slug}{#if on}<Check size={11} />{/if}
            </button>
          {/each}
        </div>
      </div>
    {/if}
    {#if flagged}
      <label class="mt-4 flex items-start gap-2 rounded-md border border-warn/40 bg-warn/5 p-2.5 text-[12px] text-fg-2"><input type="checkbox" class="mt-0.5" bind:checked={acknowledged} /> I read the {flagged} flagged line{flagged === 1 ? "" : "s"} and want to install anyway.</label>
    {/if}
    {#if error}<p class="mt-3 border-l-2 border-bad pl-2 text-[12px] text-bad">{error}</p>{/if}
  {:else if step === "done" && installed}
    <div class="flex flex-col items-center gap-2 py-8 text-center">
      <span class="grid h-10 w-10 place-items-center rounded-full bg-ok/15 text-ok"><Check size={20} /></span>
      <div class="font-medium">Installed {installed.join(", ")}</div>
      <p class="max-w-md text-[12px] text-muted">{attach.length ? `Given to ${attach.map((a) => `a/${a}`).join(", ")}.` : "Attach them to agents in each agent's editor (Skills tab)."} Pinned to commit {imp?.sha?.slice(0, 7)}; "Check for update" fetches newer versions for review.</p>
    </div>
  {/if}

  {#snippet footer()}
    {#if step === "url"}
      <button class="btn" onclick={() => (open = false)}>Cancel</button>
      <button class="btn btn-primary" form="skill-url" disabled={busy || !url.trim()}>{#if busy}<LoaderCircle size={13} class="animate-spin" />{/if} Fetch and review</button>
    {:else if step === "review"}
      {#if !importId}<button class="btn" onclick={reset}><Ban size={13} /> Start over</button>{/if}
      <button class="btn" onclick={() => (open = false)}>Cancel</button>
      <button class="btn btn-primary" disabled={!canInstall} onclick={installIt}>{#if busy}<LoaderCircle size={13} class="animate-spin" />{/if} {chosen.some(isUpdate) && chosen.length === 1 ? "Update" : `Install ${chosen.length || ""}`}</button>
    {:else}
      <button class="btn btn-primary" onclick={() => (open = false)}>Close</button>
    {/if}
  {/snippet}
</Modal>
