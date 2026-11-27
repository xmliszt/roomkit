import json
from pathlib import Path
import weakref

import numpy as np
from PIL import Image
import pytest

import coverage
import reconstruct
import segment
from scale import resolve_scale
from test_geometry import synthetic_scene


@pytest.mark.parametrize("failed_file", ["cameras.json", "room.json", "after-room.json"])
def test_failed_reconstruction_preserves_previous_artifacts(tmp_path, monkeypatch, failed_file):
    scene = synthetic_scene()
    count = len(scene["names"])
    scene.update({"intrinsics": np.repeat(np.eye(3)[None], count, axis=0), "transforms": np.repeat([[1, 0, 0]], count, axis=0), "image_sizes": np.repeat([[45, 60]], count, axis=0), "mlx_peak_gb": np.array(0)})
    manifest = tmp_path / "photos.json"
    manifest.write_text(json.dumps({"photos": [{"photoId": str(name), "kind": "accepted"} for name in scene["names"]]}))
    monkeypatch.setattr(reconstruct, "predict", lambda **kwargs: scene)
    request = {"photosPath": str(manifest), "weightsDir": str(tmp_path / "weights"), "outputDir": str(tmp_path / "recon")}
    first = reconstruct.run(request)
    root = tmp_path / "recon"
    cloud = (root / first["scenePath"]).read_bytes()
    cameras = (root / first["camerasPath"]).read_bytes()
    original_write = reconstruct.write_json

    def fail_artifact_write(path, value):
        if Path(path).name == failed_file:
            raise OSError("disk full")
        original_write(path, value)
        if failed_file == "after-room.json" and Path(path).name == "room.json":
            raise KeyboardInterrupt("interrupted after publication")

    monkeypatch.setattr(reconstruct, "write_json", fail_artifact_write)
    exception = KeyboardInterrupt if failed_file == "after-room.json" else OSError
    with pytest.raises(exception):
        reconstruct.run({**request, "scaleSources": [{"kind": "measurement", "lengthM": 1.4}]})
    current = json.loads((root / "room.json").read_text())
    if failed_file == "after-room.json":
        assert current["ceilingHeightM"] == pytest.approx(1.4)
    else:
        assert current == first
    assert (root / current["scenePath"]).is_file()
    assert (root / current["camerasPath"]).is_file()
    assert (root / first["scenePath"]).read_bytes() == cloud
    assert (root / first["camerasPath"]).read_bytes() == cameras
    assert len(list(root.glob("run-*"))) == (1 if failed_file == "cameras.json" else 2)
    assert len(coverage.run({"reconDir": str(root)})["surfaces"]) == 5


def test_sparse_observations_count_every_occupied_cell():
    room = {"ceilingHeightM": 2, "walls": [{"id": str(index), "kind": "solid", "startM": {"x": x, "z": z}} for index, (x, z) in enumerate([(-1, -1), (-1, 1), (1, 1), (1, -1)])]}
    x, z = np.meshgrid(np.linspace(-0.75, 0.75, 4), np.linspace(-0.75, 0.75, 4))
    points = np.stack([x, np.zeros_like(x), z], axis=-1)
    scene = {"names": ["a", "b"], "world_points": np.array([points, points]), "masks": np.ones((2, 4, 4), dtype=bool)}
    result = coverage.evaluate(room=room, scene=scene, cell_size=0.5, area_threshold=0.75)
    floor = next(surface for surface in result["surfaces"] if surface["surfaceId"] == "floor")
    assert floor["areaShare"] == 1
    assert floor["cameraCount"] == 2
    assert not any(request["surfaceId"] == "floor" for request in result["captureRequests"])


def test_area_accumulates_views_below_the_camera_count_threshold():
    room = {"ceilingHeightM": 1, "walls": [{"id": str(index), "kind": "solid", "startM": {"x": x, "z": z}} for index, (x, z) in enumerate([(0, 0), (0, 1), (1, 1), (1, 0)])]}
    floor = np.array([[[[0.25, 0, 0.25], [0.75, 0, 0.25]]], [[[0.25, 0, 0.75], [0.75, 0, 0.75]]]])
    wall = np.array([[[[0, 0.25, 0.25], [0, 0.75, 0.25]]], [[[0, 0.25, 0.75], [0, 0.75, 0.75]]]])
    scene = {"names": ["floor-a", "floor-b", "wall-a", "wall-b"], "world_points": np.concatenate([floor, wall]), "masks": np.ones((4, 1, 2), dtype=bool)}
    result = coverage.evaluate(room=room, scene=scene, cell_size=0.5)
    for surface_id in ("floor", "0"):
        surface = next(surface for surface in result["surfaces"] if surface["surfaceId"] == surface_id)
        assert surface["areaShare"] == 1
        assert surface["cameraCount"] == 0


def test_fallback_releases_failed_backend_before_loading_another(tmp_path, monkeypatch):
    Image.new("RGB", (10, 10)).save(tmp_path / "image.png")
    references = []

    class FailedBackend:
        def __call__(self, **kwargs):
            raise RuntimeError("inference failed")

    def load(*, model, weights_dir):
        if model == "sam3":
            backend = FailedBackend()
            references.append(weakref.ref(backend))
            return backend
        assert references[0]() is None
        return lambda **kwargs: (np.ones((10, 10), dtype=bool), 0.9)

    monkeypatch.setattr(segment, "load_backend", load)
    result = segment.run({"weightsDir": str(tmp_path / "weights"), "outputDir": str(tmp_path / "out"), "objects": [{"objectId": "item", "name": "item", "views": [{"photoId": "photo", "path": str(tmp_path / "image.png"), "box": [0, 0, 10, 10]}]}]})
    assert result["objects"][0]["views"][0]["model"] == "sam2.1"


@pytest.mark.parametrize("axis,known_length", [("width", 1.11), ("depth", 0.5)])
def test_horizontal_furniture_dimensions_from_rotated_mask(tmp_path, axis, known_length):
    x, z = np.meshgrid(np.linspace(-1.11, 1.11, 80), np.linspace(-0.5, 0.5, 60))
    angle = 0.6
    points = np.stack([x * np.cos(angle) - z * np.sin(angle), np.ones_like(x), x * np.sin(angle) + z * np.cos(angle)], axis=-1)
    mask_path = tmp_path / "mask.png"
    Image.fromarray(np.full(x.shape, 255, dtype=np.uint8)).save(mask_path)
    scene = {"names": ["photo"], "world_points": points[None], "masks": np.ones((1, 60, 80), dtype=bool), "transforms": [[1, 0, 0]], "image_sizes": [[80, 60]]}
    source = {"kind": "furniture", "photoId": "photo", "maskPath": str(mask_path), "axis": axis, "lengthM": known_length}
    result = resolve_scale(scene=scene, layout={"up": [0, 1, 0]}, sources=[source])
    assert result["factor"] == pytest.approx(0.5, abs=0.015)
    vector = [np.cos(angle), 0, np.sin(angle)] if axis == "width" else [-np.sin(angle), 0, np.cos(angle)]
    directed = resolve_scale(scene=scene, layout={"up": [0, 1, 0]}, sources=[{**source, "direction": vector}])
    assert directed["factor"] == pytest.approx(result["factor"])
