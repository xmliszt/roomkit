# A7 — Capture page and reconstruction UI

Read `docs/work-packages/README.md` first. Spec: `docs/PLAN.md` sections 3 (the B5 photo record and the B6 reconstruction contracts), 4 and 5.2 steps 1–6; `docs/DESIGN.md` sections 4 (other pages: 720 px column), 6 (the room point cloud shows first, then the floor plan draws, then walls rise), 8 (`capture-request` block) and 9 (capture guide figure, reconstruction progress figure).

## Contracts added for A7 (approved by the orchestrator; record them in PLAN section 3)

- `photos.list {projectId}` → `{photos: Photo[]}`: the project's B5 photo records, both origins; the web app filters to `capture`.
- `reconstruction.scale.get {projectId}` → `{sources}`: the saved scale sources, same shape as `reconstruction.scale.set`.
- A photo rejected for blur has no copies, so it has no thumbnail: the capture grid shows a placeholder tile labelled "too blurry" for it. No route change.

## Scope (`apps/web/src/`, plus the two read commands above in `packages/shared` and `packages/daemon` with tests)

1. **`/projects/[id]/capture`:** upload photos by picker and drop (sent with `origin=capture`), a grid of thumbnails (B5's photo route, `naturalWidth > 0`) with rejected-for-blur ones marked, short capture tips (tips, not rules; PLAN 5.2 step 1), and a start button (`reconstruction.start`). A link from the editor's project menu and from the empty projects page.
2. **Scale input:** a small form for a typed measurement (room width, depth or ceiling) and a "known furniture size" flow: pick a photo, drag a box around the object, choose the axis and type the size (`reconstruction.scale.set`). Show the sources set.
3. **Progress:** the reconstruction job's stages and progress on the capture page and in the job strip; the DESIGN 9 reconstruction progress figure (a room plate whose walls rise as stages finish).
4. **Result:** when the job finishes, open the editor. If `project.reconstruction.weakScale` is true, open the room panel on first load (PLAN 5.2 step 2).
5. **`capture-request` chat blocks:** the small top-down room map with the requested wall (or floor) and standing point marked, and an upload action that sends to the capture route.

Out of scope: the overlay of fitted lines on photos (5.2 step 6) and the object review screen (step 9); later packages. Beyond the two read commands, do not edit `packages/`; if another message is missing, stop and report.

## Rules

You are a Codex agent with no `advisor` tool: follow the README's Codex rule. Playwright installs set `PLAYWRIGHT_SKIP_BROWSER_GC=1`. Look at your screenshots against DESIGN and fix what looks off.

## Gate

1. `pnpm check`, all gates and `pnpm test:e2e` pass.
2. A Playwright test with the fake workers (as in `gate:b6`): upload four photos on the capture page, set a furniture scale source with a dragged box, start reconstruction, see the stages advance, land in the editor with the fitted room size in the top strip; with a weak-scale fake result the room panel opens; a `capture-request` block shows its map and its upload action posts a capture photo.
3. Screenshots of the capture page (with photos, during progress) and a `capture-request` block, saved outside the repo.
