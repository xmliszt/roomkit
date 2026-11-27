# B29 — Render the replay's own scene

Scope: `scripts/demo/`, `test/fake-cli/replay-render.test.ts`, this document and `evidence/b29-replay-real-render/`. No scene, command, WS or MCP contract changes.

`render-replay-state.ts` reads a project and a `RenderView`, exports with `exportRenderScene`, then calls `runPhotoRender` under the existing machine lock. It uses real Blender and the unchanged `blender/render_photo.py`, including evening lighting whenever a lamp is on. Default output is 1920 px on the long side at 192 samples. `BLENDER` overrides the normal Blender candidates. Temporary job files are removed; the PNG and `<out.png>.json` metrics remain. Output must be new and outside the input project. Run this step after stopping the replay.

`replay.ts --render-image <png>` makes fake Blender copy that image instead of the newest saved render. `--render-seconds` still controls fake progress. Without the option, B28's behavior remains.

## Capture and record

1. Run `node scripts/demo/replay.ts <source-project-folder>`. Use the printed temporary project URL and `Replay data` folder. The original project stays read only.
2. Make the desired edits in this replay. Take a snapshot, then press **Render realistic photo**. Keep the scene unchanged between the snapshot and capture. This first fake render can show the old saved image; its job exports the exact snapshot `RenderView`. Find its job ID under `<replay-data>/projects/<project-id>/.planner/render/`.
3. Run `node scripts/demo/capture-replay-state.ts <replay-data>/projects/<project-id> <render-job-id> /tmp/roomkit-shot`. This copies the project into `/tmp/roomkit-shot/project` and writes `/tmp/roomkit-shot/render-view.json`. It rejects an existing output or a scene revision different from the selected job. Wait for the fake render to finish before capturing so the project save is flushed. Do not edit during the copy.
4. Stop the replay with Ctrl-C and wait for its clean process audit. Run `node scripts/demo/render-replay-state.ts /tmp/roomkit-shot/project /tmp/roomkit-shot/render-view.json /tmp/roomkit-shot.png` as a separate process.
5. Replay the original source again with `--render-image /tmp/roomkit-shot.png`, repeat the edits and camera used for the captured snapshot, and record. The option chooses an image; it does not restore the captured scene or camera. Press **Render realistic photo** to show the new image in the modal.

The separate capture script uses the existing render job export instead of adding browser hooks or changing product contracts. Capture only a temporary replay project, never the source folder. Each replay allocates its own ports and runtime directories. The real renderer inherits the login environment and overrides `PLANNER_HOME` and `PLANNER_PROJECTS` with temporary paths.

## Gate

- `pnpm exec vitest run test/fake-cli/replay-render.test.ts test/fake-cli/whole-project-replay.test.ts`
- `node scripts/demo/verify-replay-real-render.ts /path/to/project`

The second command replays twice, recolours the sofa green with the same `scene.apply` / `item.update` command the inspector uses, switches lamps on, snapshots, captures, stops the first replay, renders with real Blender, and checks the second modal's decoded image bytes against the new PNG. It also checks equal render views, no failed jobs, both process audits, unchanged source `project.json`, and non-default ports. Temporary captures stay outside the repository. Evidence: `snapshot.png`, `render.png`, `side-by-side.png` (snapshot left, render right), `modal.png`, render metrics and `result.json` under `docs/work-packages/evidence/b29-replay-real-render/`. The gate refuses to overwrite the render; move previous evidence before rerunning.

## Cold review

| Finding | Bucket | Severity / likelihood / scope | Resolution |
| --- | --- | --- | --- |
| Chromium launch outside verifier cleanup | act | medium / missing browser / gate processes | Move launch inside `try` and close the optional browser in `finally`. |
| Two verifier stop calls send two interrupts | act | medium / interrupt during cleanup / gate processes | Share one shutdown promise. |
| Sofa substring matches a dining chair; fixed delay captures unfinished load-in | act | medium / supplied room / gate evidence | Match the sofa name prefix and wait for load-in with reduced motion. |

First review found the Chromium launch cleanup gap. Second review found repeated shutdown signals. The snapshot inspection found the gate selection and loading errors. Both final review rounds had no remaining findings. The rerun-evidence question was dismissed because the documented manual gate requires moving previous evidence before rerunning; exclusive creation preserves the real render.

Gate result (2026-11-25): 14 focused tests passed across replay and daemon render suites; root and all workspace typechecks and scoped Biome passed. Real Blender 5.3 rendered the green two-seat sofa with the pendant on at 1920 × 1200, 192 samples, GPU, 75.81 s, peak RSS 6,795,689,984 bytes. First replay: 291 observed processes; second: 275. Both had zero process violations and failed jobs. The second modal decoded the exact supplied PNG, the views matched, and source `project.json` was unchanged. Daemon/web ports were 55222/55223 and 55536/55537. Evidence inspection confirms the green sofa and loaded furniture in both images. Final cold review: Ship: yes; no remaining findings or orchestrator decisions.
