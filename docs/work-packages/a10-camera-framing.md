# A10 — Frame the room after it changes

Read `docs/work-packages/README.md` first. Spec: `docs/PLAN.md` sections 3 (`camera.set`) and 4 (canvas, camera); `docs/DESIGN.md` sections 4 and 7.

## Bug

After a reconstruction replaced the room (new walls, a footprint no longer centred where the old one was), the editor kept the old saved camera, so the view stayed close up inside one corner for the whole session.

## Scope (`apps/web/src/` only)

1. When a `room.update` arrives that came from a reconstruction (or any room change that moves the footprint's bounding box by more than 0.5 m or changes its size by more than 20%), frame the whole room from the default three-quarter view used for a new project, and save it with `camera.set`. A small user edit in the room panel does not move the camera.
2. On project open, if the saved camera's target lies outside the room's footprint or the camera is inside the room's walls, frame the room instead.
3. `F` with nothing selected already frames the room; reuse the same function.

4. **Snap toggle** (the user's request; DESIGN section 4 "Snapping"): a `snap` button in the top strip between `labels` and `commands`, key `S`, on by default, remembered in `localStorage` (try/catch). Off makes move and rotate free; Alt inverts the current setting while held. Add it to the ⌘K palette. Playwright: with snap off a drag lands on a non-grid position; with snap on it lands on the 0.05 m grid; reload keeps the setting.

## Rules

You are a Codex agent with no `advisor` tool: follow the README's Codex rule. Do not stop the user's running app.

## Gate

1. `pnpm check` and `pnpm test:e2e` pass.
2. Playwright: open a project, set a close-up camera, apply a reconstruction-sized `room.update` from the fake daemon; the whole room is in view (all four floor corners project inside the canvas). Reload with a camera target outside the room; the room is framed.
