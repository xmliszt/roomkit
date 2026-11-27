# B13 — Demo replay: rerun a finished project's pipeline for recording, with no agent or model runs

Read `docs/work-packages/README.md` first. Spec: `docs/PLAN.md` section 3 (reconstruction, inventory and generation contracts); the fake workers and fake CLIs used by `gate:b6`, `gate:b7` and `gate:b10` (`scripts/b6/`, `test/fake-cli/`).

## Goal

The user wants marketing footage of the real app: room measuring (walls rise), furniture boxes appearing, each piece modelled with the appearing animation, the camera on the whole room. A real run costs about $10–25 of plan usage and 75 minutes. Replay a finished project instead, with the real daemon and the real web app, but with workers and agents that return that project's saved results.

## Scope (`scripts/demo/`, fake fixtures, `README.md`; no product code changes unless a hook is missing, then the smallest one, reported)

1. `scripts/demo/replay.ts <finished-project-folder> [--piece-seconds 6] [--recon-seconds 20]`: starts a daemon on free ports with temp `PLANNER_HOME` and `PLANNER_PROJECTS` and a web app pointed at it; creates a new project with the same photos; uses a fake python that returns the saved reconstruction (`recon/`), segmentation and measurement results, a fake surveyor that submits the saved inventory, and a fake modeler that returns each saved asset (`assets/<id>/` with its `points.bin`, `lines.bin`, thumbnails), each after the given delay, so job events and the UI behave as in a real run. Pieces generate two at a time as in a real run. Prints the project URL.
2. `--record <out.webm>`: records the web page at 1440 × 900 with Playwright from project open until the last piece is ready, labels off, plus a final screenshot. Then `ffmpeg` writes an MP4 beside it.
3. Never touches `~/InteriorPlanner` or `~/.interior-planner`; the source project is read only.

## Rules

You are a Codex agent with no `advisor` tool: follow the README's Codex rule. Do not stop the user's running app (ports 3210 and 4820).

## Gate

`scripts/demo/replay.ts /path/to/project --piece-seconds 3 --recon-seconds 10 --record <tmp>/demo.webm` exits 0 in under 5 minutes; the MP4 exists; the final scene has the same items and assets as the source; no `claude`, `codex` or model worker process was started (check the process list in the script).
