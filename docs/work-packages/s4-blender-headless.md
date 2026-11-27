# S4 — Headless Blender round trip

Read `docs/work-packages/README.md` first. Spec: `docs/PLAN.md` sections 3 ("Rules that make the features work": normalization), 5.1 step 3, 5.4 and 7 row S4.

## Question

Does the Blender that `brew install --cask blender` installs run headless and round-trip a GLB with the right size and axes?

## Steps

1. `/opt/homebrew/bin/brew install --cask blender` (the native Homebrew; `/usr/local/bin/brew`, first in PATH, builds from source). You have the user's permission for this install. Record the version and path.
2. Write first versions of `blender/normalize.py`, `blender/recolor.py` and `blender/thumbnail.py`, each run as `blender --background --python <script> -- <args>`:
   - `normalize.py`: import a GLB; fix axes to +Y up, +Z front; move the anchor to the origin (bottom centre for `floor`, back centre for `wall`, top centre for `ceiling`); scale uniformly so the largest dimension matches an expected size in meters; export GLB. Colour mask, `points.bin`, decimation and line data are later work (M3); leave them out.
   - `recolor.py`: apply a `colorize` adjustment (PLAN 3 `ColorAdjust`) to the base colour texture and export.
   - `thumbnail.py`: render `thumb.png` of a GLB.
3. Test inputs: one GLB you build in Blender inside the script (a box with legs, known size, wrong axes on purpose), and one public sample GLB with a texture (for example from the Khronos glTF sample models). Keep test GLBs under 2 MB and put them in `blender/fixtures/`.
4. Check the output in three.js (r187). Texture decoding in Node is unverified (PLAN 5.1 step 4), so either assert bounding box and anchor in Node from the geometry only, or load the GLB with `GLTFLoader` in headless Chromium (Playwright). Either way assert the bounding box size and that the anchor is at the origin, and run the Khronos glTF validator on each output. Keep the script and its `package.json` inside `blender/spikes/` so it does not touch the root workspace another agent is building.

## Paths

`blender/` only, plus `docs/spikes/s4-blender-headless.md`.

## Gate

`blender/spikes/s4-roundtrip.sh` exits 0: it runs normalize, recolor and thumbnail on both fixtures, then the three.js check and the validator, and prints sizes.

## Report (`docs/spikes/s4-blender-headless.md`)

Blender version, time per script, output sizes, any axis or unit surprises. If the Homebrew build fails, follow PLAN 7: pin 5.2 LTS from blender.org and report.
