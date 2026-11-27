# A13 — Walk mode (first-person view)

Read `docs/work-packages/README.md` first. Spec: `docs/DESIGN.md` section 4 "Walk mode" (the source of truth), A18's navigation code (`camera-navigation.tsx`, `camera-rig.tsx`, shortcut sheet), A11's ceiling visibility, the snapshot action (`⌘⇧S`). F3 (removing Blueprint view) runs in parallel; do not add Blueprint behaviour.

## Scope (`apps/web/src/editor/`, `docs/DESIGN.md`)

Build walk mode as DESIGN describes: a `walk` button in the top strip and key `W`; the camera moves to eye height 1.6 m inside the room (at the current target's floor point, or the room centre if that is outside); WASD or arrow keys move, Q and E lower and raise the eye between 0.9 and 1.9 m, dragging looks around; on touch, one finger looks and two move; the camera stays inside the walls, furniture does not block it; a lens control from 16 to 50 mm sets the field of view; ceiling, walls and floor show with their materials; `⌘⇧S` takes the snapshot at 2×; `Esc` or the `walk` button returns to the orbit view where it was. `W` enters from orbit and moves forward inside walk mode. In walk mode, A18's orbit-only bindings (right-hold fly, ⇧0/⇧1/⇧2, arrow pan) are off and the shortcut sheet shows the walk keys.

## Gate

`pnpm check`, all gates, `pnpm test:e2e --workers=1` pass. Browser tests: `W` enters walk mode at 1.6 m inside the room; W/A/S/D move and stop at walls; Q/E clamp to 0.9–1.9 m; drag changes the look direction; the lens control changes the field of view; the ceiling is visible looking up; `⌘⇧S` produces a 2× image; `Esc` restores the previous orbit camera exactly; typing in the composer does not move the camera.
