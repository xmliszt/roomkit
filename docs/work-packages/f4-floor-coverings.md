# F4 — Carpets and other floor coverings

Read `docs/work-packages/README.md` first. Spec: `docs/PLAN.md` section 3 (model gate in "Generation contracts"), 5.2 (inventory), `roles/modeler.md`, `roles/surveyor.md`, `docs/DESIGN.md` sections 4–6; `packages/daemon/src/generation/check-generated-asset.ts`; `apps/web/src/editor/scene/`.

## What the user asked for

"Fix the carpet support so I can add a carpet smoothly." Today: dragging has no collision blocking, so furniture can already stand on a rug; the problems are below.

## Problems found in the code

1. The model gate requires each smaller expected dimension within 20%. For an 8 mm rug that is ±1.6 mm, so a correct rug (or doormat, bath mat) fails "Wrong proportions".
2. A flat item at floor level draws in the same plane as the floor and flickers against the floor tiles.
3. Neither the modeler nor the surveyor role says anything about rugs, so thickness, pile and edges are guessed, and the inventory may skip rugs.

## Scope (`packages/daemon`, `apps/web/src/editor/`, `roles/`, `docs/PLAN.md`, `docs/DESIGN.md`)

1. **Gate:** a dimension passes when it is within 20% or within 5 mm of the expected value (record this in PLAN's gate line). Add a unit test with an 8 mm rug at 11 mm passing and at 30 mm failing.
2. **Rendering:** floor items 0.03 m tall or less draw 1 mm above the floor with a polygon offset so the floor never shows through, cast no shadow onto the floor beneath them, and do not z-fight with A11 floor tiles or planks. Furniture standing on a rug renders correctly (legs sink at most the rug's thickness; that is acceptable).
3. **Picking:** where a rug and another object overlap under the pointer, the other object wins; the exposed rug area still selects the rug. Dragging furniture over a rug and dragging the rug under furniture both work, with snapping on or off.
4. **Animations:** generation, alternatives and A19 load-in work for flat items (points on the top face, no collapse to a line); check with a 2.0 × 1.4 × 0.01 m rug.
5. **Roles:** `roles/modeler.md` gets a short floor-covering section (real thickness 5–20 mm unless the photos show a thick shag; woven or pile texture from the photos, binding or fringe edges, slight corner softness, no sagging or folds unless photographed; never thinner than 4 mm). `roles/surveyor.md` includes rugs, carpets and mats as floor objects with their measured footprint and a thickness estimate.
6. Note it in DESIGN (floor coverings) briefly.

## Gate

`pnpm check`, all gates, `pnpm test:e2e --workers=1` pass. Browser tests (fixtures): a 2.0 × 1.4 × 0.01 m rug with a sofa placed over half of it shows no floor pixels through the rug at three camera angles (pixel check) and no flicker between two frames; clicking the sofa over the rug selects the sofa, clicking the exposed rug selects the rug; both drag with snapping on and off; the rug's generation animation shows points across its top face. The gate unit test above passes.
