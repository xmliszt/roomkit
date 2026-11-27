# B6 — Reconstruction pipeline in the daemon (M4 steps 1–5)

Read `docs/work-packages/README.md` first. Spec: `docs/PLAN.md` sections 2 (python runner, state on disk), 3 (jobs, room rules, photo record from B5), 5.2 steps 1–5 and the fallback ladder, 8 (M4); `python/README.md` (the workers' JSON protocol and outputs, from C1 and C2); `docs/spikes/s1-room-geometry.md`.

## Scope (`packages/shared`, `packages/daemon`, `scripts/`, and in `apps/web` any file that switches on job kind or job stages, such as `get-job-title.ts` and `job-row.tsx`, so the new kind shows in the Jobs tab and job strip with its own stages; no other web changes)

1. **Python runner:** runs a worker from `python/workers/` with the env `uv` manages (`PLANNER_HOME/python/` once B3's install job has made it; the repo's `python/.venv` in development), JSON on stdin, progress lines and the final result on stdout, a timeout, process-group kill. One ML job at a time (PLAN 5).
2. **`reconstruction` job kind** (PLAN 3 says job kinds grow per milestone): stages intake → geometry → layout → coverage, with progress, written to `.planner/jobs.json` before it starts, resumed after a daemon restart. Started by a WS command on a project's `capture` photos only (B5 `origin`).
3. **Result into the scene:** the fitted `walls` and `ceilingHeightM` go in as one `room.update` command (so it is undoable and goes through the reducer), keeping wall ids stable across reruns (C2 keeps physical ids). Scale source and per-wall confidence go to `recon/`, not the scene (PLAN 5.2 step 5). A weak scale sets a project flag the web app reads to open the room panel.
4. **Scale input:** a WS command for a typed measurement or a known furniture size (photo id, box, real size), used by the reconstruction (PLAN 5.2 step 2).
5. **Capture requests:** coverage results become `capture-request` chat blocks (the `surveyor` writes the wording later; for now plain text naming the wall id and side).
6. **Fallback ladder:** if geometry fails, the job ends with a clear `notice` and the room stays as it was; the user can type the numbers.

Propose every new schema (job kind, commands, events, the project flag) in PLAN section 3 marked "proposed in B6, needs chief-engineer sign-off". You are a Codex agent: you cannot ask the advisor; the orchestrator takes the proposal to it before merge.

## Rules

Measured model runs go through `scripts/machine-lock.sh`. Tests use fake workers (a fake `python` that emits the protocol), never the real models. Playwright installs set `PLAYWRIGHT_SKIP_BROWSER_GC=1`. You are a Codex agent with no `advisor` tool: follow the README's Codex rule.

## Gate

1. `pnpm check` and all earlier gates pass.
2. `pnpm gate:b6` (fake workers, temp folders): upload four `capture` photos and one `chat` photo; start reconstruction; the fake worker receives only the four; stages and progress arrive over WS; the scene's room changes through one `room.update` and undo restores it; kill the daemon mid-job and restart, and the job resumes and finishes; a failing geometry stage leaves the room unchanged with a `notice`.
3. The automated reconstruction gate uses a fake worker. Run the real model benchmark only with local captures, box annotations, and dimensions.
