# B28 — Replay realistic photo rendering

`scripts/demo/prepare-replay.ts` copies saved `renders/*.png` into the replay source and records their filenames newest first by modification time. `fake-blender.mjs` handles `render_photo.py` by copying the newest saved PNG to the job's `render.png`, reporting four sample progress lines. It uses Node only. Missing saved renders fail with an explicit message. `replay.ts --render-seconds <seconds>` controls the delay (default 3 s, 0 skips the delay).

The snapshot modal shows the completed render using the existing project render route. Render jobs finish with the existing `done` stage.

Gate: `pnpm exec vitest run test/fake-cli/replay-render.test.ts test/fake-cli/whole-project-replay.test.ts`, then `node scripts/demo/verify-replay-render.ts /path/to/project`. The script uses `--piece-seconds 1 --recon-seconds 3`, takes a snapshot, presses `Render realistic photo`, checks sample progress and completion, decodes the rendered image in the modal, and checks no failed jobs and a clean process audit. Screenshot: `evidence/b28-replay-render/render.png`. Source is read only; all runtime data and ports belong to the temporary replay.

Gate result: 2 focused tests passed; root and web typechecks passed; scoped Biome check passed with the modal's existing `noImgElement` warning. Replay: 45 items, 43 saved assets, 78 s, 277 observed processes, no failed jobs or process violations. Render: `done`, 3.14 s, sample progress observed, modal image decoded. Cold review: no findings. Screenshot critique: the image, both actions and completion message fit inside the modal at 1440 × 900.
