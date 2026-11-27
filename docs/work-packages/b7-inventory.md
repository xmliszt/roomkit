# B7 — Object inventory from the photos (M4 step 7) and weights adoption

Read `docs/work-packages/README.md` first. Spec: `docs/PLAN.md` sections 3 (items, pending items, jobs; the B5 and B6 contracts), 5.2 steps 7 and 9 (the scene opens with a plain box of the measured size per object), 5.3 (the `surveyor` role and its tools) and the "Weights adoption" paragraph in section 8; `python/README.md` (the `segment` worker); `roles/designer.md` for the role-file style.

## Scope (`packages/shared`, `packages/daemon`, `packages/mcp`, `roles/surveyor.md`, `python/workers/` for a new measure step, `python/tests/`, `package.json`, `scripts/gate-b7.ts`, `scripts/b7-real-inventory.ts`, fake CLI and fake worker fixtures, and in `apps/web` only files that switch on job kind, item model kind or chat block kind, plus `apps/web/src/chat/create-diff-undo.ts`, its tests and `apps/web/src/ws/create-planner-session.ts` for the undo fix)

1. **`roles/surveyor.md`** and the planner MCP tools PLAN 5.3 gives the surveyor: read the capture photos' vision copies, `inventory_submit`, `chat_post`. The surveyor lists the room's objects: name, mount, best photo, a rough box in that photo. It leaves out loose decorative items that are not part of a product, and keeps soft furnishings that belong with a piece (PLAN 0). It never estimates sizes; code measures them.
2. **`inventory` job kind,** after reconstruction: run the surveyor turn, then for each object the `segment` worker (box to mask in every capture photo that shows it), then a new deterministic `python/workers/measure.py`: the reconstruction's points inside the masks give position, rotation and size per object (floor items on the floor, wall items in wall-local `alongM`/`heightM`). Resumable like B6.
3. **Result into the scene:** one `item.add` per object as a `pending` item with its measured `sizeM` and placement (the plain box of PLAN 5.2 step 9), all as one undoable batch if the command set allows it, otherwise one command per item with a single chat `diff` block. Objects more than half hidden in every photo get a note in the chat.
4. **Weights adoption** (PLAN 8 follow-up): preflight marks a model `present` when every registry file is on disk at its exact size, and writes `.complete.json` itself.

Propose every new schema (job kind, tool shapes, commands) in PLAN section 3 marked "proposed in B7". You are a Codex agent with no `advisor` tool: follow the README's Codex rule.

## Gate

1. `pnpm check`, all earlier gates and `pnpm test:e2e` pass; `uv run --project python pytest python/tests` passes with tests for `measure.py` on synthetic points.
2. `pnpm gate:b7` (fake CLI surveyor, fake workers, temp folders): after a fake reconstruction, the inventory job adds one pending item per submitted object with the measured size and placement; undo removes them; a daemon restart mid-job resumes; a weights folder with exact-size files and no marker is reported `present` and gets a marker.
3. Use the fake CLI and worker for the automated gate. The real benchmark needs local captures, box annotations, and expected measurements.

## Decisions on B7's proposals (orchestrator, while the advisor is unavailable; for a second look by the chief engineer)

All proposals in B7's PLAN section 3 draft are approved as written, with these answers:
- Inventory enqueues automatically once after a reconstruction completes; `inventory.start` also runs it explicitly. A second inventory for the same reconstruction after success is refused until replacement is designed.
- A box for every visible view, in vision-copy pixels converted by the daemon: approved.
- One `generation` job in `queued` per object, each owning its pending item, is the intended state until M3's runner exists. Removing a pending item cancels its job; queued jobs stay queued across restarts.
- `Project.inventory: {jobId, appliedItemIds}` as the crash-recovery receipt: approved.
- The `measure` worker input and result: approved; insufficient points fail that object with a chat note, not the whole job.
- Weights adoption needs no contract question: build it.
