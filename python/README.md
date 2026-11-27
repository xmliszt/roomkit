# Reconstruction workers

Install with `uv sync --project python --frozen`. Run a worker with
`uv run --project python python python/workers/<name>.py`, passing one JSON object
on stdin. Stdout contains JSON lines: `{kind:"progress",stage,progress?}` followed
by `{kind:"result",result}`. Failures emit `{kind:"error",message}` and exit 1.
Library output goes to stderr. A progress heartbeat is emitted every five seconds.

All paths are explicit. Workers neither download weights nor choose a user home
folder. `weightsDir` contains `map-anything`, `sam3-mlx-bf16`, and
`sam2.1-hiera-large`. Models run in separate worker processes, one job at a time.

## Image to 3D

Run `generate_trellis.py` or `generate_sam3d.py` with
`{name,photoPath,maskPath?,weightsDir,outputDir}`. The photo is EXIF-oriented before
matching an optional full-size mask. Masks use 0/255 pixels in that upright image.
Photos and masks are capped together at a 1536 px long side. Sources stay unchanged.

Without a mask, the worker segments the object with SAM 3 from `name` (the text
before any parenthesis) when SAM 3 is installed, and otherwise uses RMBG-2.0's
matte, even one covering most of the frame. It fails only when the matte is empty;
that error and a missing `name` are sent with `isUserFacing: true`. TRELLIS.2 always receives an RGBA crop and never runs RMBG
itself; SAM 3D receives the whole photo and mask.

Both use seed 42, 1024 px textures and a 150,000-face target. TRELLIS.2 uses
pipeline `512`. SAM 3D uses `balanced` memory limits. Only its worst-case
FlexiCubes precheck at resolution 256 is skipped; actual surface and edge
estimates still pass through the library's 6 GB guard. Library patches are
restored after each run.

The result and `metrics.json` contain `glbPath` (absolute), `sourceUp:"+Z"`,
`sourceFront:"-Y"`, `model`, `maskSource`, `durationSeconds`, `stageSeconds`,
`maxSilentSeconds`, `sampleSteps`, `swapUsedMb`, `peakRssGb`, `mlxPeakGb`, and
`peakMemoryGb` (the larger of RSS and MLX peak, a lower bound on combined memory).
The GLB has arbitrary units, with its longest side about 1, rather than metres.
TRELLIS.2's front is an assumption: S2 found one flipped fridge among four
clearly fronted objects. A later model-selection step must verify the front
before normalization; these workers do not make that visual judgment.

Exports use a temporary `outputs/` directory because the library requires it.
Completed artifacts are retained in unique `run-<uuid>/` directories. Only after
export succeeds is `metrics.json` published atomically with the new GLB path.
A failed inference or metadata write leaves previous models usable. A completed
but unpublished generation can remain after a failed metadata write.
Workers load only local files and do not download weights. `weightsDir` needs
`trellis2` (including `microsoft/TRELLIS-image-large` below it),
`dinov3-vitl16-pretrain-lvd1689m`, `rmbg2`, `sam3-mlx-bf16`, and `sam-3d-objects-mlx` (MoGe included).
The sparse decoder has its own registry entry because it comes from a different
repository. Install that entry after TRELLIS.2 if both are missing.

`scripts/machine-lock.sh c3 scripts/gate-c3.sh` runs both workers on S3's sofa
photo/mask and the HEKTAR product photo, generating the product mask during the
SAM 3D run. Each run has a 900-second timeout and must pass the Khronos validator.
The gate prints and retains requests, JSONL output, stderr, validator reports,
metrics and `gate.json` in an isolated temporary directory. Optional gate flags:
`--weights-dir`, `--sofa-dir`, `--product-photo`.

## Intake and proposed photo schema

Input: `{photos:[{photoId,path}],outputDir,blurThreshold?}`. IDs follow the shared
ID rule. Source photos are read only. `outputDir` is the project photo metadata
directory; callers retain originals in their upload location. Output paths are
relative to this directory.

`photos.json` is a proposed worker format, not a shared daemon contract:

```text
{version:1,photos:[Photo]}

Photo = {
  photoId, sourceFileName, widthPx, heightPx, orientation, blurScore,
  lens?, focalLengthMm?, focalLength35Mm?, focalLengthPx?,
  ...AcceptedOrRejected
}
AcceptedOrRejected =
  {kind:"accepted",uprightPath,visionPath,visionWidthPx,visionHeightPx}
  | {kind:"rejected",reason:"blur"}
```

Dimensions and focal pixels refer to the full upright image. `orientation` records
the source EXIF value; output JPEGs have no orientation tag. `uprightPath` points
to a full-resolution JPEG, `visionPath` to a copy with a maximum side of 1568 px.
Blur is grayscale Laplacian variance on that vision copy; default threshold 8.
Intake replaces the manifest with the supplied batch, so reruns must supply the
complete current photo set. Rejected photos have no usable image path.

## Segmentation

Input:

```json
{
  "weightsDir": "/weights",
  "outputDir": "/job/masks",
  "objects": [{
    "objectId": "fridge", "name": "fridge",
    "views": [{"photoId": "photo-1", "path": "/photos/fridge.jpg", "box": [20, 30, 400, 800]}]
  }]
}
```

Boxes use integer pixels in each full upright photo, with exclusive right and
bottom edges. Supply one box per visible photo: S3's propagation experiment did
not reach every view. SAM 3 is the default; `model:"sam2.1"` selects the fallback
directly. A SAM 3 load error, inference error or empty mask switches the remaining
job to SAM 2.1. Both failing ends the job. SAM 2.1 uses MPS when available, CPU otherwise.

The result and `masks.json` contain `{objects:[{objectId,name,views}]}`. Each view
contains `photoId`, `maskPath`, `widthPx`, `heightPx`, `model`, `score`,
`durationSeconds`, `shareInBox`, and optional `fallbackReason`. Masks are full-size
0/255 PNGs at `<objectId>/<photoId>.png`. Timings cover preprocessing, inference and
mask resizing, excluding model loading and photo decoding.

## Reconstruction

Input: `{photosPath,weightsDir,outputDir,scaleSources?}`. `photosPath` names intake's
manifest. `outputDir` is the project's `recon/` directory. Only accepted photos
are reconstructed. MapAnything uses S1's fixed aspect mapping, four views per
dense-head chunk and a 1 GB MLX cache. Mixed orientations may be centre-cropped.

Scale sources are ordered by priority:

- `{kind:"measurement",axis:"height"|"width"|"depth",lengthM,label?}` supplies a
  room measurement. Width is the shorter footprint span, depth the longer.
- `{kind:"distance",points:[[x,y,z],[x,y,z]],lengthM,label?}` supplies a typed door
  width or another measured edge, with endpoints in the raw model coordinate frame.
- `{kind:"furniture",photoId,maskPath,axis:"height",lengthM,label?}` measures the
  1st–99th percentile vertical extent of valid reconstructed points inside the
  full upright mask. Use a view showing the object's full height. For an object
  known to stand on the floor, `floorStanding:true` uses the fitted floor plane
  as its base, so missing feet at the mask boundary do not shorten the object.
  `axis:"width"` measures the dominant horizontal direction of the masked points;
  `axis:"depth"` measures the perpendicular horizontal direction. Supply
  `direction:[x,y,z]` in the raw model frame when the object's width/depth axes
  differ from those defaults. Use a view containing both ends of that dimension.
- With no sources, the model's metric scale is retained and `scale.weak` is true.

Sources at the best available priority are fitted by least squares. All source
factors differing from that fit by over 5% are listed in `scale.disagreements`.
An invalid supplied source fails explicitly; it is never replaced with model scale.

The result and `room.json` contain `walls`, `ceilingHeightM`, `confidence`,
`ceilingPlaneFound`, `scale`, `scenePath`, `camerasPath`, `durationSeconds` and
`mlxPeakGb`, plus `planesPath`. Each wall matches the shared wall shape, ordered counter-clockwise
when viewed from above (+X right, +Z toward the viewer). IDs are UUIDs. Reruns register the current cameras to the prior `cameras.json`
using shared photo IDs, then match oriented physical wall planes. Registration
requires two distinct shared camera positions, positive scale, and a maximum
position residual below 5% of the previous ceiling height. Matches must agree
within 15° and 15% of that height at both endpoints. Without a usable registration
or plane match, a wall gets a new UUID.

The deterministic fit closes four sides. It groups surface normals by the nearest
dominant room axis, and retains right angles unless an independent wall line
improves RMS residual by 40% against the best square offset on all consistent
inliers, with an angle over 3° and below the orientation group's 45° boundary.
RANSAC chooses hypotheses from at most 5,000 points; final fits use all consistent
points in the orientation group. Missing extents enclose masked observations (including
floor and ceiling) and camera positions. Intersections must lie within the
observed bounds plus 12% of ceiling height. Unsupported or invalid refits fall
back to inferred axis-aligned sides at the observed bounds. A missing plane or supported
length below 75% marks that side `inferred`.
A supported length bin has points spanning at least 35% of the room height.
Confidence records inlier count, RMS residual in metres, supported length share,
and a value in [0,1]. No model agreement score is fabricated.

`scene.npz` holds aligned, metric `world_points`, validity `masks`, `confidence`,
`camera_poses`, `intrinsics`, photo IDs in `names`, vision-to-grid `transforms`,
and vision `image_sizes`. Cameras are camera-to-world with OpenCV camera axes
(right, down, forward), in the room's right-handed +Y-up world. `cameras.json`
holds the same per-photo cameras and preprocessing transforms. `planes.json`
holds the raw model fit plus the basis, origin and scale needed to convert it.
Artifacts live under a unique `run-<uuid>/` directory. Only after all three files
are complete does the worker atomically publish their paths in `room.json`.
A failed rerun leaves the previous room and its files usable. Previous generations
are retained; a killed job can also leave an unpublished generation for later cleanup.

## Coverage

Input: `{reconDir,areaThreshold?,minCameras?,cellSizeM?}`. Defaults are 0.25, 2 and
0.15 m. Each wall and the floor report occupied area cells and cameras whose point
maps contain at least three nearby surface points. This counts observed surfaces,
including occlusion, rather than assuming an entire camera frustum is visible.

The result and `coverage.json` contain `surfaces` and `captureRequests`. Requests
name `surfaceId`, `reason`, `standAtM`, and `lookDirection`. Inferred walls always
get requests; open walls do not. Requests are suggestions and never fail a job.
The surveyor supplies the user-facing wording later.

## Verification

```sh
uv run --project python pytest python/tests
```

Unit tests use synthetic inputs, temporary project directories, and free ports.

For the manual reconstruction gate, supply a local HEIC directory, matching box annotations in `spikes/s3/boxes.json`, room dimensions in metres, and the height of the annotated scale object. Dataset inputs and resulting evidence stay local. See [experiment data](../docs/spikes/test-data.md).

```sh
scripts/machine-lock.sh c1 scripts/gate-c1.sh --photos /path/to/fixture \
  --room-size 4 6 3 --scale-height-m 1.2
```

The gate writes worker requests, outputs, and `gate.json` to a temporary directory.
