# A11 — Draw surface materials and the room-surface controls

Read `docs/work-packages/README.md` first. Spec: `docs/DESIGN.md` section 4 ("Room surfaces", and the ceiling visibility rule), sections 5 and 7; `docs/PLAN.md` section 3 (B15's surface material contract: `tiles`, `planks`, `texture`, `paint`; `surface.update`; `textureAssetId` folders) and 4.

## Scope (`apps/web/src/` only; A14 is editing item rendering and the inspector at the same time, so keep to the room shell, the room panel and surface selection)

1. **Render** each surface's material in Material view at real-world scale: world-space UVs so a 0.8 m tile is 0.8 m in the scene on any wall length; `paint` finish maps to roughness (matte high, satin lower); glossy tiles get a soft reflection of the room's light (an environment term, no mirror reflections). Blueprint view keeps flat fills with hairlines. Flat colour when `material` is absent.
2. **Select a surface:** use the Room panel list or double-click the floor, a wall or the ceiling (hover outline as for objects); `Esc` clears. A plain click on empty floor clears selection without opening the Room panel. The ceiling shows when the camera is inside the room below ceiling height or looking up (DESIGN).
3. **Room panel:** a list of Floor, Ceiling and each wall (named by position, e.g. "Wall 2 (window)" when the room knows; otherwise by number), selectable from any view. For the selected surface: material kind (paint, wallpaper or texture, tiles, planks), paint swatches (about 12 curated neutrals and accents) plus a colour picker and finish; tile or plank size, grout width and colour; "apply to all walls". Changes preview instantly and commit one `surface.update` on release; undo works.
4. The ⌘K palette gets "select floor", "select ceiling" and "paint all walls…".

## Rules

You are a Codex agent with no `advisor` tool: follow the README's Codex rule. Do not stop the user's running app. Playwright installs set `PLAYWRIGHT_SKIP_BROWSER_GC=1`.

## Gate

1. `pnpm check`, all gates and `pnpm test:e2e` pass.
2. Playwright with a fake daemon: a floor with 0.8 m tiles shows grout lines 0.8 m apart (project two grout lines to the screen and measure); paint a wall sage green, matte, and check its pixels; apply to all walls; undo restores; the ceiling is hidden from above and visible from inside.
3. Screenshots of the room with tiles and painted walls, from above and from inside, saved outside the repo.
