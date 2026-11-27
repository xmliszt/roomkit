# A28 — Point cloud, floor outline, walls rise (Codex agent)

Read `docs/work-packages/README.md` first, then `docs/DESIGN.md` section 6 (the reconstruction sequence and motion rules). Code: the reconstruction job events and the editor's room rendering (`apps/web/src/editor/scene/room-shell.tsx`), the object appear animation for the soft-point style. Web only unless the point cloud is not reachable from the web app today; if it needs a new route or event, write the exact shape in PLAN in your first commit and ask the orchestrator before building on it.

Show the photo point cloud in the room while reconstruction runs; when measured, floor outline as hairlines, then walls rise to ceiling height, then points fade; timings in one storyboard constants block; springs or ease-out, no snap; reduced motion gets a crossfade. No default 4 × 5 m box snapping to the measured room.

Gate (fast): `pnpm check` plus one new spec with fake reconstruction events showing each step in order; screenshots of three moments in `docs/work-packages/evidence/a28-*.png`. Commit and set the card to in-review when that passes.
