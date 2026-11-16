<script lang="ts">
  // Settings (scope §18.5): one page in four groups (AI, spending, access, platform),
  // each section folding. The left rail follows the scroll (a bar marks where you are);
  // configuring a provider or adding an AI opens a window inside the page.
  // ?open=<section|dialog> jumps straight to it (add-ai, anthropic, subscription, azure, local, budgets, engines, agents…).
  import { onMount, tick, untrack } from "svelte";
  import { enhance } from "$app/forms";
  import { page } from "$app/state";
  import { Bot, Cpu, CreditCard, KeyRound, Plug, Server, Sparkles, Plus, Check, Cloud, HardDrive, Palette, Clock, Box, Coins, Users, ChevronRight, Copy, BookOpen, FolderGit2, RefreshCw, Trash2, Eye, ExternalLink } from "@lucide/svelte";
  import SkillImport from "#lib/components/SkillImport.svelte";
  import Markdown from "#lib/components/Markdown.svelte";
  import { op } from "#lib/api.ts";
  import { invalidateAll } from "$app/navigation";
  import StatusBadge from "#lib/components/StatusBadge.svelte";
  import BudgetUnitSwitch from "#lib/components/BudgetUnitSwitch.svelte";
  import Variables from "#lib/components/Variables.svelte";
  import Modal from "#lib/components/Modal.svelte";
  import InfoTip from "#lib/components/InfoTip.svelte";
  import ReadMore from "#lib/components/ReadMore.svelte";
  import Collapsible from "#lib/components/Collapsible.svelte";
  import AgentMoon from "#lib/components/AgentMoon.svelte";
  import Logo from "#lib/components/Logo.svelte";
  import { time } from "#lib/format.ts";
  import { currentTheme, setTheme, THEMES, type Theme } from "#lib/theme.ts";

  let { data, form } = $props();

  // ------------------------------------------------------------------ navigation
  type NavItem = readonly [string, string, typeof Sparkles];
  const NAV: readonly { group: string; items: readonly NavItem[] }[] = [
    { group: "AI", items: [["providers", "AI providers", Sparkles], ["models", "Models per role", Cpu], ["engines", "Engines", Bot], ["agents", "Agent mode", Users], ["skills", "Skills", BookOpen]] },
    { group: "Spending", items: [["budgets", "Budgets", Coins], ["prices", "Prices", CreditCard]] },
    { group: "Access", items: [["connections", "Connections", Plug], ["secrets", "Secrets", KeyRound], ["variables", "Variables", Box], ["tokens", "API tokens", KeyRound]] },
    { group: "Platform", items: [["sandbox", "Sandbox", Server], ["schedules", "Schedules", Clock], ["appearance", "Appearance", Palette]] },
  ];
  const ids = NAV.flatMap((g) => g.items.map((i) => i[0]));
  let current = $state<string>("providers");
  let progress = $state(0);
  let scroller: HTMLElement | null = null;
  const openState = $state<Record<string, boolean>>(Object.fromEntries(ids.map((id) => [id, true])));

  onMount(() => {
    scroller = document.querySelector("main");
    const onScroll = () => {
      if (!scroller) return;
      const max = scroller.scrollHeight - scroller.clientHeight;
      progress = max > 0 ? scroller.scrollTop / max : 0;
      // the section whose top passed the upper third of the screen
      const line = scroller.getBoundingClientRect().top + scroller.clientHeight * 0.3;
      let at = ids[0]!;
      for (const id of ids) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top <= line) at = id;
      }
      if (max > 0 && scroller.scrollTop >= max - 4) at = ids.at(-1)!;
      if (at !== current) {
        // keep the active chip visible in the phone bar
        const chip = document.querySelector<HTMLElement>(`[data-chip="${at}"]`);
        const bar = chip?.parentElement;
        if (chip && bar) bar.scrollTo({ left: chip.offsetLeft - bar.offsetLeft - 12, behavior: "smooth" });
      }
      current = at;
    };
    scroller?.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    const o = page.url.searchParams.get("open");
    if (o) void openTarget(o);
    return () => scroller?.removeEventListener("scroll", onScroll);
  });

  async function go(id: string) {
    openState[id] = true;
    await tick();
    // scroll only the page area: scrollIntoView would also shift the app shell
    const el = document.getElementById(id);
    if (el && scroller) scroller.scrollTo({ top: scroller.scrollTop + el.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 56, behavior: "smooth" });
  }
  const DIALOGS = ["add-ai", "anthropic", "subscription", "azure", "local"] as const;
  type Dialog = (typeof DIALOGS)[number] | "price" | "secret" | "token" | null;
  let dialog = $state<Dialog>(null);
  async function openTarget(o: string) {
    if ((DIALOGS as readonly string[]).includes(o)) dialog = o as Dialog;
    else if (ids.includes(o)) await go(o);
  }

  // ------------------------------------------------------------------ forms
  let toast = $state<{ ok: boolean; text: string } | null>(null);
  let toastTimer: ReturnType<typeof setTimeout>;
  $effect(() => {
    if (!form) return;
    const f = form as { ok?: string; error?: string };
    untrack(() => {
      toast = f.error ? { ok: false, text: f.error } : f.ok ? { ok: true, text: `Saved ${f.ok}.` } : null;
      clearTimeout(toastTimer);
      if (toast?.ok) toastTimer = setTimeout(() => (toast = null), 4000);
    });
  });
  /** submits in place; closes the window on success (unless keep) */
  const submit = (keep = false) => () => async ({ result, update }: { result: { type: string }; update: (o?: { reset?: boolean }) => Promise<void> }) => {
    await update({ reset: !keep && result.type === "success" });
    if (result.type === "success" && !keep && !(page.form as { error?: string } | null)?.error) dialog = null;
  };

  // ------------------------------------------------------------------ data
  const tokenFmt = (n: number | null | undefined) => (n == null ? "" : String(n));
  const roles: [keyof typeof data.models, string, string][] = [
    ["manager", "Manager (Luna)", "Plans, answers the chat, creates and moves cards. A strong model pays off here."],
    ["brief_writer", "Brief writer", "Turns each planned card into a short self-contained brief before routing; also compacts long runs. A cheap model is fine."],
    ["worker_default", "Worker · cheap tier", "Used for cards the router judges simple (the haiku tier)."],
    ["worker_strong", "Worker · strong tier", "Used for complex cards, and whenever the router isn't confident."],
    ["reviewer", "Reviewer", "Reviews each change against the brief, the acceptance criteria and the check results before it reaches you."],
    ["security", "Security", "Security scans of changes (later phase)."],
    ["decisions_fallback", "Decisions fallback", "Answers routing, triage and risk decisions when the local decision model is off or unsure."],
    ["colibri_decision_model", "Colibri decision model", "The local System One model on Colibri. Leave empty to turn it off."],
    ["local_decision_model", "Ollama decision model", "A decision model on the local Ollama. Leave empty to turn it off."],
  ];
  const engineRoles: [keyof typeof data.engines, string][] = [["manager", "Manager (Luna)"], ["worker", "Workers & tester"], ["reviewer", "Reviewer"], ["brief_writer", "Brief writer"]];
  const budgetLabels: Record<string, [string, string]> = {
    global_month: ["Global per month", "Everything the platform spends in a calendar month."],
    global_day: ["Global per day", "Everything the platform spends in a day; the sidebar shows today against it."],
    card: ["Per card", "What one card may use across all its runs, reviews included."],
    meeting: ["Per meeting", "What one meeting of agents may use."],
    agent_day: ["Per agent per day", "What each agent may use in a day."],
  };
  const modelSuggestions = $derived([...new Set([...data.prices.map((p) => (p.provider === "azure" ? `azure:${p.model}` : p.model)), ...Object.values(data.models).filter(Boolean) as string[]])].sort());

  const providers = $derived([
    { id: "anthropic", name: "Anthropic API", desc: "Claude models billed per token with API credits.", icon: Cloud, ok: data.providers.anthropic, status: data.providers.anthropic ? "Key loaded" : "No key" },
    { id: "subscription", name: "Claude subscription", desc: "Use your Pro/Max plan through Claude Code in the sandbox.", icon: Sparkles, ok: !!data.subscription, status: data.subscription ? (data.subscription.lastUsedAt ? `Used ${time(data.subscription.lastUsedAt)}` : "Connected") : "Not connected" },
    { id: "azure", name: "Azure Foundry", desc: "OpenAI-compatible deployments (GPT and others) on Azure.", icon: Server, ok: data.providers.azure.apiKeyLoaded && !!data.providers.azure.deployment, status: data.providers.azure.apiKeyLoaded ? (data.providers.azure.deployment ? `azure:${data.providers.azure.deployment}` : "No deployment") : "No key" },
    { id: "local", name: "Local models", desc: "Colibri (System One decisions) and Ollama (embeddings).", icon: HardDrive, ok: true, status: `embeddings ${data.providers.embedding}` },
  ] as const);

  let theme = $state<Theme>("orbitalia");
  onMount(() => (theme = currentTheme()));
  let soloMode = $state<"multi" | "single">(untrack(() => data.agentMode.mode));
  let soloAgent = $state(untrack(() => (data.agentMode.mode === "single" ? data.agentMode.agent : (data.harnessChoices[0]?.slug ?? "__new"))));
  let newHarness = $state("claude-code");
  let wizardPick = $state<string | null>(null);
  const copy = (t: string) => navigator.clipboard?.writeText(t);

  // ---- skills
  let importOpen = $state(false);
  let importId = $state<string | null>(null);
  let importSha = $state<string | null>(null);
  let skillErr = $state("");
  let viewing = $state<{ name: string; text: string; files: { path: string; size: number }[] } | null>(null);
  function newImport() {
    importId = importSha = null;
    importOpen = true;
  }
  async function checkUpdate(name: string) {
    skillErr = "";
    try {
      const r = await op<{ id: string; current: string }>("skills.check_update", { name });
      importId = r.id;
      importSha = r.current;
      importOpen = true;
    } catch (e) {
      skillErr = (e as Error).message;
    }
  }
  async function viewSkill(name: string) {
    skillErr = "";
    try {
      viewing = await op("skills.view", { name });
    } catch (e) {
      skillErr = (e as Error).message;
    }
  }
  async function removeSkill(name: string, agents: string[]) {
    if (!confirm(`Delete the skill ${name}?${agents.length ? ` ${agents.map((a) => `a/${a}`).join(", ")} will stop seeing it.` : ""}`)) return;
    skillErr = "";
    try {
      await op("skills.remove", { name });
      await invalidateAll();
    } catch (e) {
      skillErr = (e as Error).message;
    }
  }
</script>

<svelte:head><title>Settings · Orbitalia Moon</title></svelte:head>

<!-- reading progress -->
<div class="sticky top-0 z-20 h-0.5 w-full bg-transparent"><div class="h-0.5 bg-accent transition-[width] duration-100" style="width: {progress * 100}%"></div></div>

<div class="mx-auto flex max-w-6xl gap-6 px-3 pb-24 sm:px-5">
  <!-- section rail (desktop) -->
  <nav class="sticky top-4 hidden h-fit w-52 shrink-0 pt-4 lg:block" aria-label="Settings sections">
    {#each NAV as g}
      <div class="mt-3 mb-1 px-2 text-[10.5px] font-medium tracking-wider text-muted uppercase first:mt-0">{g.group}</div>
      {#each g.items as [id, label, Icon]}
        <button class="relative flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] {current === id ? 'bg-surface-2 text-fg' : 'text-fg-2 hover:bg-surface-2 hover:text-fg'}" onclick={() => go(id)} aria-current={current === id ? "true" : undefined}>
          <span class="absolute top-1 bottom-1 left-0 w-0.5 rounded-full transition-colors {current === id ? 'bg-accent' : 'bg-transparent'}"></span>
          <Icon size={14} />{label}
        </button>
      {/each}
    {/each}
  </nav>

  <div class="min-w-0 flex-1 space-y-4 pt-4">
    <!-- section chips (phones/tablets) -->
    <div class="sticky top-0.5 z-10 -mx-3 flex gap-1.5 scroll-x border-b border-line bg-surface-0/95 px-3 py-2 backdrop-blur lg:hidden" aria-label="Settings sections">
      {#each NAV.flatMap((g) => g.items) as [id, label]}
        <button data-chip={id} class="shrink-0 rounded-full border px-2.5 py-1 text-[12px] {current === id ? 'border-accent bg-accent/15 text-fg' : 'border-line text-fg-2'}" onclick={() => go(id)}>{label}</button>
      {/each}
    </div>

    <header class="flex flex-wrap items-end gap-3">
      <div class="min-w-0 flex-1">
        <h2 class="text-[18px] font-semibold">Settings</h2>
        <p class="text-[12.5px] text-muted">Connect AIs, pick models for each role, set spending limits and manage access.</p>
      </div>
      <button class="btn btn-primary" onclick={() => { wizardPick = null; dialog = "add-ai"; }}><Plus size={14} /> Add an AI</button>
    </header>

    <!-- ================================================================ AI -->
    <Collapsible id="providers" title="AI providers" summary="where the models come from" bind:open={openState.providers}>
      <div class="grid gap-3 sm:grid-cols-2 2xl:grid-cols-4">
        {#each providers as p}
          {@const Icon = p.icon}
          <button class="group flex flex-col rounded-lg border border-line bg-surface-2/50 p-3 text-left transition hover:border-accent/60 hover:bg-surface-2" onclick={() => (dialog = p.id)}>
            <div class="flex items-center gap-2">
              <span class="grid h-8 w-8 place-items-center rounded-md bg-accent/15 text-accent"><Icon size={16} /></span>
              <span class="font-medium">{p.name}</span>
            </div>
            <p class="mt-2 line-clamp-2 flex-1 text-[12px] text-muted">{p.desc}</p>
            <div class="mt-2 flex items-center gap-1.5 text-[11.5px]">
              <StatusBadge status={p.ok ? "ok" : "canceled"} compact /><span class="truncate {p.ok ? 'text-fg-2' : 'text-muted'}">{p.status}</span>
              <span class="ml-auto inline-flex items-center text-accent opacity-70 group-hover:opacity-100">Configure <ChevronRight size={13} /></span>
            </div>
          </button>
        {/each}
      </div>
      <ReadMore class="mt-3" lines={1}>
        Model ids per role tell the platform which provider to use: <span class="mono">claude-…</span> goes to the Anthropic API (or the subscription, when that role's engine is the subscription), <span class="mono">azure:&lt;deployment&gt;</span> to Azure Foundry (for example <span class="mono">azure:gpt-5.1</span>), and <span class="mono">colibri:&lt;agent&gt;</span> to the local System One. Set a monthly spend limit in the Anthropic Console too: it holds even if this platform's enforcement fails.
      </ReadMore>
    </Collapsible>

    <Collapsible id="models" title="Models per role" summary="which model each role uses" bind:open={openState.models}>
      <form method="POST" action="?/models" use:enhance={submit(true)} class="space-y-1">
        <datalist id="model-choices">{#each modelSuggestions as m}<option value={m}></option>{/each}</datalist>
        {#each roles as [key, label, info]}
          <div class="grid items-center gap-1 rounded-md px-1 py-1.5 sm:grid-cols-[minmax(0,15rem)_minmax(0,1fr)] sm:gap-3 hover:bg-surface-2/50">
            <label class="flex min-w-0 items-center gap-1.5 text-fg-2" for="m-{key}"><span class="truncate">{label}</span><InfoTip text={info} /></label>
            <input id="m-{key}" name={key} class="input mono min-w-0" list="model-choices" value={data.models[key] ?? ""} placeholder="(off / default)" autocomplete="off" />
          </div>
        {/each}
        <div class="flex items-center gap-3 pt-2">
          <button class="btn btn-primary">Save models</button>
          <span class="text-[11.5px] text-muted">An empty role goes back to its default. Prices live in <button type="button" class="text-accent" onclick={() => go("prices")}>Prices</button>.</span>
        </div>
      </form>
    </Collapsible>

    <Collapsible id="engines" title="Engines" summary="API credits or your Claude plan, per role" bind:open={openState.engines}>
      <form method="POST" action="?/engines" use:enhance={submit(true)} class="space-y-2">
        {#each engineRoles as [key, label]}
          <div class="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <span class="w-40 text-fg-2">{label}</span>
            <div class="inline-flex rounded-md border border-line bg-surface-1 p-0.5" role="radiogroup" aria-label="{label} engine">
              {#each [["api", "API credits"], ["claude_code", "Claude subscription"]] as [v, l]}
                <label class="cursor-pointer rounded px-2.5 py-1 text-[12px] has-checked:bg-accent has-checked:text-accent-fg has-disabled:cursor-not-allowed has-disabled:opacity-40">
                  <input class="sr-only" type="radio" name={key} value={v} checked={data.engines[key] === v} disabled={v === "claude_code" && !data.subscription} /> {l}
                </label>
              {/each}
            </div>
          </div>
        {/each}
        {#if !data.subscription}<p class="text-[12px] text-muted">Connect the <button type="button" class="text-accent" onclick={() => (dialog = "subscription")}>Claude subscription</button> to use it here.</p>{/if}
        <ReadMore lines={1}>Routing decisions and context compaction stay on the API (Haiku costs cents there) or on Colibri once it runs. On the subscription, roles run the real Claude Code inside the sandbox: mid-run tool approvals and questions aren't available there.</ReadMore>
        <button class="btn btn-primary">Save engines</button>
      </form>
    </Collapsible>

    <Collapsible id="agents" title="Agent mode" summary={data.agentMode.mode === "single" ? `harness · a/${data.agentMode.agent} does it all` : "team of agents run by the platform"} bind:open={openState.agents}>
      <form method="POST" action="?/agentMode" use:enhance={submit(true)} class="space-y-3">
        <div class="grid gap-3 sm:grid-cols-2">
          {#each [["multi", "Team of agents", "Orbitalia Moon runs the agents: a brief writer prepares each card, a router picks the worker and model tier, a tester tests everything, a reviewer checks the work, and Luna plans and chats."], ["single", "One agent does it all", "Your harness (Claude Code, for instance) does everything. Orbitalia Moon runs no agents and becomes the view of what the harness does, as Luna or any other agent."]] as [v, title, desc]}
            <label class="cursor-pointer rounded-lg border p-3 transition {soloMode === v ? 'border-accent bg-accent/10' : 'border-line hover:border-accent/50'}">
              <div class="flex items-center gap-2"><input type="radio" name="mode" value={v} bind:group={soloMode} class="accent-[var(--accent)]" /><span class="font-medium">{title}</span></div>
              <p class="mt-1 pl-5 text-[12px] text-muted">{desc}</p>
            </label>
          {/each}
        </div>
        {#if soloMode === "single"}
          <div class="space-y-3 rounded-lg border border-line bg-surface-2/40 p-3">
            <div class="flex flex-wrap items-center gap-3">
              <AgentMoon slug={soloAgent === "__new" ? newHarness || "harness" : soloAgent} size={32} spin />
              <label class="text-fg-2" for="solo">The harness</label>
              <select id="solo" name="agent" class="input mono w-60" bind:value={soloAgent}>
                {#each data.harnessChoices as a}<option value={a.slug}>a/{a.slug}</option>{/each}
                <option value="__new">+ new harness identity…</option>
                {#if data.soloChoices.length}<optgroup label="or an internal agent (runs here)">{#each data.soloChoices as a}<option value={a.slug}>a/{a.slug} · {a.role}</option>{/each}</optgroup>{/if}
              </select>
              {#if soloAgent === "__new"}<input name="newHarness" class="input mono w-48" placeholder="claude-code" bind:value={newHarness} aria-label="Harness name" />{/if}
            </div>
            {#if soloAgent === "__new" || data.harnessChoices.some((a) => a.slug === soloAgent)}
              <ol class="list-decimal space-y-1.5 pl-5 text-[12px] text-fg-2">
                <li>Create an API token that acts as you (<button type="button" class="text-accent" onclick={() => (dialog = "token")}>Create token</button>, access <span class="mono">write</span>), so the harness can act as any agent.</li>
                <li>Connect the harness: <span class="mono break-all text-fg">claude mcp add --transport http miniasys {data.publicUrl}/mcp --header "Authorization: Bearer &lt;token&gt;"</span></li>
                <li>It answers the chat with <span class="mono">manager.pending</span> → <span class="mono">manager.reply</span> (as Luna or any agent), works the cards assigned to <span class="mono">a/{soloAgent === "__new" ? newHarness || "…" : soloAgent}</span>, and acts as any agent with <span class="mono">--as &lt;agent&gt;</span> (CLI) or the <span class="mono">X-Miniasys-Agent</span> header.</li>
              </ol>
              <ReadMore lines={1}>In this mode no brief writer, router, reviewer or Luna runs here, and no daily report is written: cards are assigned to the harness and wait for it, chat messages wait for it to answer in that agent's name, and everything it does shows up on the board, in the chats, on each agent's page and in the audit log.</ReadMore>
            {:else}
              <p class="text-[12px] text-muted">An internal agent works every card here and reviews its own change after the checks; Luna still plans and chats.</p>
            {/if}
          </div>
        {:else}<input type="hidden" name="agent" value={soloAgent} />{/if}
        <button class="btn btn-primary">Save agent mode</button>
      </form>
    </Collapsible>

    <Collapsible id="skills" title="Skills" summary="{data.skills.length} installed · instructions agents load on demand" bind:open={openState.skills}>
      {#snippet actions()}<button class="btn btn-primary" onclick={newImport}><FolderGit2 size={13} /> Import from GitHub</button>{/snippet}
      <ReadMore lines={1} class="mb-3">A skill is a folder with a SKILL.md: instructions an agent loads when a task needs them (several at once, and their reference files). Your own skills (in the skills folder) are available to every agent with load_skill. Imported skills are pinned to a commit and reach only the agents you give them to: in the import window, or in each agent's editor (Skills tab). An agent can carry as many skills as you like.</ReadMore>
      {#if skillErr}<p class="mb-2 border-l-2 border-bad pl-2 text-[12px] text-bad">{skillErr}</p>{/if}
      <div class="rounded-md border border-line">
        {#each data.skills as k (k.name)}
          <div class="flex flex-wrap items-start gap-x-3 gap-y-1 border-b border-line px-3 py-2.5 last:border-b-0">
            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-center gap-1.5">
                <span class="mono font-medium">{k.name}</span>
                {#if k.source.kind === "github"}
                  <a class="inline-flex items-center gap-1 rounded border border-line px-1.5 text-[10.5px] text-muted hover:text-accent" href="https://github.com/{k.source.repo}/tree/{k.source.sha}/{k.source.path}" target="_blank" rel="noopener noreferrer"><FolderGit2 size={10} />{k.source.repo}@{k.source.sha.slice(0, 7)} <ExternalLink size={9} /></a>
                {:else}<span class="rounded bg-surface-3 px-1.5 text-[10.5px] text-muted">local</span>{/if}
              </div>
              <p class="mt-0.5 line-clamp-2 text-[12px] text-muted">{k.description}</p>
              <div class="mt-1 flex flex-wrap items-center gap-1 text-[11px] text-muted">
                {#if k.agents.length}{#each k.agents as a}<a href="/agents/{a}" class="inline-flex items-center gap-1 rounded-full border border-line px-1.5 py-0.5 hover:border-accent"><AgentMoon slug={a} size={12} />{a}</a>{/each}
                {:else if k.source.kind === "local"}available to every agent with load_skill
                {:else}<span class="text-warn">not given to any agent yet</span>{/if}
              </div>
            </div>
            <div class="flex shrink-0 gap-1">
              <button class="btn btn-ghost px-1.5" onclick={() => viewSkill(k.name)} title="Read it" aria-label="Read {k.name}"><Eye size={14} /></button>
              {#if k.source.kind === "github"}<button class="btn btn-ghost px-1.5" onclick={() => checkUpdate(k.name)} title="Check for update" aria-label="Check {k.name} for updates"><RefreshCw size={14} /></button>{/if}
              <button class="btn btn-ghost px-1.5 text-bad" onclick={() => removeSkill(k.name, k.agents)} title="Delete" aria-label="Delete {k.name}"><Trash2 size={14} /></button>
            </div>
          </div>
        {:else}
          <div class="p-6 text-center text-[12.5px] text-muted">
            <BookOpen size={22} class="mx-auto mb-2 opacity-60" />
            No skills yet. <button class="text-accent" onclick={newImport}>Import some from GitHub</button>, or add folders with a SKILL.md to the skills folder.
          </div>
        {/each}
      </div>
    </Collapsible>

    <!-- ================================================================ spending -->
    <Collapsible id="budgets" title="Budgets" summary="limits checked before every model call" bind:open={openState.budgets}>
      <div class="mb-3 rounded-md bg-surface-2/60 p-3">
        <BudgetUnitSwitch unit={data.budgetUnit} />
        <p class="mt-1.5 text-[12px] text-muted">Both are always recorded; this decides which one blocks a run, and what Costs shows.</p>
      </div>
      <form method="POST" action="?/budgets" use:enhance={submit(true)} class="space-y-3">
        <div class="space-y-1">
          <div class="hidden grid-cols-[minmax(0,1fr)_8rem_9rem] gap-3 px-1 sm:grid"><span></span><span class="label mb-0">Dollars</span><span class="label mb-0">Tokens</span></div>
          {#each data.budgets as b}
            {@const [label, info] = budgetLabels[b.scope] ?? [b.scope, ""]}
            <div class="grid grid-cols-2 items-center gap-x-3 gap-y-1 rounded-md px-1 py-1.5 sm:grid-cols-[minmax(0,1fr)_8rem_9rem] hover:bg-surface-2/50">
              <label class="col-span-2 flex items-center gap-1.5 text-fg-2 sm:col-span-1" for="b-{b.scope}">{label}{#if info}<InfoTip text={info} />{/if}</label>
              <div class="relative"><span class="pointer-events-none absolute top-1.5 left-2 text-muted">$</span><input id="b-{b.scope}" name={b.scope} type="number" step="0.01" min="0" class="input num pl-5" value={b.limitUsd} aria-label="{label} dollars" /></div>
              <input name="{b.scope}_tokens" type="number" step="1000" min="0" class="input num" value={tokenFmt(b.limitTokens)} placeholder="tokens" aria-label="{label} tokens" />
            </div>
          {/each}
        </div>
        <p class="text-[12px] text-muted">Alerts at 50% (inbox), 80% (phone), 100% (block + phone). Project budgets are set in each project's settings.</p>
        <button class="btn btn-primary">Save budgets</button>
      </form>
    </Collapsible>

    <Collapsible id="prices" title="Prices" summary="USD per million tokens" bind:open={openState.prices}>
      {#snippet actions()}<button class="btn" onclick={() => (dialog = "price")}><Plus size={13} /> Add price</button>{/snippet}
      <div class="overflow-x-auto rounded-md border border-line">
        <table class="num w-full min-w-[560px] text-[12px]">
          <thead class="bg-surface-2/60 text-left text-muted"><tr><th class="px-3 py-1.5 font-medium">Provider / model</th><th class="text-right font-medium">Input</th><th class="text-right font-medium">Output</th><th class="text-right font-medium">Cache write</th><th class="text-right font-medium">Cache read</th><th class="px-3 text-right font-medium">From</th></tr></thead>
          <tbody>{#each data.prices as p}<tr class="border-t border-line"><td class="mono px-3 py-1.5">{p.provider}/{p.model}</td><td class="text-right">{p.inputPerMtok}</td><td class="text-right">{p.outputPerMtok}</td><td class="text-right">{p.cacheWritePerMtok}</td><td class="text-right">{p.cacheReadPerMtok}</td><td class="px-3 text-right whitespace-nowrap">{p.effectiveFrom}</td></tr>{/each}</tbody>
        </table>
      </div>
      <p class="mt-2 text-[12px] text-muted">A call is priced with the row effective that day. Subscription calls cost $0 here; they count in tokens.</p>
    </Collapsible>

    <!-- ================================================================ access -->
    <Collapsible id="connections" title="Connections" summary="GitHub, phone alerts" bind:open={openState.connections}>
      <div class="divide-y divide-line rounded-md border border-line">
        <div class="flex flex-wrap items-center gap-2 p-3"><StatusBadge status={data.providers.github?.key ? "ok" : "error"} compact /><span class="font-medium">GitHub App</span>
          <span class="min-w-0 basis-full text-[12px] break-words text-muted sm:basis-auto">{data.providers.github ? `app ${data.providers.github.appId} · installation ${data.providers.github.installationId ?? "?"}${data.providers.github.key ? "" : " · private key missing"}` : "not configured"}</span>
          {#if !data.providers.github}<InfoTip wide text="Set GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY_FILE and GITHUB_INSTALLATION_ID in .env. Without it, code stays in the project's own repository and merges happen here." />{/if}</div>
        <div class="flex flex-wrap items-center gap-2 p-3"><StatusBadge status={data.providers.ntfy ? "ok" : "error"} compact /><span class="font-medium">ntfy</span>
          <span class="min-w-0 basis-full text-[12px] break-words text-muted sm:basis-auto">{data.providers.ntfy ? `${data.providers.ntfy.url} · topic ${data.providers.ntfy.topic}` : "phone alerts are off; the inbox still works"}</span>
          {#if !data.providers.ntfy}<InfoTip text="Set NTFY_TOPIC (and optionally NTFY_URL) in .env to get phone alerts." />{/if}</div>
        <div class="flex flex-wrap items-center gap-2 p-3 text-muted"><StatusBadge status="canceled" compact /><span class="font-medium">Windmill</span><span class="text-[12px]">Phase 4</span><InfoTip text="Security design pending: dedicated token, one folder, draft-only, deploy by approval." /></div>
      </div>
    </Collapsible>

    <Collapsible id="secrets" title="Secrets" summary="encrypted, write-only" bind:open={openState.secrets}>
      {#snippet actions()}<button class="btn" onclick={() => (dialog = "secret")} disabled={!data.providers.masterKey}><Plus size={13} /> Add secret</button>{/snippet}
      {#if !data.providers.masterKey}<p class="mb-2 border-l-2 border-warn pl-2 text-[12px] text-warn">MASTER_KEY_FILE is not set: secrets can't be stored yet.</p>{/if}
      <div class="rounded-md border border-line">
        {#each data.secrets as s}
          <div class="row flex-wrap"><span class="mono min-w-0 flex-1 truncate sm:w-48 sm:flex-none">{s.name}</span><span class="mono hidden text-muted sm:inline">••••••••</span><span class="hidden flex-1 truncate text-[12px] text-muted md:inline">{s.allowedTools.length ? `tools: ${s.allowedTools.join(", ")}` : "no tool may read it"}</span><span class="text-[12px] text-muted">{s.lastUsedAt ? `used ${time(s.lastUsedAt)}` : "never used"}</span>
            <form method="POST" action="?/deleteSecret" use:enhance={submit(true)} onsubmit={(e) => !confirm(`Delete the secret ${s.name}?`) && e.preventDefault()}><input type="hidden" name="name" value={s.name} /><button class="btn btn-danger">Delete</button></form></div>
        {:else}<p class="p-3 text-muted">No secrets.</p>{/each}
      </div>
      <p class="mt-2 text-[12px] text-muted">Agents only ever see names, never values.</p>
    </Collapsible>

    <Collapsible id="variables" title="Variables" summary="global, for every project's scripts" bind:open={openState.variables}>
      <Variables rows={data.variables} />
      <p class="mt-2 text-[12px] text-muted">A project's own variable of the same name wins.</p>
    </Collapsible>

    <Collapsible id="tokens" title="API tokens" summary="for harnesses, the CLI and MCP" bind:open={openState.tokens}>
      {#snippet actions()}<button class="btn" onclick={() => (dialog = "token")}><Plus size={13} /> Create token</button>{/snippet}
      {#if form?.token}
        <div class="mb-3 rounded-md border border-ok/40 bg-ok/5 p-3 text-[12px]">
          <p class="text-ok">Token <span class="mono">{form.tokenName}</span> created. Copy it now: it won't be shown again.</p>
          <div class="mt-1 flex items-start gap-2"><p class="mono min-w-0 flex-1 select-all break-all text-fg">{form.token}</p><button class="btn btn-ghost px-1" onclick={() => copy(form!.token!)} aria-label="Copy token"><Copy size={13} /></button></div>
          <p class="mt-2 text-muted">MCP: <span class="mono select-all break-all">claude mcp add --transport http miniasys {data.publicUrl}/mcp --header "Authorization: Bearer {form.token}"</span></p>
          <p class="text-muted">CLI: <span class="mono select-all break-all">miniasys login --url {data.publicUrl} --token {form.token}</span></p>
        </div>
      {/if}
      <div class="rounded-md border border-line">
        {#each data.tokens as t}
          <div class="row flex-wrap" class:opacity-50={!!t.revokedAt}><span class="mono min-w-0 flex-1 truncate sm:w-48 sm:flex-none">{t.name}</span><span class="mono text-muted">{t.prefix}…</span>
            <span class="hidden flex-1 text-[12px] text-muted md:inline">{t.access}{t.agent ? ` · acts as a/${t.agent}` : ""}</span>
            <span class="text-[12px] text-muted">{t.revokedAt ? `revoked ${time(t.revokedAt)}` : t.lastUsedAt ? `used ${time(t.lastUsedAt)}` : "never used"}</span>
            {#if !t.revokedAt}<form method="POST" action="?/revokeToken" use:enhance={submit(true)} onsubmit={(e) => !confirm(`Revoke ${t.name}?`) && e.preventDefault()}><input type="hidden" name="name" value={t.name} /><button class="btn btn-danger">Revoke</button></form>{/if}</div>
        {:else}<p class="p-3 text-muted">No tokens yet. Create one here, or run <span class="mono">miniasys login</span>.</p>{/each}
      </div>
    </Collapsible>

    <!-- ================================================================ platform -->
    <Collapsible id="sandbox" title="Sandbox" summary="container limits for agent and script runs" bind:open={openState.sandbox}>
      <form method="POST" action="?/sandbox" use:enhance={submit(true)} class="grid gap-3 sm:grid-cols-2">
        <div><label class="label flex items-center gap-1" for="cpus">CPUs per container <InfoTip text="Up to 2 per container." /></label><input id="cpus" name="cpus" type="number" step="0.25" class="input" value={data.sandbox.cpus} /></div>
        <div><label class="label flex items-center gap-1" for="mem">Memory (MB) <InfoTip text="Up to 2048 MB per container." /></label><input id="mem" name="memMb" type="number" class="input" value={data.sandbox.memMb} /></div>
        <div><label class="label" for="mc">Max concurrent sandboxes</label><input id="mc" name="maxConcurrent" type="number" class="input" value={data.sandbox.maxConcurrent} /></div>
        <div><label class="label" for="to">Timeout (s)</label><input id="to" name="timeoutS" type="number" class="input" value={data.sandbox.timeoutS} /></div>
        <div class="sm:col-span-2"><label class="label flex items-center gap-1" for="al">Network allowlist <InfoTip text="Domains reachable from sandboxes that are allowed network access, one per line." /></label><textarea id="al" name="allowlist" class="input mono" rows="3">{data.sandbox.networkAllowlist.join("\n")}</textarea></div>
        <div class="flex flex-wrap items-center gap-3 sm:col-span-2"><button class="btn btn-primary">Save sandbox</button><span class="text-[12px] text-muted">Image <span class="mono break-all">{data.providers.sandboxImage}</span> · rebuild with <span class="mono">scripts/build-sandbox.sh</span></span></div>
      </form>
    </Collapsible>

    <Collapsible id="schedules" title="Schedules" summary="run by the worker" bind:open={openState.schedules}>
      <div class="rounded-md border border-line">
        {#each data.schedules as s}<div class="row flex-wrap"><span class="mono min-w-0 flex-1 truncate">{s.name}</span><span class="mono text-fg-2">{s.cron}</span><span class="text-muted">{s.timezone ?? "UTC"}</span></div>{:else}<p class="p-3 text-muted">Start the worker to register the schedules.</p>{/each}
      </div>
      <p class="mt-2 text-[12px] text-muted">Runs missed while the machine slept happen at the next wake.</p>
    </Collapsible>

    <Collapsible id="appearance" title="Appearance" summary="theme for this browser" bind:open={openState.appearance}>
      <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
        {#each THEMES as t}
          <button data-theme={t.id} disabled={!t.enabled} title={t.enabled ? undefined : "Coming later"} class="theme-swatch relative overflow-hidden rounded-lg border-2 text-left disabled:cursor-not-allowed disabled:opacity-40 disabled:grayscale {theme === t.id ? 'border-[var(--accent)]' : 'border-transparent'}" style="background: var(--surface-0); color: var(--text-primary)" onclick={() => { theme = t.id; setTheme(t.id); }} aria-pressed={theme === t.id}>
            <div class="flex h-16 gap-1.5 p-2">
              <div class="w-1/4 rounded" style="background: var(--surface-1)"></div>
              <div class="flex flex-1 flex-col gap-1 rounded p-1.5" style="background: var(--surface-1)">
                <div class="h-1.5 w-2/3 rounded" style="background: var(--text-secondary)"></div>
                <div class="h-1.5 w-1/2 rounded" style="background: var(--text-muted)"></div>
                <div class="mt-auto h-2.5 w-8 rounded" style="background: var(--accent)"></div>
              </div>
            </div>
            <div class="flex items-center gap-1.5 px-2 pb-2 text-[12px]" style="font-family: var(--font-ui)">{#if t.id === "orbitalia"}<Logo size={14} />{/if}{t.label}{#if theme === t.id}<Check size={12} class="ml-auto" />{:else if !t.enabled}<span class="ml-auto text-[10px] opacity-80">later</span>{/if}</div>
          </button>
        {/each}
      </div>
    </Collapsible>
  </div>
</div>

{#if toast}
  <div class="fixed right-3 bottom-3 left-3 z-[80] sm:left-auto sm:w-96" role="status">
    <div class="panel flex items-start gap-2 border-l-4 px-3 py-2 text-[12.5px] shadow-2xl {toast.ok ? 'border-l-ok' : 'border-l-bad'}">
      <span class="flex-1 {toast.ok ? 'text-fg' : 'text-bad'}">{toast.text}</span>
      <button class="text-muted hover:text-fg" onclick={() => (toast = null)} aria-label="Dismiss">✕</button>
    </div>
  </div>
{/if}

<!-- ================================================================ windows -->
<Modal open={dialog === "add-ai"} onclose={() => (dialog = null)} title="Add an AI" subtitle="Pick where the model runs; you'll set it up in the next step." width="680px">
  {#snippet icon()}<span class="grid h-9 w-9 place-items-center rounded-lg bg-accent/15 text-accent"><Sparkles size={18} /></span>{/snippet}
  <ol class="mb-4 flex items-center gap-2 text-[11.5px] text-muted">
    <li class="flex items-center gap-1.5 text-fg"><span class="grid h-5 w-5 place-items-center rounded-full bg-accent text-[10px] text-accent-fg">1</span>Choose a provider</li>
    <li class="h-px w-6 bg-line"></li>
    <li class="flex items-center gap-1.5"><span class="grid h-5 w-5 place-items-center rounded-full bg-surface-3 text-[10px]">2</span>Connect</li>
    <li class="h-px w-6 bg-line"></li>
    <li class="flex items-center gap-1.5"><span class="grid h-5 w-5 place-items-center rounded-full bg-surface-3 text-[10px]">3</span>Assign to roles</li>
  </ol>
  <div class="grid gap-2.5 sm:grid-cols-2">
    {#each providers as p}
      {@const Icon = p.icon}
      <button class="flex items-start gap-3 rounded-lg border p-3 text-left transition {wizardPick === p.id ? 'border-accent bg-accent/10' : 'border-line hover:border-accent/50 hover:bg-surface-2'}" onclick={() => (wizardPick = p.id)}>
        <span class="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-accent/15 text-accent"><Icon size={17} /></span>
        <span class="min-w-0">
          <span class="flex items-center gap-1.5 font-medium">{p.name}{#if p.ok}<span class="rounded bg-ok/15 px-1 text-[10px] text-ok">connected</span>{/if}</span>
          <span class="mt-0.5 block text-[12px] text-muted">{p.desc}</span>
        </span>
      </button>
    {/each}
  </div>
  {#snippet footer()}
    <button class="btn" onclick={() => (dialog = null)}>Cancel</button>
    <button class="btn btn-primary" disabled={!wizardPick} onclick={() => (dialog = wizardPick as Dialog)}>Continue <ChevronRight size={13} /></button>
  {/snippet}
</Modal>

<Modal open={dialog === "anthropic"} onclose={() => (dialog = null)} title="Anthropic API" subtitle="Claude models billed per token" width="560px">
  {#snippet icon()}<span class="grid h-9 w-9 place-items-center rounded-lg bg-accent/15 text-accent"><Cloud size={18} /></span>{/snippet}
  <div class="space-y-3 text-[12.5px]">
    <div class="flex items-center gap-2"><StatusBadge status={data.providers.anthropic ? "ok" : "error"} compact />{data.providers.anthropic ? "The API key is loaded." : "No API key yet."}</div>
    <ol class="list-decimal space-y-1.5 pl-5 text-fg-2">
      <li>Create a key in the Anthropic Console and set a monthly spend limit there.</li>
      <li>Save it to a file on this machine, e.g. <span class="mono">~/.config/miniasys/secrets/anthropic_api_key</span>.</li>
      <li>Point <span class="mono">ANTHROPIC_API_KEY_FILE</span> at it in <span class="mono">.env</span> and restart web and worker.</li>
    </ol>
    <ReadMore>The key never goes in the database: it's read from the file at start, so a leaked backup doesn't leak it. Any role whose model starts with <span class="mono">claude-</span> and whose engine is "API credits" uses it.</ReadMore>
  </div>
  {#snippet footer()}<button class="btn" onclick={() => { dialog = null; void go("models"); }}>Assign to roles</button><button class="btn btn-primary" onclick={() => (dialog = null)}>Done</button>{/snippet}
</Modal>

<Modal open={dialog === "subscription"} onclose={() => (dialog = null)} title="Claude subscription" subtitle="Use your Pro/Max plan instead of API credits" width="600px">
  {#snippet icon()}<span class="grid h-9 w-9 place-items-center rounded-lg bg-accent/15 text-accent"><Sparkles size={18} /></span>{/snippet}
  <div class="space-y-3 text-[12.5px]">
    <div class="flex items-center gap-2">
      <StatusBadge status={data.subscription ? "ok" : "canceled"} compact />
      {#if data.subscription}Connected{data.subscription.lastUsedAt ? ` · last used ${time(data.subscription.lastUsedAt)}` : " · not used yet"}{:else}Not connected{/if}
      {#if data.subscription}<form method="POST" action="?/claudeDisconnect" use:enhance={submit(true)} class="ml-auto" onsubmit={(e) => !confirm("Disconnect? Every role goes back to the API.") && e.preventDefault()}><button class="btn btn-danger">Disconnect</button></form>{/if}
    </div>
    <ol class="list-decimal space-y-1.5 pl-5 text-fg-2">
      <li>In a terminal on this machine, run <span class="mono text-fg">claude setup-token</span> and log in with your Claude account.</li>
      <li>Paste the token it prints (it starts with <span class="mono">sk-ant-</span>). It's stored encrypted and never shown again.</li>
      <li>Pick which roles use it under <button type="button" class="text-accent" onclick={() => { dialog = null; void go("engines"); }}>Engines</button>.</li>
    </ol>
    <form method="POST" action="?/claudeToken" use:enhance={submit(true)} class="flex flex-col gap-2 sm:flex-row">
      <input name="token" type="password" class="input mono h-8" placeholder="sk-ant-…" autocomplete="off" aria-label="Claude subscription token" required />
      <button class="btn btn-primary h-8 justify-center whitespace-nowrap">{data.subscription ? "Replace token" : "Connect"}</button>
    </form>
    <ReadMore>Roles on the subscription run the real Claude Code inside the sandbox container, signed in with this token; Orbitalia Moon never calls the API with it. That container needs network access to reach Anthropic, and the token is visible to processes in it. Mid-run tool approvals and questions aren't available on this engine. Usage counts against your plan's limits; count budgets in tokens to cap it.</ReadMore>
  </div>
  {#snippet footer()}<button class="btn btn-primary" onclick={() => (dialog = null)}>Done</button>{/snippet}
</Modal>

<Modal open={dialog === "azure"} onclose={() => (dialog = null)} title="Azure Foundry" subtitle="OpenAI-compatible deployments on Azure" width="620px">
  {#snippet icon()}<span class="grid h-9 w-9 place-items-center rounded-lg bg-accent/15 text-accent"><Server size={18} /></span>{/snippet}
  <div class="space-y-4 text-[12.5px]">
    <section>
      <div class="mb-1.5 flex items-center gap-2 font-medium"><span class="grid h-5 w-5 place-items-center rounded-full {data.providers.azure.apiKeyLoaded ? 'bg-ok text-surface-0' : 'bg-surface-3'} text-[10px]">{#if data.providers.azure.apiKeyLoaded}<Check size={11} />{:else}1{/if}</span>API key</div>
      {#if data.providers.azure.apiKeyLoaded}<p class="pl-7 text-muted">Loaded. Paste a new one to replace it.</p>{/if}
      <form method="POST" action="?/secret" use:enhance={submit(true)} class="mt-1 flex flex-col gap-2 pl-7 sm:flex-row">
        <input type="hidden" name="name" value="AZURE_OPENAI_API_KEY" /><input type="hidden" name="tools" value="" />
        <input name="value" type="password" class="input h-8" placeholder="Azure API key" autocomplete="off" aria-label="Azure API key" required disabled={!data.providers.masterKey} />
        <button class="btn h-8 justify-center whitespace-nowrap" disabled={!data.providers.masterKey}>Save key</button>
      </form>
      {#if !data.providers.masterKey}<p class="mt-1 pl-7 text-[12px] text-warn">Set MASTER_KEY_FILE first (or AZURE_OPENAI_API_KEY_FILE in .env).</p>{/if}
    </section>
    <section>
      <div class="mb-1.5 flex items-center gap-2 font-medium"><span class="grid h-5 w-5 place-items-center rounded-full {data.providers.azure.deployment ? 'bg-ok text-surface-0' : 'bg-surface-3'} text-[10px]">{#if data.providers.azure.deployment}<Check size={11} />{:else}2{/if}</span>Endpoint and deployment</div>
      <form method="POST" action="?/azure" use:enhance={submit(true)} class="grid gap-3 pl-7 sm:grid-cols-2">
        <div class="sm:col-span-2"><label class="label" for="az-endpoint">Endpoint</label><input id="az-endpoint" name="endpoint" class="input mono" value={data.providers.azure.endpoint} /></div>
        <div><label class="label flex items-center gap-1" for="az-deployment">Deployment <InfoTip text="The deployment name serving the model; roles then use azure:<deployment>." /></label><input id="az-deployment" name="deployment" class="input mono" placeholder="gpt-5.1" value={data.providers.azure.deployment} /></div>
        <div><label class="label" for="az-api-version">API version</label><input id="az-api-version" name="apiVersion" class="input mono" placeholder="2025-04-01-preview" value={data.providers.azure.apiVersion ?? ""} /></div>
        <div class="sm:col-span-2"><button class="btn btn-primary">Save connection</button></div>
      </form>
    </section>
    <section class="pl-7 text-muted">
      <div class="mb-1 flex items-center gap-2 font-medium text-fg"><span class="-ml-7 grid h-5 w-5 place-items-center rounded-full bg-surface-3 text-[10px]">3</span>Use it</div>
      Set a role's model to <span class="mono text-fg">azure:{data.providers.azure.deployment || "<deployment>"}</span> in <button type="button" class="text-accent" onclick={() => { dialog = null; void go("models"); }}>Models per role</button>, and add its price under <button type="button" class="text-accent" onclick={() => (dialog = "price")}>Prices</button> (provider <span class="mono">azure</span>).
    </section>
  </div>
  {#snippet footer()}<button class="btn btn-primary" onclick={() => (dialog = null)}>Done</button>{/snippet}
</Modal>

<Modal open={dialog === "local"} onclose={() => (dialog = null)} title="Local models" subtitle="Runs on this machine, costs $0" width="560px">
  {#snippet icon()}<span class="grid h-9 w-9 place-items-center rounded-lg bg-accent/15 text-accent"><HardDrive size={18} /></span>{/snippet}
  <dl class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-[12.5px]">
    <dt class="text-muted">Colibri</dt><dd class="mono break-all">{data.providers.colibri}</dd>
    <dt class="text-muted">Ollama</dt><dd class="mono break-all">{data.providers.ollama}</dd>
    <dt class="text-muted">Embeddings</dt><dd class="mono">{data.providers.embedding}</dd>
  </dl>
  <ReadMore class="mt-3">Colibri answers System One decisions (routing, triage, risk) locally when a Colibri decision model is set in Models per role; Ollama embeds project knowledge and can also serve a decision model. URLs come from COLIBRI_URL and OLLAMA_URL in .env. Health is on the System page.</ReadMore>
  {#snippet footer()}<a class="btn" href="/system">Open System</a><button class="btn btn-primary" onclick={() => { dialog = null; void go("models"); }}>Assign to roles</button>{/snippet}
</Modal>

<Modal open={dialog === "price"} onclose={() => (dialog = null)} title="Add a price" subtitle="USD per million tokens, from the provider's pricing page" width="560px">
  <form id="price-form" method="POST" action="?/price" use:enhance={submit()} class="grid grid-cols-2 gap-3">
    <div><label class="label" for="pp">Provider</label><select id="pp" name="provider" class="input"><option>anthropic</option><option>azure</option><option>colibri</option></select></div>
    <div><label class="label" for="pm">Model</label><input id="pm" name="model" class="input mono" placeholder="claude-… or the deployment" required /></div>
    <div><label class="label" for="pi">Input</label><input id="pi" name="input" type="number" step="0.0001" min="0" class="input num" required /></div>
    <div><label class="label" for="po">Output</label><input id="po" name="output" type="number" step="0.0001" min="0" class="input num" required /></div>
    <div><label class="label" for="pcw">Cache write</label><input id="pcw" name="cacheWrite" type="number" step="0.0001" min="0" class="input num" placeholder="0" /></div>
    <div><label class="label" for="pcr">Cache read</label><input id="pcr" name="cacheRead" type="number" step="0.0001" min="0" class="input num" placeholder="0" /></div>
    <div class="col-span-2"><label class="label" for="pf">Effective from</label><input id="pf" name="effectiveFrom" type="date" class="input" /><p class="mt-1 text-[11.5px] text-muted">Empty: today.</p></div>
  </form>
  {#snippet footer()}<button class="btn" onclick={() => (dialog = null)}>Cancel</button><button class="btn btn-primary" form="price-form">Add price</button>{/snippet}
</Modal>

<Modal open={dialog === "secret"} onclose={() => (dialog = null)} title="Add a secret" subtitle="Encrypted with the master key; the value can't be read back" width="520px">
  <form id="secret-form" method="POST" action="?/secret" use:enhance={submit()} class="space-y-3">
    <div><label class="label" for="sn">Name</label><input id="sn" name="name" class="input mono" placeholder="NTFY_TOKEN" required /></div>
    <div><label class="label" for="sv">Value</label><input id="sv" name="value" type="password" class="input" autocomplete="off" required /></div>
    <div><label class="label flex items-center gap-1" for="st">Allowed tools <InfoTip text="Comma-separated tool names that may read this secret. Empty: no tool may read it (platform use only)." /></label><input id="st" name="tools" class="input mono" placeholder="http_get, …" /></div>
  </form>
  {#snippet footer()}<button class="btn" onclick={() => (dialog = null)}>Cancel</button><button class="btn btn-primary" form="secret-form">Save secret</button>{/snippet}
</Modal>

<Modal open={dialog === "token"} onclose={() => (dialog = null)} title="Create an API token" subtitle="For a harness (Claude Code, scripts), the CLI or the MCP server" width="520px">
  <form id="token-form" method="POST" action="?/createToken" use:enhance={submit()} class="space-y-3">
    <div><label class="label" for="tn">Name</label><input id="tn" name="name" class="input mono" placeholder="claude-code-laptop" required /></div>
    <div class="grid gap-3 sm:grid-cols-2">
      <div><label class="label flex items-center gap-1" for="ta">Access <InfoTip text="read: look only. write: run the platform (cards, chats, files). admin: also settings and tokens." /></label><select id="ta" name="access" class="input"><option value="write">write</option><option value="read">read</option><option value="admin">admin</option></select></div>
      <div><label class="label flex items-center gap-1" for="tg">Acts as <InfoTip text="Bound to an agent, everything the token does is logged as that agent." /></label><select id="tg" name="agent" class="input"><option value="">you</option>{#each data.agentSlugs as a}<option value={a}>a/{a}</option>{/each}</select></div>
    </div>
  </form>
  {#snippet footer()}<button class="btn" onclick={() => (dialog = null)}>Cancel</button><button class="btn btn-primary" form="token-form">Create token</button>{/snippet}
</Modal>

<SkillImport bind:open={importOpen} agents={data.soloChoices} {importId} currentSha={importSha} />

<Modal open={!!viewing} onclose={() => (viewing = null)} title={viewing ? `Skill ${viewing.name}` : ""} subtitle={viewing ? `${viewing.files.length} files` : ""} width="760px">
  {#if viewing}
    <div class="max-h-[60vh] overflow-auto rounded-md border border-line bg-surface-0 p-3"><Markdown text={viewing.text} /></div>
    <div class="label mt-3">Files</div>
    <ul class="grid gap-x-4 text-[12px] sm:grid-cols-2">{#each viewing.files as f}<li class="flex gap-2"><span class="mono min-w-0 truncate">{f.path}</span><span class="ml-auto text-muted">{(f.size / 1024).toFixed(1)} KB</span></li>{/each}</ul>
  {/if}
</Modal>
