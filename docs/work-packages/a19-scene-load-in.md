# A19 — Objects load in with the dot-cloud effect

Read `docs/work-packages/README.md` first. Spec: `docs/DESIGN.md` section 6 (objects appearing: points, trace lines, surface fade, timing) and section on motion; `apps/web/src/editor/generation/` (`appearing-asset.tsx`, `get-appearance-frame.ts`, `appearance-timing.ts`, `load-appearance-data.ts`, the three-at-a-time animation slots).

## What the user asked for

When the page loads or refreshes, the objects pop into the scene as soon as each model file arrives. Instead, each object should come in with the same dot-cloud effect used when a model finishes generating, so the room assembles smoothly.

## Scope (`apps/web/src/editor/`, `docs/DESIGN.md`)

1. On opening a project (first load and every reload), every item with a ready asset that comes into view for the first time in this page plays the appearing sequence from section 6 (points gather on the surface and take its colour, edges trace, the surface fades in from the floor up, points and lines fade out). It ends in exactly the state the item has today.
2. Order and pace: nearest the camera first; start a new item every 80 ms; up to 8 animate at once for load-in (the 3-at-a-time limit stays for generation); a shortened load-in timing (about 1.2 s per item, the same phases scaled) so a 25-object room settles within about 4 s. Items wait as nothing (not as boxes or placeholders) until their turn. The room shell, walls and floor show at once.
3. It plays once per page load per item. Edits, undo, selection, view changes, project re-open from a reconnect, and items added later do not replay it (new generations keep their own animation).
4. Reduced motion: no animation; items fade in together over 150 ms.
5. Performance: load the points and lines data for each item once (reuse `load-appearance-data.ts`); do not block the first frame of the room on all models loading; an item whose model fails to load shows the existing error state.
6. Document it in DESIGN section 6 as "Load-in". Blueprint view is being removed in F3 (runs in parallel), so do not add Blueprint behaviour.

## Gate

`pnpm check`, all gates, `pnpm test:e2e --workers=1` pass. Browser tests (mock fixtures): a project with 12 ready items shows the point cloud within 300 ms of the first model loading, no more than 8 items animating at once, all items final within 5 s, items appear nearest-first; after load, selecting, moving and undoing do not replay it; reduced motion shows no points and all items within 300 ms. Save a short screenshot series as evidence.
