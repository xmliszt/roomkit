# S5 — Usage endpoints

Read `docs/work-packages/README.md` first. Spec: `docs/PLAN.md` sections 2 ("Copy from Studio": `check-coding-agents.ts`, `read-coding-agent-usage.ts`, `read-usage-limit.ts`), 6 and 7 row S5.

## Question

Do the unofficial plan-usage endpoints that Studio reads still answer for the installed `claude` (2.1.330) and `codex` (0.165)?

## Steps

1. Read Studio's `packages/daemon/src/agent/check-coding-agents.ts`, `read-coding-agent-usage.ts` and `read-usage-limit.ts` in `/path/to/studio/`.
2. Write a standalone Node script that does the same detection and usage reads for both CLIs and prints: path, version, sign-in state, plan, each usage window with percentage and reset time.
3. Read-only. Never print tokens or credentials, and never write to the CLIs' config. Do not run a real agent turn.

## Paths

`scripts/spikes/s5-usage-endpoints.ts` and `docs/spikes/s5-usage-endpoints.md` only. Another agent is building the root workspace; do not add root `package.json` dependencies. Use only Node built-ins.

## Gate

`node scripts/spikes/s5-usage-endpoints.ts` exits 0 and prints the fields above for both CLIs, or a clear per-CLI "unavailable" with the reason.

## Report (`docs/spikes/s5-usage-endpoints.md`)

What answered, what did not, what changed since Studio's code, and what M2 should copy as is versus change.
