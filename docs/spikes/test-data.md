# Experiment data

Use synthetic scenes or data cleared for redistribution in committed tests. Keep real captures, project exports, point clouds, reconstructed layouts, and screenshots of personal spaces outside Git.

Historical experiment scripts take separate datasets. Keep dataset annotations local. These paths are ignored:

| Experiment | Local input |
| --- | --- |
| Room geometry | `python/spikes/s1/picks.json` with reference dimensions under `roomM` |
| Image-to-3D comparison | `python/spikes/s2/inputs.json` |
| Segmentation and manual reconstruction gates | `python/spikes/s3/boxes.json`, `boxes-all-photos.json`, and `viewpoints.json` in the same folder |
| Procedural Blender modelling | `blender/procedural/objects.json` |
| Visual evidence | `docs/work-packages/evidence/` |

The segmentation viewpoint file uses `order` for photo stems in capture order and `bestPhoto` for the photo stem keyed by item. The automated suite uses synthetic data and fake agent CLIs.

For manual reconstruction scripts, set `PLANNER_B6_DIMENSIONS_M` to a JSON array of width, length, ceiling height, and scale height in metres. Set `PLANNER_B7_BENCHMARK` to a JSON object with `overviewPhoto`, `scaleHeightM`, `expectedSizes` (entries with `name`, `width`, `height`, and optional `depth`), `targets` (item `name`, name regex `pattern`, and `walls` from `right`, `left`, and `window`), and `floorOrder` (target names from the window end). Use the matching local photo directory and box annotations for each script.
