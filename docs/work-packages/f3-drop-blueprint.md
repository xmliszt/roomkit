# F3 — Remove Blueprint view

Read `docs/work-packages/README.md` first. Starts after A17 and A18 are merged into `orchestrator`.

## Decision (from the user)

Drop the Blueprint button and the Blueprint view mode. The editor has one 3D view (today's Material view). The hairline visual style of the interface (DESIGN section 1, tokens, panel ticks, dimension lines in the 3D view, floor dot grid, sheet label) stays: that is the interface style, not the view mode.

## Scope (`apps/web/src/`, `apps/web/e2e/`, `docs/DESIGN.md`, `docs/PLAN.md`)

1. Remove the `blueprint` toggle in the top strip, the `B` key, its command-palette action and its row in the shortcut sheet, and the `SceneView` type with every `view` prop that only chose between the two modes.
2. Remove Blueprint-only rendering: the flat Blueprint material and `BlueprintLines` on assets, the Blueprint opening symbols from A15 (door swing, slide and window marks), and any camera behaviour that applied only in Blueprint view (for example left-drag pan).
3. Keep the object-appearing animation exactly as it is in the 3D view: `points.bin` and `lines.bin` still drive the points and the trace lines, which fade out after the surface appears (DESIGN section 6). Keep generating those files.
4. A saved view preference in the browser (`localStorage`) that says Blueprint must fall back to the 3D view without errors.
5. Update DESIGN (keys line, Openings paragraph, the views list, the animation table row "lines stay in Blueprint view", the appearing-animation notes on Blueprint creases) and PLAN wherever Blueprint view is named. Delete tests that only cover Blueprint view; adapt tests that toggled it to cover the same thing in the 3D view.

## Gate

`pnpm check`, all gates, `pnpm test:e2e --workers=1` pass; `rg -i blueprint apps/web/src apps/web/e2e docs/DESIGN.md` finds only the word in the design-language sense (hairline style) or nothing; a browser test checks that pressing `B` changes nothing and that a stored Blueprint preference opens the 3D view.
