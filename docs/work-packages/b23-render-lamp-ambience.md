# B23 — Render with the lamps' evening light, as in the editor (Codex agent)

Read `docs/work-packages/README.md` first. Spec: `docs/DESIGN.md` (lighting: with any lamp on the room dims to an evening look; Render photo), `docs/PLAN.md` (B21 render contracts, A22 `Item.light` with `beam` and `shade`). Code: `blender/render_photo.py` (world "Soft daylight" strength 1.5, "Soft room fill" area light, exposure −0.75), the editor lighting under `apps/web/src/editor/scene/lighting/`.

## The bug (user report, 2026-11-25, with screenshots)

With lamps on, the editor shows a dim evening room: warm pools under the mushroom lamp and the arc lamp, glowing shades, darker walls. The Cycles render of the same view ignores that ambience: the daylight world and the fill light light the room evenly, so the lamps barely show and the room is uniformly bright.

## Scope

1. The render follows the editor's lighting mode. No light on: today's daylight (keep the calibrated look). One or more lights on: evening — no fill light, a dim dusk world through the glass (dark blue, low strength), exposure set so the lamps are the main light: warm pools and glowing shades, darker room corners, the same relative look as the editor's lamps-on frame.
2. Lamp brightness in Cycles uses the same lumens as the editor, with one documented lumens-to-watts constant; check the mushroom lamp (translucent orange dome glows, soft orange pool on the cabinet) and the arc lamp (light falls on the sofa below, not on the wall behind the shade).
3. Docs: PLAN render section (the two modes and their constants), DESIGN one line.

## Gate

Run the render tests and use a separate sample project for visual comparisons.
