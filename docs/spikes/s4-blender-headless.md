# S4 — Headless Blender round trip

Result: **pass**. The Blender that `brew install --cask blender` installs runs headless on this Mac and round-trips a GLB with the right size, axes and anchor. three.js r187 loads every output, and the Khronos validator reports 0 errors and 0 warnings on all of them. The 5.2 LTS fallback is not needed.

Gate: `blender/spikes/s4-roundtrip.sh` exits 0.

## Blender

| | |
|---|---|
| Version | 5.3.0 (hash `02f0899d78e3`, built 2026-11-10) |
| Install | `/opt/homebrew/bin/brew install --cask blender` |
| App | `/Applications/Blender.app` |
| Binary | `/Applications/Blender.app/Contents/MacOS/Blender` |
| Wrapper on PATH | `/opt/homebrew/bin/blender` (a shell script that execs the binary) |
| Render engine in `--background` | `BLENDER_EEVEE` works; no fallback was needed |

The cask is not pinned. It installs 5.3.0 today, which is newer than the plan's fallback (5.2 LTS), and it will move again. Settings and preflight should record the detected version, and the gate should be rerun after an upgrade.

## How the scripts are run

```
blender --background --factory-startup --python-exit-code 1 --python <script> -- <args>
```

- `--python-exit-code 1` is required. Without it a Python exception still exits 0.
- `--factory-startup` keeps the user's Blender preferences and add-ons out of the run.
- Each script starts from `read_factory_settings(use_empty=True)`, so the default cube is never in the scene.
- Each script prints one `RESULT <json>` line. `normalize.py` reports `nativeSizeM`, `triangleCount` and the scale it applied.
- The gate reads the binary from `BLENDER`, and falls back to the app path above.

| Script | Arguments |
|---|---|
| `normalize.py` | `--input --output --mount floor\|wall\|ceiling --expected-size <m> [--source-up=+Y] [--source-front=+Z]` |
| `recolor.py` | `--input --output --color '#RRGGBB' [--strength 1]` |
| `thumbnail.py` | `--input --output [--size 512]` |

## Time per script

M1 Pro, warm file cache, range over three recorded gate runs.

| Script | Chair (84 triangles, 64 px texture) | Duck (4,212 triangles, 512 px texture) |
|---|---|---|
| `normalize.py` | 1.1–1.6 s | 1.2–1.4 s |
| `recolor.py` | 1.1–1.5 s | 1.2–1.3 s |
| `thumbnail.py` (512 px, EEVEE) | 1.4–1.9 s | 1.5–1.6 s |

Almost all of this is Blender starting up. The first launch after install took 7.6 s. The whole gate (15 Blender runs, Chromium, validator) takes about 25 s.

## Output sizes

| Case | Source | `model.glb` | `recolored.glb` | `thumb.png` |
|---|---|---|---|---|
| chair, floor | 11,520 B | 11,364 B | 11,368 B | 156,788 B |
| chair, wall | 11,520 B | 11,372 B | 11,376 B | 156,812 B |
| chair, ceiling | 11,520 B | 11,332 B | 11,336 B | 156,863 B |
| chair with JPEG texture, floor | 12,140 B | 11,980 B | 12,016 B | 153,662 B |
| duck, floor | 120,484 B | 119,680 B | 146,920 B | 139,164 B |

The duck grows by 27 KB on recolor because Blender re-encodes the changed 512 px PNG.

## What the gate checks

Inputs, all in `blender/fixtures/`:

- `chair-wrong-axes.glb`, built by `build_fixture.py`: a 0.6 × 0.9 × 0.5 m chair written with +Z up and +X front, 2.5× too large and off the origin. It has named parts (`seat`, `back`, `arm` on the right side only, `leg_1`–`leg_4`) and a 64 px grey and brown texture. It runs with all three mounts.
- `chair-jpeg-texture.glb`, the same chair with a JPEG texture (`build_fixture.py --image-format JPEG`). It runs as a floor item.
- `duck.glb`, the Khronos sample Duck (+Y up, facing +X, a 0.01 node scale, a camera node, a 512 px texture). It runs as a floor item with an expected size of 0.25 m.

`s4-check.ts` loads each output with `GLTFLoader` (three 0.187.0) in headless Chromium through Playwright and asserts:

- Size per axis, within 1 mm. The expected values are computed in JavaScript from the source GLB and the declared source axes, not taken from Blender.
- Anchor at the origin, within 1 mm: floor = bottom centre, wall = centre of the back face, ceiling = top centre.
- Orientation: the offset of the area-weighted centroid from the box centre matches the source's, mapped through the declared axes. A bounding box alone cannot see a 180° turn or a mirror; this can. The duck is almost symmetric left to right (1.1 mm offset), so the chair's arm is the reliable mirror test.
- Chair parts: back behind and above the seat, all four legs below it, arm on +X.
- Signed volume is positive and equals the source's times the scale cubed, so an inside-out mesh fails.
- No mesh node has a transform, the triangle count equals the source's, and the base colour texture has the source's size and mean colour.
- The duck's centroid offset also matches a fixed value, 0.0011 −0.0216 0.0057 m, so a wrong declared front in the gate itself fails.
- Image types: `model.glb` and `recolored.glb` keep the source's (`image/png` or `image/jpeg`). `recolor.py` exports JPEG when every recoloured image was JPEG; without that, Blender writes the edited texture as PNG.
- Recolor: geometry unchanged; the decoded texture's mean colour moved to blue; its luma stayed within 0.03.
- Thumbnail: 512 × 512, between 5% and 95% opaque, more than 50 colours.
- Khronos validator (`gltf-validator` 2.0.0-dev.3.10): 0 errors on every `model.glb` and `recolored.glb`.

Wrong outputs were tried by hand, and each failed the check: front `-X` on the duck and on the chair, a wall-mounted chair in the floor case, and, by the cold reviewer, an X mirror of each fixture, a 0.5% size error, a recolor at strength 0 and a transparent thumbnail. The reviewer's inside-out mesh passed at the time; the signed volume assertion was added for it.

The thumbnail is rendered from `recolored.glb`, so it also shows the recolor result.

## Axis and unit findings

- **No unit surprise.** The glTF importer and exporter both work in meters with no scale factor.
- **The importer maps file (x, y, z) to Blender (x, −z, y)**, and the exporter reverses it with `export_yup=True`. `normalize.py` works in Blender space: source up goes to Blender +Z, source front to Blender −Y, which export as +Y up and +Z front. The round trip confirms the mapping.
- **Source axes cannot be detected from geometry.** `normalize.py` takes them as `--source-up` and `--source-front`, in glTF file coordinates, with the glTF defaults (+Y up, +Z front). The Khronos Duck faces +X, so real assets do not all follow the default. In M3 the generator's known output axes, or the `modeler` agent, must supply these values.
- **The axis arguments need the `=` form** (`--source-front=-X`). argparse reads a separate `-X` as an option and exits 2.
- **Node transforms are baked into the vertices.** The output has one node per mesh, all at identity, no parents, and no cameras or lights. The Duck's 0.01 node scale and camera node are handled this way. Skinned or animated models are not supported; export drops animation.
- **Image pixels in Blender are sRGB-encoded for 8-bit textures**, with no conversion on read or write. The first fixture came out darker than intended because of this.
- **The exporter writes edited pixels** when the image is updated and packed after the edit. The check decodes the output texture to confirm it.

## Needs a decision

### 1. The `colorize` formula conflicts with PLAN section 3 for white and black

**Decided.** The chief engineer replaced the formula in `docs/PLAN.md` section 3 on the orchestrator branch: shading = luma / referenceLuma, result = clamp(target × shading), mixed by `strength`. `recolor.py` in this package still uses the W3C "color" blend described below. M3 replaces it and tests the new formula. The rest of this section records what the spike found.

PLAN section 3 says `colorize` "keeps luminance; works on grey, white and black". Both cannot hold: a pixel that keeps the luminance of white is white. `recolor.py` keeps luminance. It uses the W3C compositing "color" blend: the hue and saturation of the target colour with the luminance of the pixel (luma weights 0.3, 0.59, 0.11), computed on sRGB-encoded values, then mixed with the pixel by `strength`. It gives the same result as CSS `mix-blend-mode: color`.

Colorized to `#1E50E6` at strength 1:

| Input (sRGB) | Output |
|---|---|
| grey 0.5 | 0.33 0.49 1.00 |
| near-white 0.95 | 0.93 0.95 1.00 |
| white | unchanged |
| near-black 0.05 | 0.00 0.05 0.19 |
| black | unchanged |

So grey furniture recolours fully, and white or black furniture barely changes. To recolour those, the formula must also move luminance toward the target's (for example a blend of the pixel's and the target's luminance by `strength`), which drops "keeps luminance". The constraint that decides it: a white item at strength 1 must come out in the target colour with its shading still visible. A formula that needs a reference luminance per asset would add a field to `AssetMeta`, which is a contract change. The orchestrator should take this to the chief engineer before M3. Whatever is chosen, **the M3 material shader must use the same formula as `recolor.py`**, or a variant's baked texture will not match the live preview.

### 2. What the wall anchor is

"Back centre" is read as the centre of the back face: centred in width and height, with the back face on the plane z = 0. The editor's `heightM` then measures to the centre of the item, so the charging port at `heightM` 0.3 has its centre 0.3 m above the floor. If Track A treats `heightM` as the height of the item's bottom edge, the wall anchor in `normalize.py` must move to the bottom edge of the back face. The two must agree before the first wall asset is normalized.

### 3. Root `pnpm check`

`blender/spikes/` has its own `package.json` and lockfile, installed with `--ignore-workspace`. `s4-check.ts` imports `three`, `playwright` and `gltf-validator`, which the root workspace may not have. If root typecheck or biome picks the folder up on the integration branch, exclude `blender/spikes/`.

## Routine calls where the docs were silent

1. **Arguments are checked by argparse**: `--expected-size` must be finite and above 0, `--color` must be `#RRGGBB`, `--strength` must be from 0 to 1, and the thumbnail `--output` must end in `.png`. A bad argument exits 2; a failure inside the script exits 1.
2. **Thumbnail**: transparent background, 512 px, 30° lens from the front right and above, one sun plus a uniform white world, "Standard" view transform so texture colours are not tone-mapped.
3. **A material with no base colour texture** gets the same colorize applied to its base colour factor. No gate case covers this path; the cold reviewer ran it once by hand (grey 0.6 became 0.46 0.60 1.00).
4. **Recolor covers the whole base colour texture.** The colour mask is M3 work, so the chair's legs are recoloured too.

## Known gaps in these first versions

- A material with both a base colour texture and a non-white `baseColorFactor` keeps its factor after recolor, so the result is the target colour multiplied by the factor. M3 should bake the factor into the texture first.
- No fixture has a mirrored (negative-scale) node. `bake_world_transforms` flips the normals for that case; the cold reviewer checked it by hand on a chair with a `[-1, 1, 1]` node scale.
- 16-bit and float textures were not tested. Blender may hold them as linear floats, and `colorize` assumes sRGB-encoded values.
- `normalize.py` does not reject a skinned mesh; it drops the armature and exports the rest pose.
- Morph targets are not baked with the node transform (`mesh.transform` in `bake_world_transforms` runs with `shape_keys=False`), and a GLB that has them is not rejected.
- `normalize.py` takes one expected size (the largest dimension). The PLAN 5.1 proportion gate needs expected width, height and depth. M3 decides whether the script takes all three or the gate computes proportions from `nativeSizeM`.

## Not covered (M3 work, as the brief says)

Colour mask, `points.bin`, decimation, line data, the `shift` adjustment, the gate's proportion and budget checks, and `build-procedural`.

## Fixture licence

`duck.glb` is from `KhronosGroup/glTF-Sample-Assets` (`Models/Duck`), copyright Sony Computer Entertainment, under the SCEA Shared Source License 1.0. It is a test input only. The notice is in `blender/fixtures/duck.LICENSE.md`.
