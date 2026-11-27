# Replay a saved project

```sh
node scripts/demo/replay.ts /path/to/project --piece-seconds 6 --recon-seconds 20
node scripts/demo/replay.ts /path/to/project --piece-seconds 3 --recon-seconds 10 --record /tmp/planner-demo/demo.webm
node scripts/demo/replay.ts /path/to/project --piece-seconds 1 --recon-seconds 3 --max-appearing 8
```

Replay starts the real daemon and web app on free ports, prints the project URL, and opens Chromium. It copies a snapshot of the source into a temporary folder before starting the pipeline. The source stays read only; later modelling changes belong to the next replay. Saved inventory and generation records are required, including the photos, reconstruction, measurements, masks and asset sidecars. Items added outside that inventory without a saved inventory generation source are rejected.

Fake executables return those saved results through the existing pipeline. Two pieces generate at once. Items still waiting for a model in the source remain boxes. Deleted items stay deleted; duplicates reuse their saved generation source. Item and job IDs are new, and generated asset IDs are new; models and animation sidecars are checked byte for byte. Saved room and item edits are restored before the final frame. Modelled boxes use the saved asset’s native dimensions during generation, so a resized item’s alternative still passes the model gate; its display dimensions are restored afterward. The camera frames the whole room and labels start off. `--max-appearing <n>` lets up to `n` items play the appearing animation at once (3 by default) in the replay's own web app only.

Without `--record`, the temporary app stays open until Ctrl-C or the Chromium window closes. With `--record`, Playwright records at 1440 × 900, saves a final PNG beside the WebM, and ffmpeg writes the MP4 beside it. Chromium must be installed (`PLAYWRIGHT_SKIP_BROWSER_GC=1 pnpm exec playwright install chromium`), and ffmpeg must be on PATH. Recording exits after the final appearance animation. Existing WebM, MP4 or PNG output is refused, as is output inside the source project.

The printed temporary folder retains the copied source, replay project, `result.json` (with `peakAppearing`, the most items seen appearing at once), fake-executable calls and a process-list audit. Only replay descendants are inspected and stopped; existing app processes and ports 3210/4820 are left alone. No real agents, Blender or model workers run. Remove the temporary folder when the evidence is no longer needed.
