# D1 — `normalize.py` and `recolor.py` for M3

Read `docs/work-packages/README.md` first. Spec: `docs/PLAN.md` sections 3 (normalization rules, the `colorize` formula, `referenceLuma`) and 5.1 steps 3–4; `docs/DESIGN.md` section 6 (points and lines); `docs/spikes/s4-blender-headless.md` (how the scripts run, known gaps).

## Scope (`blender/normalize.py`, `blender/recolor.py`, `blender/glb_io.py`, `blender/spikes/`, new `blender/tests/`)

Other agents own `blender/procedural/` (S7) and `blender/catalog/` (B4); do not edit those.

1. **`normalize.py`** adds, per PLAN 5.1 step 3:
   - decimate to the triangle budget (150k), keeping UVs;
   - `colorMask.png`: cluster the base colour texture and mark the largest colour region (the upholstery, not the legs);
   - `referenceLuma`: median luma of the masked region (whole texture with no mask), above 0, written into its `RESULT` JSON;
   - `points.bin`: 8,000 area-weighted surface samples with position and texture colour (document the binary layout in the script's docstring);
   - a proxy mesh of about 2,000 triangles with edges at a 30° threshold joined into polylines sorted by length (DESIGN 6 option 1), as `lines.bin`; S2 may later pick the screen-space option instead, so keep this self-contained;
   - `thumb.png` through the existing `thumbnail.py`;
   - take the full expected size (width, height, depth) as well as the largest dimension, and report the proportion check from PLAN 5.1 step 4 in `RESULT`;
   - reject skinned meshes and morph targets with a clear error (S4 gaps);
   - bake a non-white `baseColorFactor` into the texture first (S4 gap).
2. **`recolor.py`** switches to the PLAN 3 `colorize` formula (shading = pixel luma ÷ max(`referenceLuma`, 0.02), `referenceLuma` 0.5 when absent; result = clamp(target × shading); mix by strength), applied inside `colorMask.png` when present, keeping JPEG textures JPEG.
3. Update S4's checker (`blender/spikes/s4-check.ts`) where it asserts the old formula ("luma within 0.03"), replacing it with the M3 check: a white and a black asset colorized to blue at strength 1 each have a mean colour near the target and a non-zero luma spread.

## Rules

- Blender runs do not take the machine lock. Blender binary: `/Applications/Blender.app/Contents/MacOS/Blender`, run as in S4 (`--background --factory-startup --python-exit-code 1`).
- You are a Codex agent: you have no `advisor` tool. Make routine calls where the docs are silent and list them in your final message; for a contract question (for example a new `AssetMeta` field), stop and report.

## Gate

1. `blender/spikes/s4-roundtrip.sh` still exits 0 (with the updated recolor check).
2. `blender/tests/run.sh` exits 0: on the S4 fixtures plus a white and a black textured fixture, every output file exists and is well formed (`points.bin` has 8,000 records, `lines.bin` parses, `colorMask.png` matches the texture size), triangles ≤ 150k, the proportion check reports correctly for a right and a wrong expected size, recolor to blue meets the M3 check, and a skinned fixture is rejected.
