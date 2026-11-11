# Agent evals (scope §21)

Golden tasks run against an agent version before it is deployed and whenever its
prompt changes. Each task is a folder in `tasks/`:

```text
tasks/<name>/
  task.json      { "agent": "dev", "title": "...", "brief": "...", "acceptance_criteria": [...], "budget_usd": 0.5 }
  repo/          the starting workspace (copied fresh for each run)
  check.sh       exits 0 when the result is correct; runs in the sandbox
```

Measured per version: pass rate, turns, cost, review loops. The runner is not
built yet (Phase 2); the first task below shows the format.
