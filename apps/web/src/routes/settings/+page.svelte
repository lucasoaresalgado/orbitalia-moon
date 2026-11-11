<script lang="ts">
  import StatusBadge from "#lib/components/StatusBadge.svelte";
  import BudgetUnitSwitch from "#lib/components/BudgetUnitSwitch.svelte";
  import { time } from "#lib/format.ts";
  let { data, form } = $props();
  const sections = ["models", "subscription", "prices", "budgets", "connections", "secrets", "sandbox", "schedules"];
  const engineRoles: [keyof typeof data.engines, string][] = [["manager", "Manager (Iacy)"], ["worker", "Workers"], ["reviewer", "Reviewer"], ["brief_writer", "Brief writer"]];
  const tokenFmt = (n: number | null | undefined) => (n == null ? "" : String(n));
  const roles: [keyof typeof data.models, string][] = [
    ["manager", "Manager (Iacy)"], ["brief_writer", "Brief writer"], ["worker_default", "Worker (cheap tier)"], ["worker_strong", "Worker (strong tier)"],
    ["reviewer", "Reviewer"], ["security", "Security"], ["decisions_fallback", "Decisions fallback"], ["colibri_decision_model", "Colibri decision model (empty: Haiku only)"],
  ];
  const budgetLabels: Record<string, string> = { global_month: "Global per month", global_day: "Global per day", card: "Per card", meeting: "Per meeting", agent_day: "Per agent per day" };
</script>

<svelte:head><title>Settings · Miniasys</title></svelte:head>
<div class="flex">
  <nav class="sticky top-0 h-fit w-44 shrink-0 p-4" aria-label="Settings sections">
    {#each sections as s}<a href="#{s}" class="block rounded px-2 py-1 text-fg-2 capitalize hover:bg-surface-2 hover:text-fg">{s}</a>{/each}
  </nav>
  <div class="max-w-3xl flex-1 space-y-8 p-6">
    <div class="panel p-3">
      <BudgetUnitSwitch unit={data.budgetUnit} />
      <p class="mt-1.5 text-[12px] text-muted">Both are always recorded; this decides which one blocks a run. Limits for each are under <a class="text-accent" href="#budgets">Budgets</a>.</p>
    </div>
    {#if form?.error}<p class="border-l-2 border-bad pl-2 text-bad">{form.error}</p>{/if}
    {#if form?.ok}<p class="border-l-2 border-ok pl-2 text-ok">Saved {form.ok}.</p>{/if}

    <section id="models">
      <h2 class="mb-2 text-[14px] font-semibold">Models</h2>
      <div class="panel mb-3 p-3 text-[12.5px]">
        <div class="flex items-center gap-2"><StatusBadge status={data.providers.anthropic ? "ok" : "error"} compact /> Anthropic API key {data.providers.anthropic ? "loaded" : "missing (ANTHROPIC_API_KEY_FILE)"}</div>
        <div class="mt-1 flex items-center gap-2 text-fg-2">Colibri <span class="mono text-muted">{data.providers.colibri}</span> · Ollama <span class="mono text-muted">{data.providers.ollama}</span> embeddings <span class="mono">{data.providers.embedding}</span> · health on <a class="text-accent" href="/system">System</a></div>
        <p class="mt-1 text-muted">Set a monthly spend limit in the Anthropic Console too: it holds even if this platform's enforcement fails.</p>
      </div>
      <form method="POST" action="?/models" class="panel space-y-2 p-3">
        {#each roles as [key, label]}
          <div class="flex items-center gap-3"><label class="w-64 text-fg-2" for="m-{key}">{label}</label><input id="m-{key}" name={key} class="input mono" value={data.models[key] ?? ""} /></div>
        {/each}
        <button class="btn btn-primary">Save models</button>
      </form>
    </section>

    <section id="subscription">
      <h2 class="mb-2 text-[14px] font-semibold">Claude subscription <span class="text-[12px] font-normal text-muted">use your Pro/Max plan instead of API credits</span></h2>
      <div class="panel space-y-3 p-3 text-[12.5px]">
        <div class="flex items-center gap-2">
          <StatusBadge status={data.subscription ? "ok" : "canceled"} compact />
          {#if data.subscription}Connected{data.subscription.lastUsedAt ? ` · last used ${time(data.subscription.lastUsedAt)}` : " · not used yet"}{:else}Not connected{/if}
          {#if data.subscription}<form method="POST" action="?/claudeDisconnect" class="ml-auto"><button class="btn btn-danger">Disconnect</button></form>{/if}
        </div>
        <ol class="list-decimal space-y-1 pl-5 text-fg-2">
          <li>In a terminal on this machine, run <span class="mono text-fg">claude setup-token</span> and log in with your Claude account in the browser it opens.</li>
          <li>Paste the token it prints (it starts with <span class="mono">sk-ant-</span>). It's stored encrypted and never shown again.</li>
          <li>Pick which roles use it below.</li>
        </ol>
        <form method="POST" action="?/claudeToken" class="flex gap-2">
          <input name="token" type="password" class="input mono" placeholder="sk-ant-…" autocomplete="off" aria-label="Claude subscription token" />
          <button class="btn btn-primary whitespace-nowrap">{data.subscription ? "Replace token" : "Connect"}</button>
        </form>
        <p class="text-[12px] text-muted">How it works: roles on the subscription run the real Claude Code inside the sandbox container, signed in with this token; Miniasys never calls the API with it. That container needs network access to reach Anthropic, and the token is visible to processes in it. Mid-run tool approvals and questions aren't available on this engine (Claude Code acts on its own inside the sandbox). Usage counts against your plan's limits; count budgets in tokens to cap it.</p>
      </div>
      <form method="POST" action="?/engines" class="panel mt-3 space-y-2 p-3">
        <div class="label">Engine per role</div>
        {#each engineRoles as [key, label]}
          <div class="flex items-center gap-3">
            <span class="w-40 text-fg-2">{label}</span>
            {#each [["api", "API credits"], ["claude_code", "Claude subscription"]] as [v, l]}
              <label class="flex items-center gap-1.5"><input type="radio" name={key} value={v} checked={data.engines[key] === v} disabled={v === "claude_code" && !data.subscription} /> {l}</label>
            {/each}
          </div>
        {/each}
        <p class="text-[12px] text-muted">Routing decisions and context compaction stay on the API (Haiku costs cents there) or on Colibri once it runs.</p>
        <button class="btn btn-primary">Save engines</button>
      </form>
    </section>

    <section id="prices">
      <h2 class="mb-2 text-[14px] font-semibold">Prices <span class="text-[12px] font-normal text-muted">USD per million tokens, from Anthropic's pricing page; a call uses the row effective that day</span></h2>
      <div class="panel">
        <table class="num w-full text-[12px]">
          <thead class="text-left text-muted"><tr><th class="px-3 py-1">Provider / model</th><th class="text-right">Input</th><th class="text-right">Output</th><th class="text-right">Cache write</th><th class="text-right">Cache read</th><th class="px-3 text-right">From</th></tr></thead>
          <tbody>{#each data.prices as p}<tr class="border-t border-line"><td class="mono px-3 py-1">{p.provider}/{p.model}</td><td class="text-right">{p.inputPerMtok}</td><td class="text-right">{p.outputPerMtok}</td><td class="text-right">{p.cacheWritePerMtok}</td><td class="text-right">{p.cacheReadPerMtok}</td><td class="px-3 text-right">{p.effectiveFrom}</td></tr>{/each}</tbody>
        </table>
      </div>
      <form method="POST" action="?/price" class="mt-2 grid grid-cols-7 gap-2">
        <input name="provider" class="input" value="anthropic" aria-label="Provider" /><input name="model" class="input mono col-span-2" placeholder="claude-…" aria-label="Model" />
        <input name="input" class="input" placeholder="in" aria-label="Input price" /><input name="output" class="input" placeholder="out" aria-label="Output price" />
        <input name="cacheWrite" class="input" placeholder="cache w" aria-label="Cache write price" /><input name="cacheRead" class="input" placeholder="cache r" aria-label="Cache read price" />
        <input name="effectiveFrom" type="date" class="input col-span-2" aria-label="Effective from" /><button class="btn">Add price</button>
      </form>
    </section>

    <section id="budgets">
      <h2 class="mb-2 text-[14px] font-semibold">Budgets <span class="text-[12px] font-normal text-muted">defaults; alerts at 50% (inbox), 80% (phone), 100% (block + phone)</span></h2>
      <form method="POST" action="?/budgets" class="panel space-y-3 p-3">
        <div class="grid grid-cols-[16rem_9rem_10rem] items-center gap-x-3 gap-y-2">
          <span></span><span class="label mb-0">Dollars</span><span class="label mb-0">Tokens</span>
          {#each data.budgets as b}
            <label class="text-fg-2" for="b-{b.scope}">{budgetLabels[b.scope] ?? b.scope}</label>
            <input id="b-{b.scope}" name={b.scope} type="number" step="0.01" min="0" class="input" value={b.limitUsd} aria-label="{b.scope} dollars" />
            <input name="{b.scope}_tokens" type="number" step="1000" min="0" class="input num" value={tokenFmt(b.limitTokens)} aria-label="{b.scope} tokens" />
          {/each}
        </div>
        <p class="text-[12px] text-muted">Project budgets are set in each project's settings.</p>
        <button class="btn btn-primary">Save budgets</button>
      </form>
    </section>

    <section id="connections">
      <h2 class="mb-2 text-[14px] font-semibold">Connections</h2>
      <div class="panel divide-y divide-line">
        <div class="flex items-center gap-2 p-3"><StatusBadge status={data.providers.github?.key ? "ok" : "error"} compact /><span class="font-medium">GitHub App</span>
          <span class="text-[12px] text-muted">{data.providers.github ? `app ${data.providers.github.appId} · installation ${data.providers.github.installationId ?? "?"}${data.providers.github.key ? "" : " · private key missing"}` : "not configured (GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY_FILE, GITHUB_INSTALLATION_ID)"}</span></div>
        <div class="flex items-center gap-2 p-3"><StatusBadge status={data.providers.ntfy ? "ok" : "error"} compact /><span class="font-medium">ntfy</span><span class="text-[12px] text-muted">{data.providers.ntfy ? `${data.providers.ntfy.url} · topic ${data.providers.ntfy.topic}` : "not configured (NTFY_TOPIC): phone alerts are off, the inbox still works"}</span></div>
        <div class="flex items-center gap-2 p-3 text-muted"><StatusBadge status="canceled" compact /><span class="font-medium">Windmill</span><span class="text-[12px]">Phase 4: security design pending (dedicated token, one folder, draft-only, deploy by approval)</span></div>
      </div>
    </section>

    <section id="secrets">
      <h2 class="mb-2 text-[14px] font-semibold">Secrets <span class="text-[12px] font-normal text-muted">encrypted with the master key; values are write-only; agents only ever see names</span></h2>
      {#if !data.providers.masterKey}<p class="mb-2 border-l-2 border-warn pl-2 text-[12px] text-warn">MASTER_KEY_FILE is not set: secrets can't be stored yet.</p>{/if}
      <div class="panel">
        {#each data.secrets as s}
          <div class="row"><span class="mono w-48">{s.name}</span><span class="mono text-muted">••••••••</span><span class="flex-1 text-[12px] text-muted">{s.allowedTools.length ? `tools: ${s.allowedTools.join(", ")}` : "no tool may read it"}</span><span class="text-[12px] text-muted">{s.lastUsedAt ? `used ${time(s.lastUsedAt)}` : "never used"}</span>
            <form method="POST" action="?/deleteSecret"><input type="hidden" name="name" value={s.name} /><button class="btn btn-danger">Delete</button></form></div>
        {:else}<p class="p-3 text-muted">No secrets.</p>{/each}
      </div>
      <form method="POST" action="?/secret" class="mt-2 grid grid-cols-4 gap-2">
        <input name="name" class="input mono" placeholder="NTFY_TOKEN" aria-label="Name" /><input name="value" type="password" class="input" placeholder="value" autocomplete="off" aria-label="Value" />
        <input name="tools" class="input mono" placeholder="allowed tools, comma-separated" aria-label="Allowed tools" /><button class="btn">Set secret</button>
      </form>
    </section>

    <section id="sandbox">
      <h2 class="mb-2 text-[14px] font-semibold">Sandbox <span class="text-[12px] font-normal text-muted">image <span class="mono">{data.providers.sandboxImage}</span> · rebuild with scripts/build-sandbox.sh</span></h2>
      <form method="POST" action="?/sandbox" class="panel grid grid-cols-2 gap-3 p-3">
        <div><label class="label" for="cpus">CPUs per container (max 2)</label><input id="cpus" name="cpus" type="number" step="0.25" class="input" value={data.sandbox.cpus} /></div>
        <div><label class="label" for="mem">Memory MB (max 2048)</label><input id="mem" name="memMb" type="number" class="input" value={data.sandbox.memMb} /></div>
        <div><label class="label" for="mc">Max concurrent sandboxes</label><input id="mc" name="maxConcurrent" type="number" class="input" value={data.sandbox.maxConcurrent} /></div>
        <div><label class="label" for="to">Timeout (s)</label><input id="to" name="timeoutS" type="number" class="input" value={data.sandbox.timeoutS} /></div>
        <div class="col-span-2"><label class="label" for="al">Network allowlist (domains, one per line)</label><textarea id="al" name="allowlist" class="input mono" rows="3">{data.sandbox.networkAllowlist.join("\n")}</textarea></div>
        <button class="btn btn-primary w-fit">Save sandbox</button>
      </form>
    </section>

    <section id="schedules">
      <h2 class="mb-2 text-[14px] font-semibold">Schedules <span class="text-[12px] font-normal text-muted">run by the worker; missed runs happen at next wake</span></h2>
      <div class="panel">
        {#each data.schedules as s}<div class="row"><span class="mono flex-1">{s.name}</span><span class="mono text-fg-2">{s.cron}</span><span class="text-muted">{s.timezone ?? "UTC"}</span></div>{:else}<p class="p-3 text-muted">Start the worker to register the schedules.</p>{/each}
      </div>
    </section>
  </div>
</div>
