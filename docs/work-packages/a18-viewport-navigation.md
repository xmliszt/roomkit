# A18 — Viewport navigation keys and mouse

Read `docs/work-packages/README.md` first. Spec: `docs/DESIGN.md` (orbit and Blueprint views, walk mode, snapping, top strip keys), `apps/web/src/editor/get-shortcut-action.ts`, `apps/web/src/editor/scene/camera-rig.tsx`. Starts after A11 is merged into `orchestrator` (it adds the `G` grid key and edits the camera rig).

## What the user asked for

The navigation people expect from 3D and design tools: hold Space and drag, arrow keys and WASD to move, `⌘+` / `⌘−` to zoom, `⇧0` and friends to reset or fit the view.

## Bindings (orbit and Blueprint views; walk mode keeps its own keys)

| Input | Action |
|---|---|
| Left drag on empty space | orbit (as now; Blueprint: pan) |
| Right drag, middle drag, or **Space + left drag** | pan; the cursor is a grab hand while Space is held |
| Wheel / pinch | zoom toward the pointer |
| **⌘+ / ⌘=** and **⌘−** | zoom in / out one step toward the view centre; the browser page zoom never fires over the editor |
| **⇧0** or **⌘0** | reset to the default view of the room (the view a new project opens with) |
| **⇧1** (and `F`) | frame the whole room |
| **⇧2** | frame the selection (no selection: same as ⇧1) |
| **Hold right mouse + W A S D**, Q / E down / up | fly the camera (Shift faster); releasing the button ends it. A right press used for flying never opens the context menu (A17) |
| **Arrow keys**, no selection | pan the view (Shift: larger steps); with ⌥: orbit left/right/up/down by 15° |
| **Arrow keys**, with a selection | nudge the object 0.05 m along the floor in screen-relative directions (Shift: 0.5 m), one undo step per key-up burst; respects snapping and collisions as dragging does |

Plain `W`, `S` and other single-letter keys keep their current meanings (walk, snap, …); WASD moves only while the right button is held or in walk mode.

Also add a **`?` shortcut sheet**: pressing `?` (or a `?` button at the end of the top strip) shows every editor key and mouse binding in a two-column list in the DESIGN style, closed by `Esc` or `?`.

## Scope (`apps/web/src/editor/`, `docs/DESIGN.md`)

Camera moves use the existing camera rig and its smoothing; key holds animate per frame, not per key-repeat event. Keys are ignored while typing in a field. Update DESIGN.md with the bindings table.

## Gate

1. `pnpm check`, all gates, `pnpm test:e2e` pass.
2. Browser tests: Space-drag pans (camera target moves, nothing gets selected or moved); right-drag pans; ⌘+ and ⌘− change the camera distance and the page's `visualViewport.scale` stays 1; ⇧0 restores the default view; ⇧2 frames the selected object; right-hold + W moves the camera forward and opens no menu; arrows with nothing selected pan; arrows with a selection move it 0.05 m and one undo restores it; `?` opens and `Esc` closes the sheet; typing in the composer triggers none of these.
