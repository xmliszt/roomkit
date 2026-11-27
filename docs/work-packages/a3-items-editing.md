# A3 — Items: place, select, move, rotate, undo

Read `docs/work-packages/README.md` first. Spec: `docs/PLAN.md` sections 3 (placement, wall-local numbers, anchors: a wall item's `heightM` and `alongM` measure to the centre of its back face) and 4, `docs/DESIGN.md` sections 4, 5 and 7. A1 (shell) and A2 (room, camera, WS wiring) are merged; build on them.

## Scope (`apps/web` only)

1. **Item rendering:** load each asset's `model.glb` from the daemon's asset route (B1), scale per axis by `sizeM / nativeSizeM`, place by `placement` (floor, wall, ceiling). A `pending` item is a dashed hairline box of its expected size with a mono tag (DESIGN 6, `queued` look only; the generation animation is M3). Material and Blueprint views for items.
2. **Add from catalog:** the Add tool's popover lists the catalog; the charging port (`packages/shared/src/catalog/charging-port.ts`) is added on the wall nearest the camera centre at the catalog default height, through `item.add`.
3. **Select and hover:** click selects (1 px `--accent` outline plus dimension lines for its size), hover shows a `--line-strong` outline, Escape clears. The inspector shows the real item's numbers (it shows a stub today).
4. **Move (`G`):** drag raycasts against the surfaces the item's mount allows; the anchor follows the hit point and the item aligns to the surface normal; wall items can move to another wall. Grid snap 0.05 m; Alt turns snapping off. Spring follow while dragging (DESIGN 7). One command per drag (on release), not per frame.
5. **Rotate (`R`):** a ring handle about the surface normal, 15° steps, Alt for free.
6. **Duplicate (`⌘D`), delete (Backspace/Delete), undo (`⌘Z`) and redo (`⌘⇧Z`)** as inverse commands from `packages/shared`. Removing a pending item cancels its job (PLAN 3).
7. `F` frames the selection.

Out of scope: the advanced panel's editable fields, export/import UI, snapshots (A4); chat UI. Do not edit `packages/`; if a contract is missing, stop and report.

## Gate

1. `pnpm check` passes; all earlier gates and e2e tests pass.
2. Playwright (free ports, temp folders): add a charging port; select it; move it along its wall by a drag and check `alongM` changed by a snapped amount; move it to another wall; rotate a floor item by one 15° step (add a plain floor item through the WS in the test fixture if the catalog has none); duplicate, delete, undo twice and redo once, checking the scene after each step against the daemon's copy; reload and check the scene is the same.
3. Screenshots of a selected item in Material and Blueprint views and one `interface-craft` critique pass, saved outside the repo.
