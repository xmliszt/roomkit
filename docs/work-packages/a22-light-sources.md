# A22 — Light sources you can switch on and off (Claude agent)

Read `docs/work-packages/README.md` first. Spec: `docs/PLAN.md` (scene schema in section 3, the "Lighting" queued entry in section 8, regeneration rules), `docs/DESIGN.md` (inspector, context menu, the 3D view's lighting paragraph). The user asked for this on 2026-11-24; the chief engineer approved the schema below. Consult the advisor before committing to an approach and before calling it done.

This is phase 1: direct light, shadows and switches. Global illumination (a path-traced still) is phase 2, a later package; do not build it here.

## Schema (approved; additive)

`Item` gains optional `light: { on: boolean, emitter: {x, y, z}, lumens: number, temperatureK: number }`.

- `emitter`: the bulb position as 0–1 fractions of the item's box (x across width, y up height, z across depth, item-local), so it survives a size change and flips with `mirrored`.
- `lumens` (> 0, sane max) and `temperatureK` (1500–8000) are real units. One renderer constant maps lumens to three.js intensity; never store renderer intensity.
- `ItemSchema` is `.strict()`: every saved project must parse unchanged. Commit the schema change first, on its own.

Handle it in every consumer: `item.update` and its inverse, `item.duplicate` (and mirrored), regenerate, alternative and variant publication (keep `light` like `mirrored`, lock and colour adjustment), `.iplan` export and import, the MCP `scene_apply` schema, `roles/designer.md` (set `light` when it adds a lamp or ceiling light; typical values: table lamp 400 lm 2700 K, floor lamp 800 lm, ceiling light 1500 lm). Update PLAN section 3.

## UI

- Inspector: a "Light source" switch for any item. Turning it on the first time creates a default `light` by mount: floor and table items emitter at `{0.5, 0.85, 0.5}`, ceiling items at `{0.5, 0.1, 0.5}`, wall items `{0.5, 0.6, 0.6}`; then an on/off switch, brightness (lumens) and warmth (K) fields. Undoable as one `item.update`.
- Context menu: "Turn light on" / "Turn light off" for items with `light`.
- Objects panel rows show a small on/off state for lights. DESIGN text for all of it.

## Rendering

- No light on: the frame looks exactly as today (same ambient, key, environment map, no tone mapping change).
- One or more on: the room dims (lower ambient and key, tone mapping on) so lamps read; tune the lighting on a synthetic scene. Lamps light walls, floor and furniture with shadows.
- An item whose light is on does not cast shadows (the bulb sits inside its own opaque mesh). Optionally make its shade glow (emissive) faintly.
- Cost: at most 2 shadow-casting lights (nearest the camera target); the rest light without shadows. Switch with intensity 0, never mount/unmount lights, since a light-count change recompiles every material. Keep orbit at 60 fps on a sample room with 3 lights on (measure and report).
- Walk mode and snapshots use the same lighting.

## Gate

`pnpm check`, all gate scripts, and your new specs only (the user asked to skip the full e2e). Tests: old items parse; `light` round-trips through update/undo, duplicate, mirror, regenerate publication and `.iplan`; an e2e that turns a lamp on and checks pixels near it get brighter and the room elsewhere dims, then off restores the original frame. Screenshot the user's-style room with a lamp off and on into `docs/work-packages/evidence/a22-*.png` (use a temp project; never write to `~/InteriorPlanner`).
