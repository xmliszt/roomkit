# F2 — Stable texture picker with native scale

Read `docs/work-packages/README.md` first. Spec: `docs/DESIGN.md` (Room surfaces), `docs/PLAN.md` section 3 (surface materials, B15 surface assets), `apps/web/src/editor/surface-controls.tsx`.

## Bugs (seen in the user's app)

1. The Texture select lists only textures that some surface uses right now (`textureAssets` in `surface-controls.tsx`). Picking texture 4 for a wall that held texture 3 drops texture 3 from the list: the user saw 4 options, then 3. Options are labelled "Texture 1…N", which says nothing.
2. Choosing a texture keeps the surface's previous `repeatSizeM` (or 0.5 × 0.5 m when switching kind), so the pattern is stretched or shrunk. Each surface asset's `meta.json` (`kind: "surface"`) holds the measured `material.repeatSizeM` and `roughness`; those must be used.

## Scope (`packages/shared`, `packages/daemon`, `apps/web/src/editor/`)

1. **Read command `surface.assets {projectId}`** → every surface asset in the project folder (`assets/*/meta.json` with `kind: "surface"`), newest first: `{assetId, kind: material.kind, color, repeatSizeM | tileSizeM | plankSizeM, roughness, sourceSurfaceId?, createdAt}`. Find `sourceSurfaceId` from the surface job record that produced it, when there is one. Propose the schema in PLAN section 3 marked "proposed in F2" and build it (Codex: follow the README's Codex rule).
2. **Picker.** The Texture select (and the kind switch to "Wallpaper / texture") lists every surface asset from that command, whether used or not, with a readable label and a small swatch from `baseColor.png`: "Wallpaper · from wall 2 · 0.27 × 0.22 m", "Floor tiles · 0.80 m", and so on, using the "wall N" names the Room panel uses. Never show an id.
3. **Native scale.** Choosing an asset applies its measured repeat size and roughness from the command. The repeat-size fields stay editable afterwards; add a "reset scale" button that restores the asset's measured size. "Apply to all walls" copies the material exactly, repeat size included.
4. Refresh the list when a surface job finishes.

## Gate

1. `pnpm check`, all gates, `pnpm test:e2e --workers=1` pass.
2. Browser tests: a project with 3 surface assets on 2 walls lists 3 options with readable labels; choosing one on another wall keeps 3 options; the chosen wall gets that asset's measured repeat size (pixel check: the pattern period on two walls using the same asset matches within 5%); reset scale restores it after an edit; apply to all walls copies the repeat size.
