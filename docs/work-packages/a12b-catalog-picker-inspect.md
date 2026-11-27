# A12b — `+` catalog picker and Inspect preview (Claude agent)

Read `docs/work-packages/README.md` first. Spec: `docs/work-packages/a12-objects-panel.md` (the user's catalog request and the library additions), `docs/DESIGN.md` (Objects panel, Add tool), B16's commands in `docs/PLAN.md` section 3, A12's `apps/web/src/objects/use-objects-library.ts`, A16's shared preview renderer (`apps/web/src/chat/create-asset-preview-renderer.ts`). Starts after A12 merges. Consult the advisor before committing to an approach and before calling it done.

## Scope (`apps/web/src/`, `docs/DESIGN.md`)

1. **Inspect:** in an expanded Objects-panel entry, a larger preview the user drags to orbit and scrolls to zoom, using the one shared preview renderer (the page keeps at most 2 WebGL contexts).
2. **`+` picker:** the Add tool opens the project catalog as a picker: search, "From photo", "From prompt" and "Variant of selection" at the top, then "Built-in" (charging ports), then the project's models with thumbnails. Choosing a model places it like the panel's "Place in room" (view centre on the floor, or the nearest wall for wall-mounted models), selected and undoable.

## Gate

`pnpm check`, all gates, `pnpm test:e2e --workers=1` pass. Browser tests: the inspect preview orbits on drag and zooms on wheel with no more than 2 WebGL contexts; the `+` picker lists built-in ports and project models (placed and unplaced), search narrows it, choosing one adds one item with one undo; keyboard use works (arrows, Enter, Esc).
