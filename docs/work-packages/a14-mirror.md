# A14 — Mirror an object

Read `docs/work-packages/README.md` first. Spec: `docs/DESIGN.md` section 4 ("Mirror"); `docs/PLAN.md` section 3 (items, commands, inverse) and the A14 line in section 8 (the approved contract).

## Contract (approved)

`Item` gains optional `mirrored: boolean` (absent = false). It flips the model left to right along its width axis (the item's local X); size and placement do not change. `item.update` can set it, and its inverse restores it. `item.duplicate` takes an optional `mirrored` for "duplicate mirrored".

## Scope (`packages/shared` for the contract and its tests; `apps/web/src/` for item rendering, the inspector and the ⌘K palette; another agent, B15, edits `packages/shared` for surface materials at the same time, so touch only item and command files there)

1. Schema, reducer, inverse and tests.
2. Rendering: a negative X scale on the item's model; check that lighting, the colour mask, points and lines still look right (three.js flips face winding for a negative determinant; confirm it).
3. Inspector and palette: `mirror` and `duplicate mirrored`. For wall items the flip is along the wall.
4. The designer can mirror through `scene_apply` with no change (it uses the same commands); add one line to `roles/designer.md`.

## Rules

You are a Codex agent with no `advisor` tool: follow the README's Codex rule. Do not stop the user's running app.

## Gate

1. `pnpm check` and all gates pass; `pnpm test:e2e` passes (stop nothing of the user's; use free ports).
2. Playwright: add an asymmetric test item, mirror it, and check a pixel on its distinctive side moved to the other side; undo restores it; duplicate mirrored makes a second, flipped item; reload keeps both.
