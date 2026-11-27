# A2 — Canvas, room shell and projects

Read `docs/work-packages/README.md` first. Spec: `docs/PLAN.md` sections 3 (room rules) and 4, `docs/DESIGN.md` sections 4, 5 and 7, and the mock `docs/mock/editor-mock.html` (match its room drawing: flat surface colours, `--line-strong` edges, dot grid at 0.5 m, dimension lines with 45° ticks, camera framing). A1's shell is merged; build inside it.

## Scope (`apps/web` only)

1. **WS wiring.** The editor connects to the daemon (M0 client, B1 events), opens the project from the route, applies commands locally and sends them, and handles stale projects by reopening (PLAN 3: the reopen and `ownRequestIds` handling are this package's).
2. **Projects page `/`:** list, create from typed width, depth and ceiling height, rename, remove (B1 commands). The empty state per DESIGN 9 can be text for now; iso figures are later.
3. **Room shell in R3F** built from `room.walls` and `ceilingHeightM` (never a mesh from disk): floor, walls, ceiling, surface colours, `open` walls not drawn. Walls between the camera and the room are hidden. Dot grid on the floor. Wall length dimension lines. Top strip shows the room's real numbers.
4. **Camera:** `CameraControls`, orbit, pan, zoom; `camera.set` saved (debounced) so the view comes back after reload. `F` frames the room when nothing is selected.
5. **Blueprint and Material views** (`B`) for the room shell.

Out of scope: items, selection, snapping, the advanced panel's room fields (A3 and A4). Do not edit `packages/`; if a contract is missing, stop and report.

## Gate

1. `pnpm check` passes; earlier gates still pass.
2. Playwright (free ports, temp `PLANNER_HOME`/`PLANNER_PROJECTS`): create a 3.00 × 5.20 × 2.70 m project on `/`, open it, the canvas is not blank (pixel check), the top strip reads `3.00 × 5.20 × 2.70 m`, orbit the camera, reload, the camera position comes back; rename and remove a project from `/`.
3. Screenshots of the editor (Material and Blueprint) beside the mock, and one `interface-craft` critique pass, saved outside the repo.
