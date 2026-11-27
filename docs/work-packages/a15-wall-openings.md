# A15 — Wall openings for doors and windows

Read `docs/work-packages/README.md` first. Spec: `docs/PLAN.md` section 3 (scene schema, wall placements, commands, the queued-work note on A15), 5.2 (inventory), `docs/DESIGN.md` (room rendering), `roles/surveyor.md`, `roles/modeler.md`. `Item.cutsOpening` is approved by the orchestrator; write it into PLAN section 3 in this PR.

## Problem

Wall openings should cut through the wall. Other wall-mounted items should sit flush against it.

## Scope (`packages/shared`, `packages/daemon` (inventory apply), `apps/web/src/editor/scene/` (wall rendering, wall-item placement), `roles/surveyor.md`, `roles/modeler.md`, `docs/PLAN.md`, `docs/DESIGN.md`)

1. **Schema.** `Item` gains optional `cutsOpening: boolean` (absent = false; old projects load unchanged). `item.update` patches it with `null` removing it, and its inverse restores it exactly; `item.duplicate` copies it. Only wall items may set it (`applyCommand` rejects it on floor and ceiling items).
2. **Walls with holes.** A wall is built with a rectangular hole for each `cutsOpening` item on it: the item's width × height at its `alongM`/`heightM`, clipped to the wall. Holes go through the full wall thickness, show in both orbit and Blueprint views (Blueprint: the wall line breaks at the opening with door/window symbol lines), work with A11's wall materials (UVs stay in metres around the hole) and with walls that are hidden toward the camera. Overlapping openings merge.
3. **Opening items sit in the wall.** An item with `cutsOpening` is centred in the wall's thickness, and its rendered depth is clamped to the wall thickness (a model deeper than that is scaled down in depth, not pushed into the room). Its outline, hit box, snapping and collision use the clamped box.
4. **Wall items stand flush.** Test that each wall item's back sits on the wall's inner face using a synthetic project.
5. **Inventory.** The surveyor sets `cutsOpening: true` for doors, windows, sliding doors and open doorways; the inventory apply step passes it through. `roles/surveyor.md` says so. `roles/modeler.md` says a door or window model is no deeper than the frame (≤ 0.25 m unless the photos show otherwise), with nothing behind the frame.
6. **Inspector.** Wall items get a "cut opening in wall" checkbox (undoable).
7. **Existing projects.** On `project.open`, nothing is migrated silently. Instead the inspector and the designer can set it. Add a one-off script `scripts/a15-mark-openings.ts <project-folder>` that sets `cutsOpening` on items whose names contain door, window or doorway via `scene.apply` against a running daemon (dry-run by default, `--apply` to write).

## Gate

1. `pnpm check`, all gates, `pnpm test:e2e` pass (run browser tests with `--workers=1` if the machine is loaded).
2. `pnpm gate:a15`: schema round-trip and inverse tests; a room with a 0.12 m wall and a door (`cutsOpening`, depth 0.85) shows a hole (pixel check through the opening sees the far side), the door's rendered depth is ≤ 0.12 m and it does not stick into the room; Blueprint shows the break; synthetic wall-item placements end flush with their walls (distance from back face to wall face < 1 cm); a fake-surveyor inventory produces `cutsOpening` on a door; the mark-openings script in dry-run lists a sliding door and a doorway from the test project.
