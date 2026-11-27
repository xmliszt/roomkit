# B22 — Replay the whole living-room project (Codex agent)

Read `docs/work-packages/README.md` first. Code: `scripts/demo/` (`replay.ts`, `fake-agent.mjs`), B13's brief `docs/work-packages/b13-demo-replay.md`, `docs/PLAN.md` (generation sources, surface jobs from 815d1b4).

Replay all items including those added after the inventory, each from its own saved generation source, queued after the inventory items in the order they were added, with the same appear animation; a fake-agent case for surface jobs that returns each surface's saved result; no failed jobs (items without a saved model are left out and listed in `result.json`). Read the user's project read-only; replay into a temp project, never write to `~/InteriorPlanner`.

Gate (fast, the user wants speed): `pnpm check`, and `replay.ts` on a temp copy of `/path/to/project` finishes with every item that has a saved model in the scene, no failed jobs, process audit clean. Put `result.json` and a final screenshot in `docs/work-packages/evidence/b22-*`. Commit and set the card to in-review when that passes.
