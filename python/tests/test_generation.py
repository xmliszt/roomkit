import json
from pathlib import Path
import subprocess
import sys
from types import ModuleType, SimpleNamespace

import numpy as np
from PIL import Image
import pytest

import generate_sam3d
import generate_trellis
from protocol import UserFacingError
import generation
from generation import prepare_image, save_crop


ROOT = Path(__file__).resolve().parents[2]


def build_request(*, tmp_path, masked=True, size=(200, 100)):
    photo = tmp_path / "photo.png"
    Image.new("RGB", size, (130, 100, 60)).save(photo)
    weights = tmp_path / "weights"
    (weights / "sam3-mlx-bf16").mkdir(parents=True)
    request = {"photoPath": str(photo), "weightsDir": str(weights), "outputDir": str(tmp_path / "output")}
    request["name"] = "Bean bag sofa (striped linen)"
    if masked:
        mask = Image.new("L", size)
        mask.paste(255, (size[0] // 4, size[1] // 4, size[0] * 3 // 4, size[1] * 3 // 4))
        path = tmp_path / "mask.png"
        mask.save(path)
        request["maskPath"] = str(path)
    return request


@pytest.fixture
def backends(monkeypatch):
    calls = []
    mlx = ModuleType("mlx")
    mlx.core = SimpleNamespace(reset_peak_memory=lambda: None, get_peak_memory=lambda: 2_000_000_000, clear_cache=lambda: None)
    monkeypatch.setitem(sys.modules, "mlx", mlx)
    monkeypatch.setitem(sys.modules, "mlx.core", mlx.core)
    spatial = ModuleType("mlx_spatial")
    trellis = ModuleType("mlx_spatial.trellis2_inference")
    sam = ModuleType("mlx_spatial.sam3d_inference")
    mesh = ModuleType("mlx_spatial.sam3d_mesh")
    sparse = ModuleType("mlx_spatial.trellis2_sparse_structure")
    slat = ModuleType("mlx_spatial.trellis2_slat")
    sam_ss = ModuleType("mlx_spatial.sam3d_ss_flow")
    sam_slat = ModuleType("mlx_spatial.sam3d_slat")
    sparse._flow_euler_guided_prediction = lambda: "step"
    slat._flow_euler_guided_slat_prediction = lambda: "step"
    sam_ss._run_ss_velocity = lambda: "step"
    sam_slat._run_slat_velocity = lambda: "step"
    trellis._stage_output = lambda *args, **kwargs: None
    sam._release_mlx_stage_memory = lambda *args, **kwargs: None
    sam._mesh_memory_config = lambda profile: {"profile": profile}
    mesh._flexicubes_guard_blocker = lambda estimate, limit, metadata: "blocked" if estimate["estimated_flexicubes_bytes"] > limit else None

    class Trellis:
        def __init__(self, root, *, rmbg_root):
            calls.append({"root": root, "rmbgRoot": rmbg_root})

        def generate_textured_glb(self, image, **kwargs):
            with Image.open(image) as source:
                calls.append({"image": source.copy(), **kwargs})
            trellis._stage_output("shape", "fixture", None, "")
            calls.append({"steps": [sparse._flow_euler_guided_prediction(), slat._flow_euler_guided_slat_prediction()]})
            kwargs["output_path"].write_bytes(b"glTF-fixture")
            return SimpleNamespace(trace=SimpleNamespace(blocker=None))

    class Sam:
        def __init__(self, root):
            calls.append({"root": root})

        def generate_gaussians_ply(self, image, **kwargs):
            with Image.open(image) as source, Image.open(kwargs["mask_path"]) as mask:
                calls.append({
                    "image": source.copy(), "mask": mask.copy(), "meshConfig": sam._mesh_memory_config("balanced"),
                    "preGuard": mesh._flexicubes_guard_blocker({"estimated_flexicubes_bytes": 44_000_000_000}, 6_000_000_000, {"extraction_resolution": 256}),
                    "surfaceGuard": mesh._flexicubes_guard_blocker({"estimated_flexicubes_bytes": 7_000_000_000}, 6_000_000_000, {"extraction_resolution": 256, "surface_cube_count": 100_000}),
                    "otherResolutionGuard": mesh._flexicubes_guard_blocker({"estimated_flexicubes_bytes": 44_000_000_000}, 6_000_000_000, {"extraction_resolution": 512}),
                    **kwargs,
                })
            sam._release_mlx_stage_memory({}, "mesh")
            sam_ss._run_ss_velocity()
            sam_slat._run_slat_velocity()
            kwargs["glb_output_path"].write_bytes(b"glTF-fixture")
            return SimpleNamespace(trace=SimpleNamespace(blocker=None))

    trellis.Trellis2InferencePipeline = Trellis
    sam.Sam3dInferencePipeline = Sam
    spatial.trellis2_inference = trellis
    spatial.sam3d_inference = sam
    spatial.sam3d_mesh = mesh
    rmbg = ModuleType("mlx_spatial.trellis2_rmbg_forward")

    def remove_background(photo, *, root):
        calls.append({"backgroundRoot": root, "backgroundSize": photo.size})
        rgba = photo.convert("RGBA")
        alpha = Image.new("L", photo.size)
        alpha.paste(255, (photo.width // 3, photo.height // 3, photo.width * 2 // 3, photo.height * 2 // 3))
        rgba.putalpha(alpha)
        return rgba

    rmbg.remove_background_rmbg2_mlx = remove_background
    segmentation = SimpleNamespace(mask=None, score=0.0, error=None)
    sam3 = ModuleType("sam3")

    def load_sam3(root):
        calls.append({"segmentationRoot": root})
        if segmentation.error:
            raise segmentation.error

        def predict(*, image, box, name):
            calls.append({"segmentationPrompt": name, "box": box})
            mask = segmentation.mask
            if mask is None:
                mask = np.zeros((image.height, image.width), dtype=bool)
                mask[image.height // 4: image.height * 3 // 4, image.width // 4: image.width * 3 // 4] = True
            return mask, segmentation.score

        return predict

    sam3.load = load_sam3
    monkeypatch.setitem(sys.modules, "sam3", sam3)
    for name, module in (("trellis2_sparse_structure", sparse), ("trellis2_slat", slat), ("sam3d_ss_flow", sam_ss), ("sam3d_slat", sam_slat)):
        setattr(spatial, name, module)
        monkeypatch.setitem(sys.modules, f"mlx_spatial.{name}", module)
    monkeypatch.setitem(sys.modules, "mlx_spatial", spatial)
    monkeypatch.setitem(sys.modules, "mlx_spatial.trellis2_inference", trellis)
    monkeypatch.setitem(sys.modules, "mlx_spatial.sam3d_inference", sam)
    monkeypatch.setitem(sys.modules, "mlx_spatial.sam3d_mesh", mesh)
    monkeypatch.setitem(sys.modules, "mlx_spatial.trellis2_rmbg_forward", rmbg)
    return SimpleNamespace(calls=calls, trellis=trellis, sam=sam, mesh=mesh, segmentation=segmentation, steps=(sparse, slat, sam_ss, sam_slat))


def test_trellis_mask_uses_rgba_crop_without_background_removal(tmp_path, backends):
    request = build_request(tmp_path=tmp_path)
    result = generate_trellis.run(request)
    setup, call, steps = backends.calls
    assert steps == {"steps": ["step", "step"]}
    assert all(getattr(module, name)() == "step" for module, name in zip(backends.steps, ("_flow_euler_guided_prediction", "_flow_euler_guided_slat_prediction", "_run_ss_velocity", "_run_slat_velocity")))
    assert setup["rmbgRoot"] is None
    assert result["maskSource"] == "given"
    assert set(result["stageSeconds"]) == {"prepare", "shape"}
    assert result["sampleSteps"] == 2 and result["maxSilentSeconds"] >= 0
    assert setup["root"] == Path(request["weightsDir"]) / "trellis2"
    assert call["image"].mode == "RGBA"
    assert call["image"].size == (102, 52)
    assert call["image"].getchannel("A").getextrema() == (0, 255)
    assert call["pipeline_type"] == "512"
    assert call["texture_size"] == 1024
    assert call["glb_target_faces"] == 150_000
    assert call["seed"] == 42
    assert call["retain_trace_payloads"] is False
    assert result["sourceUp"] == "+Z" and result["sourceFront"] == "-Y"
    assert result["peakMemoryGb"] == max(result["peakRssGb"], result["mlxPeakGb"])
    assert json.loads((Path(request["outputDir"]) / "metrics.json").read_text()) == result
    assert Path(result["glbPath"]).read_bytes() == b"glTF-fixture"


def test_unmasked_photo_is_segmented_by_name_before_trellis(tmp_path, backends, capfd):
    request = build_request(tmp_path=tmp_path, masked=False)
    backends.segmentation.score = 0.97
    result = generate_trellis.run(request)
    segmentation_setup, prompt, setup, call, _ = backends.calls
    assert segmentation_setup["segmentationRoot"] == Path(request["weightsDir"]) / "sam3-mlx-bf16"
    assert prompt == {"segmentationPrompt": "Bean bag sofa", "box": None}
    assert setup["rmbgRoot"] is None
    assert call["image"].mode == "RGBA" and call["image"].size == (102, 52)
    assert result["maskSource"] == "sam3"
    frames = [json.loads(line) for line in capfd.readouterr().out.splitlines()]
    assert [frame["stage"] for frame in frames if "step" in frame] == ["sampling", "sampling"]
    assert "segmenting" in [frame["stage"] for frame in frames]


@pytest.mark.parametrize("failure", ["low-score", "error", "whole-photo"])
def test_rejected_segmentation_falls_back_to_thresholded_background_removal(tmp_path, backends, failure):
    request = build_request(tmp_path=tmp_path, masked=False)
    backends.segmentation.score = 0.2 if failure == "low-score" else 0.97
    if failure == "error":
        backends.segmentation.error = RuntimeError("weights missing")
    if failure == "whole-photo":
        backends.segmentation.mask = np.ones((100, 200), dtype=bool)
    result = generate_sam3d.run(request)
    background = next(call for call in backends.calls if "backgroundRoot" in call)
    call = backends.calls[-1]
    assert background["backgroundRoot"] == Path(request["weightsDir"]) / "rmbg2"
    assert result["maskSource"] == "rmbg2"
    assert 0.1 < np.asarray(call["mask"]).mean() / 255 < 0.2


def test_no_object_found_fails_before_generation(tmp_path, backends, monkeypatch):
    request = build_request(tmp_path=tmp_path, masked=False)
    rmbg = sys.modules["mlx_spatial.trellis2_rmbg_forward"]
    blank = Image.new("RGBA", (200, 100), (0, 0, 0, 0))
    monkeypatch.setattr(rmbg, "remove_background_rmbg2_mlx", lambda photo, *, root: blank)
    with pytest.raises(UserFacingError, match="Could not find the Bean bag sofa in the reference photo"):
        generate_trellis.run(request)
    assert not any("rmbgRoot" in call for call in backends.calls)


def test_unmasked_photo_needs_a_name(tmp_path, backends):
    request = build_request(tmp_path=tmp_path, masked=False)
    del request["name"]
    with pytest.raises(UserFacingError, match="Name the item so it can be found in the reference photo"):
        generate_trellis.run(request)


def test_missing_sam3_uses_background_removal(tmp_path, backends):
    request = build_request(tmp_path=tmp_path, masked=False)
    (Path(request["weightsDir"]) / "sam3-mlx-bf16").rmdir()
    result = generate_sam3d.run(request)
    assert not any("segmentationRoot" in call for call in backends.calls)
    assert result["maskSource"] == "rmbg2"


def test_near_full_frame_reference_uses_the_background_removal_matte(tmp_path, backends, monkeypatch):
    request = build_request(tmp_path=tmp_path, masked=False)
    backends.segmentation.mask = np.ones((100, 200), dtype=bool)
    backends.segmentation.score = 0.97
    rmbg = sys.modules["mlx_spatial.trellis2_rmbg_forward"]
    monkeypatch.setattr(rmbg, "remove_background_rmbg2_mlx", lambda photo, *, root: photo.convert("RGBA"))
    result = generate_sam3d.run(request)
    assert result["maskSource"] == "rmbg2"
    assert np.asarray(backends.calls[-1]["mask"]).mean() / 255 > 0.99


def test_user_facing_errors_are_marked_in_the_error_frame(tmp_path):
    photo = tmp_path / "photo.png"
    Image.new("RGB", (20, 10)).save(photo)
    weights = tmp_path / "weights"
    weights.mkdir()
    request = {"photoPath": str(photo), "weightsDir": str(weights), "outputDir": str(tmp_path / "output")}
    result = subprocess.run(
        [sys.executable, str(ROOT / "python/workers/generate_trellis.py")],
        input=json.dumps(request), capture_output=True, text=True, timeout=20,
    )
    event = json.loads(result.stdout.splitlines()[-1])
    assert event == {"kind": "error", "message": "Name the item so it can be found in the reference photo", "isUserFacing": True}


def test_sam_keeps_photo_and_mask_aligned_under_cap(tmp_path, backends):
    request = build_request(tmp_path=tmp_path, size=(2400, 1600))
    photo_bytes = Path(request["photoPath"]).read_bytes()
    mask_bytes = Path(request["maskPath"]).read_bytes()
    original_config = backends.sam._mesh_memory_config
    original_release = backends.sam._release_mlx_stage_memory
    original_guard = backends.mesh._flexicubes_guard_blocker
    generate_sam3d.run(request)
    setup, call = backends.calls
    assert setup["root"] == Path(request["weightsDir"]) / "sam-3d-objects-mlx"
    assert call["image"].size == call["mask"].size == (1536, 1024)
    assert set(np.unique(call["mask"])) == {0, 255}
    assert call["meshConfig"] == {"profile": "balanced"}
    assert call["preGuard"] is None
    assert call["surfaceGuard"] == "blocked"
    assert call["otherResolutionGuard"] == "blocked"
    assert call["memory_profile"] == "balanced"
    assert call["glb_target_faces"] == 150_000 and call["glb_texture_size"] == 1024
    assert backends.sam._mesh_memory_config is original_config
    assert backends.sam._release_mlx_stage_memory is original_release
    assert backends.mesh._flexicubes_guard_blocker is original_guard
    assert Path(request["photoPath"]).read_bytes() == photo_bytes
    assert Path(request["maskPath"]).read_bytes() == mask_bytes


@pytest.mark.parametrize("worker", [generate_trellis, generate_sam3d])
def test_failed_rerun_preserves_glb_metrics_and_restores_library(tmp_path, backends, monkeypatch, worker):
    request = build_request(tmp_path=tmp_path)
    result = worker.run(request)
    before_metrics = (Path(request["outputDir"]) / "metrics.json").read_bytes()
    original_stage = backends.trellis._stage_output
    original_config = backends.sam._mesh_memory_config
    original_release = backends.sam._release_mlx_stage_memory
    original_guard = backends.mesh._flexicubes_guard_blocker

    def fail(*args, **kwargs):
        raise ValueError("fixture export failure")

    backend = backends.trellis.Trellis2InferencePipeline if worker is generate_trellis else backends.sam.Sam3dInferencePipeline
    method = "generate_textured_glb" if worker is generate_trellis else "generate_gaussians_ply"
    monkeypatch.setattr(backend, method, fail)
    with pytest.raises(ValueError, match="fixture export failure"):
        worker.run(request)
    assert Path(result["glbPath"]).read_bytes() == b"glTF-fixture"
    assert (Path(request["outputDir"]) / "metrics.json").read_bytes() == before_metrics
    assert backends.trellis._stage_output is original_stage
    assert backends.sam._mesh_memory_config is original_config
    assert backends.sam._release_mlx_stage_memory is original_release
    assert backends.mesh._flexicubes_guard_blocker is original_guard
    assert sorted(Path(request["outputDir"]).iterdir()) == sorted([Path(request["outputDir"]) / "metrics.json", Path(result["glbPath"]).parent])


@pytest.mark.parametrize("worker", [generate_trellis, generate_sam3d])
@pytest.mark.parametrize("failure", ["before", "after"])
def test_metadata_failure_keeps_previous_models_and_referenced_glb(tmp_path, backends, monkeypatch, worker, failure):
    request = build_request(tmp_path=tmp_path)
    first = worker.run(request)
    first_glb = Path(first["glbPath"])
    original_write = generation.write_json

    def fail_publication(path, value):
        if failure == "before":
            raise OSError("disk full")
        original_write(path, value)
        raise KeyboardInterrupt("interrupted after publication")

    monkeypatch.setattr(generation, "write_json", fail_publication)
    with pytest.raises(OSError if failure == "before" else KeyboardInterrupt):
        worker.run(request)
    current = json.loads((Path(request["outputDir"]) / "metrics.json").read_text())
    assert current == first if failure == "before" else current["glbPath"] != first["glbPath"]
    assert Path(current["glbPath"]).read_bytes() == b"glTF-fixture"
    assert first_glb.read_bytes() == b"glTF-fixture"
    assert len(list(Path(request["outputDir"]).glob("run-*"))) == 2


@pytest.mark.parametrize("size, value, message", [((10, 10), 255, "dimensions"), ((200, 100), 0, "foreground")])
def test_invalid_mask_fails_before_inference(tmp_path, size, value, message):
    request = build_request(tmp_path=tmp_path)
    Image.new("L", size, value).save(request["maskPath"])
    with pytest.raises(ValueError, match=message):
        prepare_image(request=request, directory=tmp_path)


def test_full_mask_crop_retains_transparent_border(tmp_path):
    request = build_request(tmp_path=tmp_path)
    Image.new("L", (200, 100), 255).save(request["maskPath"])
    crop_path = save_crop(photo_path=request["photoPath"], mask_path=request["maskPath"], output_path=tmp_path / "crop.png")
    with Image.open(crop_path) as crop:
        assert crop.getchannel("A").getextrema() == (0, 255)


@pytest.mark.parametrize("worker", [generate_trellis, generate_sam3d])
@pytest.mark.parametrize("failure", ["blocker", "missing-glb"])
def test_unsuccessful_pipeline_never_publishes_a_result(tmp_path, backends, monkeypatch, worker, failure):
    request = build_request(tmp_path=tmp_path)

    def incomplete(*args, **kwargs):
        blocker = SimpleNamespace(stage="mesh", operation="export", reason="fixture blocked") if failure == "blocker" else None
        return SimpleNamespace(trace=SimpleNamespace(blocker=blocker))

    backend = backends.trellis.Trellis2InferencePipeline if worker is generate_trellis else backends.sam.Sam3dInferencePipeline
    method = "generate_textured_glb" if worker is generate_trellis else "generate_gaussians_ply"
    monkeypatch.setattr(backend, method, incomplete)
    with pytest.raises(RuntimeError, match="fixture blocked" if failure == "blocker" else "produced no GLB"):
        worker.run(request)
    assert list(Path(request["outputDir"]).iterdir()) == []


@pytest.mark.parametrize("worker", [generate_trellis, generate_sam3d])
def test_output_cannot_replace_the_source_photo(tmp_path, backends, worker):
    request = build_request(tmp_path=tmp_path)
    source = tmp_path / "metrics.json"
    source.write_bytes(Path(request["photoPath"]).read_bytes())
    request.update({"photoPath": str(source), "outputDir": str(tmp_path)})
    with pytest.raises(ValueError, match="overwrite"):
        worker.run(request)
    with Image.open(source) as photo:
        assert photo.size == (200, 100)


def test_preparation_applies_exif_before_matching_mask(tmp_path):
    request = build_request(tmp_path=tmp_path, size=(200, 100))
    exif = Image.Exif()
    exif[274] = 6
    Image.new("RGB", (100, 200)).save(request["photoPath"], exif=exif)
    prepared = tmp_path / "prepared"
    prepared.mkdir()
    photo_path, mask_path = prepare_image(request=request, directory=prepared)
    with Image.open(photo_path) as photo, Image.open(mask_path) as mask:
        assert photo.size == mask.size == (200, 100)
        assert photo.getexif().get(274) is None


@pytest.mark.parametrize("worker", ["generate_trellis", "generate_sam3d"])
def test_entrypoint_bad_input_reports_json_error_without_weights(tmp_path, worker):
    result = subprocess.run(
        [sys.executable, str(ROOT / f"python/workers/{worker}.py")],
        input="{}", capture_output=True, text=True, timeout=20,
    )
    assert result.returncode == 1
    event = json.loads(result.stdout)
    assert event["kind"] == "error" and "weightsDir" in event["message"]


def test_registry_adopts_existing_files_by_exact_size(tmp_path):
    registry = json.loads((ROOT / "packages/daemon/src/preflight/model-registry.json").read_text())
    model_ids = {"trellis2", "trellis2-sparse-decoder", "dinov3-vitl16", "rmbg2", "sam-3d-objects-mlx"}
    models = [model for model in registry["models"] if model["id"] in model_ids]
    assert {model["id"] for model in models} == model_ids
    for model in models:
        assert len(model["revision"]) == 40
        for file in model["files"]:
            path = tmp_path / model["folder"] / file["path"]
            path.parent.mkdir(parents=True, exist_ok=True)
            with path.open("wb") as stream:
                stream.truncate(file["sizeBytes"])
            if path.suffix == ".safetensors":
                assert len(file["sha256"]) == 64
            assert path.suffix not in (".bin", ".pt", ".pth", ".ckpt")
    code = """
import { readModelRegistry } from './packages/daemon/src/preflight/read-model-registry.ts';
import { readModelWeights } from './packages/daemon/src/preflight/read-model-weights.ts';
const modelIds = JSON.parse(process.argv[2]);
const models = readModelRegistry().models.filter(model => modelIds.includes(model.id));
process.stdout.write(JSON.stringify(models.map(model => readModelWeights({model, weightsRoot: process.argv[1]}))));
"""
    result = subprocess.run(["node", "--input-type=module", "-e", code, str(tmp_path), json.dumps(sorted(model_ids))], cwd=ROOT, text=True, capture_output=True, timeout=20)
    assert result.returncode == 0, result.stderr
    assert all(model["state"] == "present" for model in json.loads(result.stdout))
    for model in models:
        assert json.loads((tmp_path / model["folder"] / ".complete.json").read_text()) == {"revision": model["revision"]}


def test_confident_full_frame_detection_is_used_when_the_matte_is_empty(tmp_path, backends, monkeypatch):
    request = build_request(tmp_path=tmp_path, masked=False)
    backends.segmentation.mask = np.ones((100, 200), dtype=bool)
    backends.segmentation.score = 0.97
    rmbg = sys.modules["mlx_spatial.trellis2_rmbg_forward"]
    monkeypatch.setattr(rmbg, "remove_background_rmbg2_mlx", lambda photo, *, root: Image.new("RGBA", photo.size, (0, 0, 0, 0)))
    result = generate_sam3d.run(request)
    assert result["maskSource"] == "sam3"
    assert np.asarray(backends.calls[-1]["mask"]).mean() / 255 > 0.99
