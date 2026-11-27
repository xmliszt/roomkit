# S2 — Image to 3D

Read `docs/work-packages/README.md` first. Spec: `docs/PLAN.md` sections 0 (realism bar; model and copy rules), 3 (normalization), 5.1 and 7 (rules above the table, row S2); `docs/DESIGN.md` section 6 (lines, coarse shape); `docs/spikes/s3-segmentation.md` (your in-room inputs); `docs/spikes/s4-blender-headless.md`; `docs/work-packages/s7-agent-blender.md` (the competing path; your results go side by side with it).

## Question

Which local image-to-3D model gives the most realistic textured furniture from a photo on this machine, and is it better than S7's agent-built Blender models for some object types?

## Inputs

- **In-room:** S3's five sets in `~/.cache/interior-planner-spikes/s3/s2/` (sofa, fridge, coffee table, floor lamp, guitar): full oriented photo, binary mask, RGBA crop.
- **Product photos:** find 5 clean product photos on the web (a sofa, an armchair, a side table, a floor lamp, a shelf; white or plain background). Save them in `~/.cache/interior-planner-spikes/s2/products/` with their source URLs in a text file. Never commit them.

## Candidates

1. TRELLIS.2 via `mlx-spatial` (`microsoft/TRELLIS.2-4B`; DINOv3 and RMBG-2.0 from ungated copies per PLAN 0; or use S3's masks in place of RMBG).
2. SAM 3D Objects via `mlx-spatial` (`appautomaton/sam-3d-objects-mlx`; takes image + mask).
3. Hunyuan3D 2.1 (`tencent/Hunyuan3D-2.1`, shape + texture).
4. TripoSG (`VAST-AI/TripoSG`; check whether it textures; if shape only, say so).
Skip any that cannot run on Apple Silicon within a reasonable porting effort (say what blocked it). Use each tool's own author or `mlx-community` copies first; safetensors only from copies.

## Steps

1. Per candidate and input: GLB, time, peak memory (measured runs under `scripts/machine-lock.sh s2 …`; downloads and Blender without the lock), then `blender/normalize.py` to the measured size (in-room objects: `docs/spikes/test-data.md`, others: the product's listed size). Report each generator's output up axis, front axis and unit scale (M3 needs them for `--source-up` and `--source-front`).
2. Run the PLAN 5.1 gate checks on each output (validator, proportions within 20%, triangles ≤ 150k after decimation, file ≤ 25 MB, textures ≤ 2048 px).
3. Screenshot each in three.js with DESIGN 5 lighting, with and without a neutral environment map, from the photo's angle, the same way S7 does.
4. Line rendering test on one generated GLB (DESIGN 6: proxy-mesh edges versus a screen-space edge pass, 1 CSS px on retina), and whether the generator can report a coarse shape mid-run.

## Rules

- Weights in `~/.interior-planner/python/weights/<model>/`. Limit: 20 GB per model and 70 GB for S2 in total; list each file and size before downloading; above a limit, stop and report. Delete the weights of models that lose before you finish.
- Own uv project at `python/spikes/s2/`. Outputs in `~/.cache/interior-planner-spikes/s2/`. Never copy photos into the repo.
- 10 min per object per model is the pass limit; stop a run at 20 min.

## Results for the user, in `~/.cache/interior-planner-spikes/s2/results/`

- `compare.png`: one row per in-room object: photo crop, S7's model (from `~/.cache/interior-planner-spikes/s7/`, if it exists for that object), then each S2 model. A second sheet for the product photos.
- `viewer/index.html` like S7's, listing every model from both spikes, with the environment-map toggle.

## Gate

`uv run --project python/spikes/s2 python python/spikes/s2/check.py` exits 0: it reads saved outputs (no reruns), checks each chosen GLB passes the PLAN 5.1 gate, prints the time, memory and pass table, and regenerates both sheets and the viewer.

## Report (`docs/spikes/s2-image-to-3d.md`)

The table per model and input; which model wins per input type (product photo, in-room crop); which object types S2 beats S7 on and which S7 wins; axes and units per generator; line rendering result; coarse-shape answer; what M3 should take.
