# B15 — Surface materials: floor tiling, wallpaper, ceiling (data and agent)

Read `docs/work-packages/README.md` first. Spec: `docs/PLAN.md` sections 0 (realism bar), 3 (`Room.surfaces`, reconstruction, generation contracts), 5.2 and 5.3; `roles/modeler.md` and `blender/procedural/modeler_lib.py` (S7 helpers: `tileable`, `photo_quad`, `photo_color`, `surface`, `bake`).

## What the user asked for

Floor tiling (and the rest of the room's surfaces) rendered in the scene, because it is part of judging how the room looks.

## Contract (approved by the orchestrator; record in PLAN section 3)

`Room.surfaces[surfaceId]` keeps `color` and gains an optional `material`, a union on `kind`:
- `{kind: 'tiles', tileSizeM: {u, v}, groutWidthM, groutColor, baseColor, roughness, textureAssetId?}`
- `{kind: 'planks', plankSizeM: {u, v}, baseColor, roughness, textureAssetId?}`
- `{kind: 'texture', repeatSizeM: {u, v}, roughness, textureAssetId}` (a tileable image such as wallpaper)
- `{kind: 'paint', color, finish: 'matte' | 'eggshell' | 'satin'}` (the user wants to try paint colours on walls; finish maps to roughness in the renderer)
`textureAssetId` names an asset folder holding `baseColor.png` (tileable, ≤ 2048 px), optional `normal.png` and `roughness.png`, and `meta.json`. `surface.update` carries the material; its inverse restores the old one. Absent `material` means flat colour, as today.

## Scope (`packages/shared`, `packages/daemon`, `packages/mcp`, `roles/`, `blender/procedural/` helpers, `scripts/`, fake fixtures; and in `apps/web` only files that switch on job kind or chat block kind)

1. Schema, reducer, inverse and tests for the contract above.
2. **`surface` job kind**, queued after a reconstruction for the floor, each wall and the ceiling: a fresh agent turn with a new `roles/surfacer.md` (written in the style of `roles/modeler.md`: faults to avoid, order of work, compare loop, a reason per rule) that sees the capture photos showing that surface and the room's metric scale, measures the repeat size (tile size from grout lines against known room dimensions), and builds a tileable texture set in Blender with the S7 helpers (procedural tiles or planks when the pattern is regular; a rectified, made-tileable photo patch for wallpaper). A code gate: tileable (edges match), size limits, repeat size between 5 cm and 3 m. The result applies as one `surface.update` with a chat `diff` block.
3. Uses the reserved designer/surveyor agent slot rules from B14 if merged; otherwise the existing limits.
4. Designer tool `surface_set` so the user can ask in chat ("make the floor light oak planks", "paint the wall behind the sofa sage green, matte", "paint all walls warm white"); it can target one wall by id or all walls, and the designer names walls by what is next to them.

Codex: no `advisor`; follow the README's Codex rule; build past the contract above without stopping.

## Gate

1. `pnpm check`, all gates, `pnpm test:e2e` pass.
2. `pnpm gate:b15` (fake surfacer CLI writing a known script, real Blender): after a fake reconstruction, floor and wall jobs produce tileable textures and apply `surface.update`; undo restores the flat colour; a non-tileable texture fails the gate.
3. `scripts/b15-real-surfaces.ts`, run by the orchestrator: run the surfacer on a local project copy and compare the floor tiles with the expected tile size supplied on the command line.
