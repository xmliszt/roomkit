# A8 — Objects appearing, model controls and asset blocks (M3 web)

Read `docs/work-packages/README.md` first. Spec: `docs/DESIGN.md` sections 5 and 6 (the object-appearing storyboard, points, lines, reduced motion, the 3-at-once limit) and 8 (`asset` and `job` blocks); the mock `docs/mock/editor-mock.html` (its shaders and timing values are the reference: match them); `docs/PLAN.md` sections 3 and 5.1 (decision paragraph); `blender/normalize.py` docstring for the `points.bin` and `lines.bin` layouts.

## Scope (`apps/web/src/` only)

1. **Appearing animation** driven by job events: `queued` dashed box with tag; `generating` points (shape-unknown for chat-made objects; for inventoried objects, real points if the daemon provides them, otherwise shape-unknown); `ready` sequence from DESIGN 6 using the asset's `points.bin` and `lines.bin`; `failed` danger tag with retry in the inspector. One timing constants file with the storyboard comment at the top. Reduced motion: 200 ms crossfade. At most 3 animate at once. Lines 1 CSS px.
2. **Inspector actions:** "model this" for a held pending item (`generation.start`), "try another version" (`generation.alternatives`) and, when alternatives arrive, a small picker to keep one; "variant" (colour or shape); "regenerate"; "retry" on failure.
3. **Chat blocks:** `asset` (96 px turntable preview, name, size, place and focus actions) and `job` (stage list, progress, last log line, collapses when done).
4. If B10's messages are not merged yet, build against the shapes in PLAN section 3 marked "proposed in B10" using a fake daemon in your tests; if those are missing too, stop and report.

5. **Drop the Move tool** (the user's decision): remove the Move button from the tool rail and the `G` key; Select keeps dragging the selected object. Update tests and the command palette entry. See `docs/DESIGN.md` section 4.

## Rules

You are a Codex agent with no `advisor` tool: follow the README's Codex rule. Use the `shaders` skill guidance if available; check frame time with 3 items generating (DESIGN 6). Playwright installs set `PLAYWRIGHT_SKIP_BROWSER_GC=1`. Browser tests go in the existing suite.

## Gate

1. `pnpm check` and `pnpm test:e2e` pass.
2. Playwright with a fake daemon: a pending item goes queued → generating → ready and the model is visible at the end (pixel check), with no point left on screen after the sequence; failed shows retry; reduced motion skips the movement; "model this" sends `generation.start`; an `asset` block's place action adds the item.
3. A short screen recording or frame strip of the ready sequence, and frame time with 3 items generating, saved outside the repo.

Before your final gate, `git merge orchestrator`: B10 (daemon) and C3 (workers) run at the same time and touch the job display files.
