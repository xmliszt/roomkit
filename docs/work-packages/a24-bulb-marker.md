# A24 — Show and drag the bulb in the 3D view (Codex agent)

Read `docs/work-packages/README.md` first. Spec: `docs/DESIGN.md` (lighting, inspector light controls, selection outline), `docs/PLAN.md` section 3 (`Item.light`: `emitter` as 0–1 fractions of the item's box, `beam`, `mirrored`). Web only; no schema, daemon or MCP change. The user asked (2026-11-25): "bulb x/y/z as percentages don't tell me where the bulb is". Code: `apps/web/src/editor/light-controls.tsx`, the lighting code under `apps/web/src/editor/scene/lighting/`, `get-light-emitter-local-position.ts`, the selection box and size labels in the items layer.

## Scope

1. **Marker.** When exactly one item with `light` is selected (orbit and walk), draw a bulb marker at its emitter: a small bright dot (about 12 px on screen, constant screen size, drawn on top of the model so it shows through a dome or shade) with thin dashed guide lines to the item's box floor and the nearest box sides, so its depth reads. If the light has a `beam`, draw the cone outline (a ring at about 0.25 m along the beam plus 4 lines from the bulb). Colour from the light's `temperatureK`; dimmed when the light is off. Uses the `--accent` outline style of the selection box for the guides.
2. **Highlight from the inspector.** Hovering or focusing the bulb x/y/z, beam or beam-angle fields enlarges the marker and shows the axis being edited (a short arrow along that axis).
3. **Drag.** Dragging the dot moves the bulb on the plane facing the camera, clamped to the box (0–1), with a live preview and one `item.update` on release (one undo step). `⇧`-drag moves only vertically. Dragging the dot must not start an item move, an orbit or a marquee.
4. **Not shown** in snapshots, Render photo, or when chrome is hidden (`\`).
5. **Docs:** DESIGN (marker, guides, cone, drag).

## Gate

`pnpm check`, all gate scripts, and your new or directly affected specs only (the user asked to skip the full e2e). Unit tests for the emitter world position (box size, rotation, mirrored) and the drag clamp; an e2e that selects a lamp, finds the marker at the projected emitter position, drags it up, checks one `item.update` with a higher `emitter.y` and that undo restores it, and that a snapshot has no marker. Screenshots into `docs/work-packages/evidence/a24-*.png` (the mushroom lamp and the arc floor lamp, in a temp copy of the user's project; never write to `~/InteriorPlanner`).
