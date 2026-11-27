# A4 — Advanced panel, export, import, snapshot (closes M1)

Read `docs/work-packages/README.md` first. Spec: `docs/PLAN.md` sections 1, 3 (room rules, wall-local numbers, `colorize` formula) and 4, and the M1 gate in section 8; `docs/DESIGN.md` sections 4, 5 and 7. A1–A3 are merged; build on them.

## Scope (`apps/web` only)

1. **Room panel** (click the room size in the top strip): width, depth, ceiling height as editable numbers, sent as `room.update`. Floor items keep their distance from the nearest wall when a wall moves; wall items keep `alongM` and `heightM` (PLAN 3 and 4). Surface colours for floor, ceiling and each wall.
2. **Item inspector, editable:** width, height, depth with a lock-proportions toggle; elevation for floor items; `alongM` and `heightM` for wall items (bottom edge shown, derived, not stored); rotation; colour: `colorize` picker and strength, or shift sliders, applied live in the material shader with the PLAN 3 formula (with `referenceLuma`, default 0.5 when absent, floor 0.02), inside `colorMask.png` when the asset has one.
3. **Numbers:** tabular, unit in `--ink-dim`, typed values validated, Enter commits one command, Escape reverts.
4. **Project menu** (project name in the top strip): rename, export `.iplan` (B1 route; browser download), import `.iplan` (file picker and drop; opens the imported project), back to projects.
5. **Snapshot** (`⌘⇧S` and a button): renders one frame offscreen at 2×, saves through the B1 snapshot route and to the browser download (PLAN 4).
6. **Unscaled or weak-scale rooms** open the room panel on first load (PLAN 5.2 step 2); a flag on the project is enough for now if the contract has one, otherwise skip and report.

Out of scope: the charging port type picker (after B4), chat panel content, Settings page content. Do not edit `packages/`; if a contract is missing, stop and report.

## Gate (the M1 gate from PLAN 8)

1. `pnpm check` passes; all earlier gates and e2e tests pass.
2. Playwright (free ports, temp folders): place a charging port at `heightM` 0.3 and `alongM` 1.2 through the inspector, edit the room width in the room panel, reload; the numbers match and the port is still on its wall. A snapshot PNG is saved and is not blank (pixel variance check). Export `.iplan`, import it, the imported project has a new id and the same scene. Colorize a grey item to blue and check the rendered pixels inside the item are blue.
3. Screenshots of the room panel, the inspector with colour controls and the project menu, and one `interface-craft` critique pass, saved outside the repo.
