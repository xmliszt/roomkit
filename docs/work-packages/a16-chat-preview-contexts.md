# A16 — Chat model previews must not exhaust WebGL contexts; chat block polish

Read `docs/work-packages/README.md` first. Spec: `docs/DESIGN.md` section 8 (`asset` block: 96 px turntable preview), 5 and 7.

## Bug (seen in the user's app)

Opening chat in a project with 27 models made 23 canvases; Chrome warned "Too many active WebGL contexts. Oldest context will be lost" and dropped the main scene's context, so the scene went white.

## Scope (`apps/web/src/` chat blocks and the scene canvas only; A11 and A14 are editing surfaces, the room panel, item rendering and the inspector at the same time)

1. `asset` blocks show the asset's `thumb.png` as a still image. On hover, one shared preview renderer (a single WebGL context for the whole app, drawing into the hovered block, or rendering a short turntable to frames) spins it. Never one context per block.
2. The main scene canvas handles `webglcontextlost` and `webglcontextrestored`: it restores itself and reloads its GPU resources; until restored it shows a quiet "restoring view…" note, never a white page.
3. Sizes in `asset` blocks and elsewhere in chat format as `0.34 × 0.49 × 0.02 m` (2 decimals, unit once).
4. `notice` blocks show the Settings link only for missing-requirement notices.

You are a Codex agent with no `advisor` tool: follow the README's Codex rule. Do not stop the user's running app.

## Gate

1. `pnpm check` and `pnpm test:e2e` pass.
2. Playwright with a fake daemon: a chat with 30 `asset` blocks open beside the scene: the page has at most 2 WebGL contexts, no "Too many active WebGL contexts" console warning, and the scene's pixels are not blank; hovering a block animates its preview; force a context loss on the scene (`WEBGL_lose_context`) and it comes back.
