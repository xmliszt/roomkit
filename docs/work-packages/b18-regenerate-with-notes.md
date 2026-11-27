# B18 — Regenerate an object from its own sources, with the user's notes

Read `docs/work-packages/README.md` first. Spec: `docs/PLAN.md` section 3 (generation contracts from B10 and B14, inventory sources), 5.1 and 5.3; `roles/designer.md`, `roles/modeler.md`.

## Bug (seen in the user's app)

The user asked in chat, with the item attached as a chip, to regenerate the coffee table ("it has only 3 legs; the legs are oval") and the dining table. The designer refused both: "no photos reached me … I can't read the project's photo folder". Regenerating an object the inventory found must reuse that object's own sources automatically.

## Scope (`packages/shared`, `packages/daemon`, `packages/mcp`, `roles/designer.md`, `roles/modeler.md` (only the part about reading notes), and in `apps/web/src/` the inspector's regenerate action; B17 is editing the alternative worker code at the same time)

1. **`generation.regenerate {projectId, itemId, notes?}`**: queues a new generation job for an item that already has a model (or failed), with the same sources the original job used (for an inventoried object: its best views, crops and masks; for a chat-made object: its reference photo or web image; for a variant: the parent's render), plus `notes` (the user's corrections, up to 1,000 characters). The modeler's `job.json` carries the notes; `roles/modeler.md` says notes from the user override what the agent reads from the photos when they conflict. The current model stays until the new one passes the gate, then one `item.update` swaps it (undoable).
2. **Designer tool `asset_regenerate {itemId, notes}`**: the designer uses it for "regenerate / fix this model" requests, writing the notes from the user's words; `roles/designer.md` says so and that the designer never asks for photos for an object that already has sources.
3. **Inspector:** "regenerate" opens a small note field ("what should change?") and sends `generation.regenerate` directly; empty notes allowed.
4. Propose the new schemas in PLAN section 3 marked "proposed in B18" and build them; Codex: no `advisor`; follow the README's Codex rule.

## Gate

1. `pnpm check`, all gates, `pnpm test:e2e` pass.
2. `pnpm gate:b18` (fake CLIs): an inventoried item regenerated with notes gets a modeler job whose folder holds the same crops and masks as the original and the notes in `job.json`; the old model stays until the new one is ready; undo restores the old model; the fake designer given "regenerate this, the legs are oval" with an item chip calls `asset_regenerate` with that item and notes mentioning oval legs.
