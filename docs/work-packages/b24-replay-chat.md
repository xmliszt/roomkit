# B24 — Replay fixes (Claude agent)

Builds on B22 (`b22-replay-whole-project.md`). Code: `scripts/demo/`.

1. **No Python.** The fake `reconstruct` worker writes a missing `points.bin` with `sample-reconstruction-points.ts`, a Node port of `python/workers/reconstruction_preview.py`. It reads `scene.npz` directly and decodes photos with `sharp`. It picks points with the same fixed stride as the Python, so no random seed is involved. On the living room it gives the same bytes as the Python.
2. **Full project folders.** `seedReplayProject()` creates every folder in `PROJECT_FOLDERS`, so Snapshot works.
3. **Clean stop.** Chromium no longer handles signals itself. SIGINT, SIGTERM and SIGHUP close the browser and run the replay's cleanup, which stops the daemon and `next dev`. A second Ctrl-C kills `next dev` and the daemon at once and exits.
4. **Chat request from a photo.** `prepare-replay.ts` copies `.planner/chat.json` into the snapshot. The fake agent branches on the role prompt (`# Designer`, `# Surveyor`, otherwise a `job.json` turn). For a designer turn, `replay-designer-turn.ts` finds the saved user message whose image has the same file hash as the photo attached now. It then emits that reply's `asset_generate` call, with photo ids remapped, followed by the reply text. The modeler and the fake Blender fall back to the late item with the job's name (`find-replay-entry.ts`). `replay.ts --hold-item <name prefix>` (repeatable) leaves matching items out of the replay, so a chat request in the recording creates them. Only generated items added after the inventory can be held.

   For a recording, wait for "Replay complete" and attach a reference photo from the approved replay project.

Gate: `vitest run test/fake-cli`, then `node scripts/demo/verify-replay-chat.ts /path/to/project --photo-id <id> --asset-id <id> --item-prefix <name>`. The script runs the replay with `--hold-item "Table lamp (mushroom"` and waits for it to settle. It uploads the lamp photo, sends the saved chat text and waits for the lamp. It then checks that the project has 45 items and no failed jobs, saves a snapshot and sends SIGINT. Finally it checks that `result.json` shows a clean process audit and that every recorded process and both ports are free. A second run is interrupted mid-replay and checked the same way.

**B27.** A held item recreated by the chat request takes its current placement from the source project, not the placement in the saved `asset_generate` call, since the user may have moved it after it was generated. `replay.ts` passes the held names to the fake agent in `DEMO_HELD`, and `replayDesignerTurn()` replaces the call's whole `placement` with that of the held item of the same name. The B24 gate also checks the lamp lands within 1 mm of its source placement.
