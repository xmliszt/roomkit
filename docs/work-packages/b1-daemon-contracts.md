# B1 — Project contracts, file routes and socket auth

Read `docs/work-packages/README.md` first. Spec: `docs/PLAN.md` sections 2 and 3 (including the WebSocket protocol M0 wrote there) and 4. This package changes contracts in `packages/shared`; the chief engineer signs off on the shapes, so call the advisor with the proposed schemas before you write the code, and again with the diff.

## Scope (`packages/shared`, `packages/daemon`)

1. **Project commands over WS:** `project.rename` and `project.remove`, with events, acks, tests. Remove deletes the project folder only after the ack path is safe (decide with the advisor whether it moves to a trash folder instead).
2. **File routes over HTTP,** with the same Origin and Host checks as the WS server, and the token rule for clients with no Origin:
   - photo upload into `photos/` (HEIC accepted; conversion is M4's, store as received);
   - `.iplan` export (zip of the project folder) and import (unzip into a temp folder, validate `project.json`, assign a new project id, then move into place; reject archives with paths outside the folder);
   - snapshot PNG save into `snapshots/<timestamp>.png`;
   - asset files read (`assets/<assetId>/model.glb`, `thumb.png`, `meta.json`) for the editor.
   Pick a zip library or use a small built-in approach; name the dependency and its size in your last message.
3. **Catalog asset:** the charging port (PLAN 4: wall-mounted, faceplate 0.086 × 0.086 × 0.01 m, default height 0.3 m) as a checked-in GLB plus `meta.json` that passes `AssetMetaSchema`, and the daemon copies it into a project's `assets/` when an item using it is added. Build the GLB with the existing headless Blender scripts (`blender/normalize.py`; Blender is installed) or a small generator script; wrap Blender runs in `scripts/machine-lock.sh b1 <command>`.
4. **Sockets with no Origin send nothing until `auth.ok`:** no snapshot, no events. Update PLAN's protocol text and the tests.
5. **`createProject` failure:** if the first write fails, the project must not stay loaded; remove what was created and return the error. Test it.
6. **Chat event shapes, proposal only:** how a chat message, its streamed text and its blocks travel over WS (event kinds and fields). Write the proposal into PLAN section 3 marked "proposed, needs sign-off", get the advisor's sign-off, and implement only the schemas if approved. No chat runtime.

## Gate

1. `pnpm check` passes, with tests for every new command, route and rule above.
2. `pnpm gate:m0` still passes.
3. A new `pnpm gate:b1` script (free ports, temp `PLANNER_HOME` and `PLANNER_PROJECTS`): create a project, add a charging port item, upload a photo, save a snapshot PNG, export `.iplan`, import it, check the imported project has a new id and the same scene and files, rename it, remove the original, and check that a socket with no Origin gets nothing before `auth.ok`.
4. PLAN sections 2 and 3 describe every new contract.
