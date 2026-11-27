# F1 — Integration fixes after merging A11, A14 and A16

Read `docs/work-packages/README.md` first.

## Problem

A14 (mirror), A11 (surface rendering and controls) and A16 (shared chat previews) were each tested before the others merged. On `orchestrator` at 684de31, `pnpm test:e2e --workers=1` fails 10 capture-suite tests (all main-suite tests pass):

- `mirror-mask.gate.ts` (4 cases), `mirror.gate.ts` (floor and wall)
- `object-labels.gate.ts` (labels follow hover and selection)
- `snapping.gate.ts` "move with snap on/off, Alt held"
- `surfaces.gate.ts:290` (texture maps retain metric repeats … palette paints every wall)

The error excerpts are in `docs/work-packages/evidence/f1-e2e-failures.txt` (click timeouts, a predicate timeout, a screenshot timeout). Likely causes to check first: A11 changed what a click on the floor and a double-click do (surfaces are selected by double-click; a plain floor click clears the selection), hides the grid in some tests, added popovers, and changed the camera rig; A14's gates were written before that. The surfaces failure may come from the merged command-palette list (A11's "Paint all walls…" now follows A14's mirror actions).

## Scope

Fix the cause in app code when the merged behaviour is wrong; fix the test when the test assumes pre-merge behaviour, and say which in the commit body for each failing test. No feature changes. Use ports other than 3210 and 4820, and run browser tests with `--workers=1`; other agents share the machine. Set `PLAYWRIGHT_OUTPUT_DIR`-style output to a folder of your own if the config allows it, so another worktree's run does not overwrite your traces.

## Gate

`pnpm check`, all gates and the full `pnpm test:e2e --workers=1` pass on your branch, run twice in a row.

## Validation — 2026-11-23

Synced `orchestrator` through B17 (`16f3bc6`) and B18 (`50d3607`); both merges fast-forwarded and preserved the F1 changes.

Validation used native arm64 Node 24.22.1 and pnpm 10.34.9. The initial shell used x64 Node 26.7.0 under Rosetta; dependencies were reinstalled with the native runtime. All runs used temporary planner folders, free ports and one browser worker.

The reported mirror-mask, mirror, labels, snapping and surface cases passed without changes to those tests or application code. Three other tests exposed asynchronous setup assumptions: Blueprint completion and context-remount pixel checks now wait for the GLB response body; the usage-limit test uses the neighboring worker tests' 10-second process deadline. Existing behavior assertions remain.

| Command | First cycle | Second cycle |
| --- | --- | --- |
| `pnpm test:e2e --workers=1` | 52 main + 40 capture passed | 52 main + 40 capture passed |
| `pnpm check` | 85 files, 617 tests passed | 85 files, 617 tests passed |
| All Node gate scripts | 15 passed | 15 passed |

The gate set is every `package.json` gate script (`m0`, `b1`, `m2`, `b3`, `b4`, `b5`, `b6`, `b7`, `b10`, `b11`, `b15`, `b14`, `b18`, `b17`) plus `node scripts/gate-b12.ts`. These runtime, readiness and gate-set choices are the routine Codex calls; no contract question remains.

Cycles ran consecutively at 09:34:44–09:51:20 and 09:51:33–10:05:19 UTC. Per-command results, ports, logs and browser artifacts are under this worktree's `.tmp/f1/verified-pass-1/` and `.tmp/f1/verified-pass-2/`; each `results.json` contains 17 successful commands.

Cold review: no findings. `factory diff-audit --base 50d3607` listed nothing. Both revised browser cases passed five focused repeats; the usage-limit and worker-cleanup tests passed five focused runs.
