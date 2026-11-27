import numpy as np
import pytest
from PIL import Image

from coverage import evaluate, inside_polygon, occupied_cells
from fit_layout import fit_layout
from room import align_scene, build_room, wall_line
from scale import mask_points, resolve_scale


def look_at(*, center, target):
    forward = (target - center) / np.linalg.norm(target - center)
    right = np.cross(forward, [0, 0, 1.0])
    right /= np.linalg.norm(right)
    pose = np.eye(4)
    pose[:3, :3] = np.stack([right, np.cross(forward, right), forward], axis=1)
    pose[:3, 3] = center
    return pose


def render_room(*, pose, slope=0.0):
    rows, columns = np.mgrid[:60, :45]
    rays = np.stack([(columns - 22.5) / 50, (rows - 30) / 50, np.ones(rows.shape)], axis=-1) @ pose[:3, :3].T
    origin = pose[:3, 3]
    planes = [([1, 0, 0], 0), ([1, -slope, 0], 3.05 - slope * 2.625), ([0, 1, 0], 0), ([0, 1, 0], 5.25), ([0, 0, 1], 0), ([0, 0, 1], 2.75)]
    distances = []
    for normal, offset in planes:
        with np.errstate(divide="ignore", invalid="ignore"):
            distance = (offset - origin @ normal) / (rays @ normal)
        distances.append(np.where(distance > 0, distance, np.inf))
    distances = np.array(distances)
    hit = np.argmin(distances, axis=0)
    return origin + rays * distances.min(axis=0)[..., None], hit


def synthetic_scene(*, missing_wall=None, visible_walls=None, slope=0.0):
    rng = np.random.default_rng(1)
    rotation = np.linalg.qr(rng.normal(size=(3, 3)))[0]
    rotation[:, 0] *= np.sign(np.linalg.det(rotation))
    world = np.eye(4)
    world[:3, :3] = rotation
    poses, points, masks, surfaces = [], [], [], []
    for _ in range(12):
        center = np.array([rng.uniform(0.5, 2.6), rng.uniform(0.5, 4.8), 1.5])
        target = rng.uniform([0, 0, 0], [3.05, 5.25, 2.75])
        pose = look_at(center=center, target=target)
        rendered, hit = render_room(pose=pose, slope=slope)
        poses.append(world @ pose)
        points.append((rendered + rng.normal(0, 0.005, (60, 45, 3))) @ rotation.T)
        masks.append(np.isin(hit, [*visible_walls, 4, 5]) if visible_walls is not None else np.ones(hit.shape, dtype=bool) if missing_wall is None else hit != missing_wall)
        surfaces.append(hit)
    return {
        "world_points": np.array(points), "confidence": np.ones((12, 60, 45)),
        "masks": np.array(masks), "camera_poses": np.array(poses),
        "names": np.array([f"photo-{index}" for index in range(12)]),
        "surface_ids": np.array(surfaces),
    }


@pytest.fixture(scope="module")
def fitted_box():
    scene = synthetic_scene()
    layout = fit_layout(scene)
    room, basis, center = build_room(scene=scene, layout=layout, factor=1)
    return scene, layout, room, basis, center


def test_rotated_room_fit_recovers_three_dimensions(fitted_box):
    _, layout, room, _, _ = fitted_box
    spans = sorted(layout["sides"][f"{axis}_max"]["pos"] - layout["sides"][f"{axis}_min"]["pos"] for axis in ("x", "y"))
    assert spans == pytest.approx([3.05, 5.25], abs=0.02)
    assert room["ceilingHeightM"] == pytest.approx(2.75, abs=0.02)
    assert all(confidence["planeFound"] for confidence in room["confidence"])
    assert all(0 <= confidence["value"] <= 1 for confidence in room["confidence"])


def test_room_basis_and_camera_coordinates_stay_right_handed(fitted_box):
    scene, _, _, basis, center = fitted_box
    assert np.linalg.det(basis) == pytest.approx(1)
    assert basis @ basis.T == pytest.approx(np.eye(3))
    aligned = align_scene(scene=scene, basis=basis, center=center, factor=0.8)
    for old_pose, new_pose in zip(scene["camera_poses"], aligned["camera_poses"]):
        assert np.linalg.det(new_pose[:3, :3]) == pytest.approx(1)
        world_point = old_pose[:3, 3] + old_pose[:3, :3] @ np.array([0.2, 0.1, 1])
        aligned_point = (basis @ world_point - center) * 0.8
        camera_point = new_pose[:3, :3].T @ (aligned_point - new_pose[:3, 3])
        assert camera_point == pytest.approx([0.16, 0.08, 0.8])
    assert aligned["world_points"].shape == scene["world_points"].shape
    assert aligned["world_points"] == pytest.approx(((scene["world_points"] @ basis.T - center) * 0.8).astype(np.float32))


def test_walls_close_counterclockwise_with_stable_ids(fitted_box):
    scene, layout, room, basis, center = fitted_box
    corners = np.array([[wall["startM"]["x"], wall["startM"]["z"]] for wall in room["walls"]])
    edges = np.roll(corners, -1, axis=0) - corners
    assert len(corners) == 4
    assert np.all(np.linalg.norm(edges, axis=1) > 0)
    assert edges.sum(axis=0) == pytest.approx([0, 0])
    assert np.sum(corners[:, 0] * np.roll(corners[:, 1], -1) - corners[:, 1] * np.roll(corners[:, 0], -1)) < 0
    rerun, _, _ = build_room(scene=scene, layout=layout, factor=0.8, previous=room, previous_cameras=camera_records(scene=align_scene(scene=scene, basis=basis, center=center, factor=1)))
    assert [wall["id"] for wall in rerun["walls"]] == [wall["id"] for wall in room["walls"]]


def test_absent_wall_stays_closed_and_requests_capture():
    scene = synthetic_scene(missing_wall=0)
    layout = fit_layout(scene)
    room, basis, center = build_room(scene=scene, layout=layout, factor=1)
    assert len(room["walls"]) == 4
    missing = [entry for entry in room["confidence"] if not entry["planeFound"]]
    assert len(missing) == 1
    wall_id = missing[0]["wallId"]
    assert next(wall for wall in room["walls"] if wall["id"] == wall_id)["kind"] == "inferred"
    coverage = evaluate(room=room, scene=align_scene(scene=scene, basis=basis, center=center, factor=1))
    assert any(request["surfaceId"] == wall_id and request["reason"] == "inferred" for request in coverage["captureRequests"])
    corners = np.array([[wall["startM"]["x"], wall["startM"]["z"]] for wall in room["walls"]])
    for request in coverage["captureRequests"]:
        stand = request["standAtM"]
        assert inside_polygon(points=np.array([[stand["x"], stand["z"]]]), corners=corners)[0]


def test_wall_line_keeps_oblique_plane_when_square_residual_is_higher():
    rng = np.random.default_rng(9)
    z = np.linspace(-2.6, 2.6, 2000)
    x = 1.5 + 0.14 * z + rng.normal(0, 0.002, len(z))
    points = np.column_stack([x, z])
    normal, offset = wall_line(points=points, normal=np.array([1.0, 0]), offset=1.5, height=2.7, rng=np.random.default_rng(0))
    assert abs(normal[1]) > 0.1
    assert np.sqrt(np.mean((points @ normal - offset) ** 2)) < 0.01


@pytest.mark.parametrize("slope", [0.14, 0.5])
def test_oblique_room_does_not_force_four_right_angles(slope):
    scene = synthetic_scene(slope=slope)
    layout = fit_layout(scene)
    room, _, _ = build_room(scene=scene, layout=layout, factor=1)
    corners = np.array([[wall["startM"]["x"], wall["startM"]["z"]] for wall in room["walls"]])
    edges = np.roll(corners, -1, axis=0) - corners
    units = edges / np.linalg.norm(edges, axis=1, keepdims=True)
    cosines = np.sum(units * np.roll(units, -1, axis=0), axis=1)
    assert np.max(np.abs(cosines)) == pytest.approx(slope / np.sqrt(1 + slope**2), abs=0.025)
    expected_lengths = sorted([3.05 - slope * 2.625, 3.05 + slope * 2.625, 5.25, 5.25 * np.sqrt(1 + slope**2)])
    assert sorted(np.linalg.norm(edges, axis=1)) == pytest.approx(expected_lengths, abs=0.06)
    area = abs(np.sum(corners[:, 0] * np.roll(corners[:, 1], -1) - corners[:, 1] * np.roll(corners[:, 0], -1))) / 2
    assert area == pytest.approx(3.05 * 5.25, abs=0.2)
    assert all(entry["planeFound"] for entry in room["confidence"])


def test_coverage_counts_each_view_and_unique_area_cells():
    room = {"ceilingHeightM": 2.0, "walls": [
        {"id": "left", "startM": {"x": -1.0, "z": -1.0}, "kind": "solid"},
        {"id": "front", "startM": {"x": -1.0, "z": 1.0}, "kind": "open"},
        {"id": "right", "startM": {"x": 1.0, "z": 1.0}, "kind": "solid"},
        {"id": "back", "startM": {"x": 1.0, "z": -1.0}, "kind": "solid"},
    ]}
    values = np.linspace(0.05, 1.95, 40)
    along, height = np.meshgrid(values, values)
    left = np.stack([np.full(along.shape, -1), height, along - 1], axis=-1)
    floor = np.stack([along - 1, np.zeros(along.shape), height - 1], axis=-1)
    scene = {"names": np.array(["left-a", "left-b", "floor-a", "floor-b"]), "world_points": np.array([left, left, floor, floor]), "masks": np.ones((4, 40, 40), dtype=bool)}
    result = evaluate(room=room, scene=scene, cell_size=0.2)
    surfaces = {surface["surfaceId"]: surface for surface in result["surfaces"]}
    assert surfaces["left"]["cameraCount"] == 2
    assert surfaces["left"]["areaShare"] == 1
    assert surfaces["floor"]["cameraCount"] == 2
    assert surfaces["floor"]["areaShare"] == 1
    assert {request["surfaceId"] for request in result["captureRequests"]} == {"right", "back"}
    assert occupied_cells(coordinates=np.array([[0.1, 0.1], [0.1, 0.1]]), span=[1, 1], cell_size=0.5) == 0.25


def scale_fixture(*, tmp_path):
    rows, columns = np.mgrid[:12, :12]
    points = np.stack([columns, rows, np.ones(rows.shape)], axis=-1).astype(float)
    mask_path = tmp_path / "object.png"
    mask = np.zeros((56, 64), dtype=np.uint8)
    mask[28:, 32:] = 255
    Image.fromarray(mask).save(mask_path)
    scene = {"names": np.array(["photo"]), "world_points": points[None], "masks": np.ones((1, 12, 12), dtype=bool), "transforms": np.array([[0.5, 2, 1]]), "image_sizes": np.array([[32, 28]])}
    layout = {"height": 3.0, "up": [0, 1, 0], "sides": {"x_min": {"pos": 0}, "x_max": {"pos": 4}, "y_min": {"pos": 0}, "y_max": {"pos": 6}}}
    furniture = {"kind": "furniture", "photoId": "photo", "maskPath": str(mask_path), "lengthM": 2.5, "label": "fridge"}
    return scene, layout, furniture


def test_scale_mask_mapping_applies_crop_resize_and_confidence_mask(tmp_path):
    scene, _, furniture = scale_fixture(tmp_path=tmp_path)
    scene["masks"][0, 6, 6] = False
    selected = mask_points(scene=scene, source=furniture)
    expected = scene["world_points"][0, 6:, 6:].reshape(-1, 3)[1:]
    assert selected == pytest.approx(expected)


def test_typed_scale_precedes_furniture_and_reports_disagreement(tmp_path):
    scene, layout, furniture = scale_fixture(tmp_path=tmp_path)
    result = resolve_scale(scene=scene, layout=layout, sources=[furniture, {"kind": "measurement", "axis": "height", "lengthM": 2.7, "label": "ceiling"}])
    assert result["kind"] == "measurement"
    assert result["factor"] == pytest.approx(0.9)
    assert result["disagreements"] == ["fridge"]
    assert not result["weak"]


def test_scale_solves_selected_measurements_by_least_squares(tmp_path):
    scene, layout, _ = scale_fixture(tmp_path=tmp_path)
    result = resolve_scale(scene=scene, layout=layout, sources=[
        {"kind": "measurement", "axis": "height", "lengthM": 2.7},
        {"kind": "measurement", "axis": "width", "lengthM": 3.2},
    ])
    assert result["factor"] == pytest.approx((3 * 2.7 + 4 * 3.2) / (3**2 + 4**2))


def test_furniture_scale_and_weak_model_fallback(tmp_path):
    scene, layout, furniture = scale_fixture(tmp_path=tmp_path)
    result = resolve_scale(scene=scene, layout=layout, sources=[furniture])
    assert result["kind"] == "furniture"
    assert result["factor"] == pytest.approx(0.5)
    weak = resolve_scale(scene=scene, layout=layout, sources=[])
    assert weak["kind"] == "model"
    assert weak["factor"] == 1
    assert weak["weak"]


def test_floor_standing_scale_uses_floor_when_mask_misses_the_feet(tmp_path):
    scene, layout, furniture = scale_fixture(tmp_path=tmp_path)
    layout["floor_h"] = 0
    result = resolve_scale(scene=scene, layout=layout, sources=[{**furniture, "floorStanding": True, "lengthM": 5.5}])
    assert result["factor"] == pytest.approx(0.5)


@pytest.mark.parametrize("length", [0, -1, float("nan"), float("inf")])
def test_scale_rejects_invalid_measurements(tmp_path, length):
    scene, layout, _ = scale_fixture(tmp_path=tmp_path)
    with pytest.raises(ValueError, match="finite and positive"):
        resolve_scale(scene=scene, layout=layout, sources=[{"kind": "measurement", "lengthM": length}])


def camera_records(*, scene):
    return [{"photoId": str(name), "cameraToWorld": pose.tolist()} for name, pose in zip(scene["names"], scene["camera_poses"])]


def test_floor_and_ceiling_keep_their_physical_heights(fitted_box):
    scene, _, room, basis, center = fitted_box
    aligned = align_scene(scene=scene, basis=basis, center=center, factor=1)
    heights = aligned["world_points"][..., 1]
    assert heights[scene["surface_ids"] == 4] == pytest.approx(0, abs=0.025)
    assert heights[scene["surface_ids"] == 5] == pytest.approx(room["ceilingHeightM"], abs=0.025)


@pytest.mark.parametrize("visible_walls", [[0], [1, 2], [0, 1]])
def test_partial_capture_encloses_observations_with_inferred_sides(visible_walls):
    scene = synthetic_scene(visible_walls=visible_walls)
    layout = fit_layout(scene)
    room, basis, center = build_room(scene=scene, layout=layout, factor=1)
    assert len(room["walls"]) == 4
    assert sum(entry["planeFound"] for entry in room["confidence"]) == len(visible_walls)
    corners = np.array([[wall["startM"]["x"], wall["startM"]["z"]] for wall in room["walls"]])
    edges = np.roll(corners, -1, axis=0) - corners
    assert sorted(np.linalg.norm(edges, axis=1)) == pytest.approx([3.05, 3.05, 5.25, 5.25], abs=0.12)
    assert np.all(edges[:, 0] * np.roll(edges[:, 1], -1) - edges[:, 1] * np.roll(edges[:, 0], -1) < 0)
    aligned = align_scene(scene=scene, basis=basis, center=center, factor=1)
    observations = np.concatenate([aligned["world_points"][scene["masks"]], aligned["camera_poses"][:, :3, 3]])[:, [0, 2]]
    for index, entry in enumerate(room["confidence"]):
        if not entry["planeFound"]:
            assert room["walls"][index]["kind"] == "inferred"
            outward = np.array([-edges[index, 1], edges[index, 0]])
            assert np.max((observations - corners[index]) @ outward) <= 1e-5


def test_wall_refit_stays_in_its_orientation_group():
    y = np.linspace(-0.02, 0.02, 2000)
    points = np.column_stack([np.linspace(-0.3, 0.3, len(y)), y])
    normal, _ = wall_line(points=points, normal=np.array([1.0, 0]), offset=0, height=2.7, rng=np.random.default_rng(0))
    assert normal @ [1, 0] > np.sqrt(0.5)


def test_wall_refit_uses_inliers_outside_the_sample():
    rng = np.random.default_rng(22)
    z = rng.uniform(-4.5, 4.5, 30000)
    x = 1.5 + 0.14 * z + rng.normal(0, 0.008, len(z))
    points = np.column_stack([x, z])
    normal, offset = wall_line(points=points, normal=np.array([1.0, 0]), offset=1.5, height=2.7, rng=np.random.default_rng(0))
    centered = points - points.mean(axis=0)
    expected = np.linalg.eigh(centered.T @ centered)[1][:, 0]
    expected *= np.sign(expected[0])
    assert normal == pytest.approx(expected, abs=1e-10)
    assert offset == pytest.approx(points.mean(axis=0) @ expected, abs=1e-10)


def test_wall_ids_follow_physical_planes_after_basis_scale_and_origin_change(fitted_box):
    scene, layout, room, basis, center = fitted_box
    cameras = camera_records(scene=align_scene(scene=scene, basis=basis, center=center, factor=1))
    rotation = np.linalg.qr(np.random.default_rng(5).normal(size=(3, 3)))[0]
    translation = np.array([12, -7, 3])
    poses = scene["camera_poses"].copy()
    poses[:, :3, :3] = rotation @ poses[:, :3, :3]
    poses[:, :3, 3] = 1.7 * poses[:, :3, 3] @ rotation.T + translation
    changed = {**scene, "world_points": 1.7 * scene["world_points"] @ rotation.T + translation, "camera_poses": poses}
    new_layout = {**layout, "ax": (rotation @ np.array(layout["ay"])).tolist(), "ay": (-rotation @ np.array(layout["ax"])).tolist(), "up": (rotation @ np.array(layout["up"])).tolist(), "height": layout["height"] * 1.7}
    new_layout["floor_h"] = layout["floor_h"] * 1.7 + translation @ new_layout["up"]
    new_layout["sides"] = {}
    mapping = {"x_min": "y_min", "x_max": "y_max", "y_min": "x_max", "y_max": "x_min"}
    for key, old_key in mapping.items():
        side = layout["sides"][old_key]
        new_layout["sides"][key] = {**side, "pos": side["pos"] * 1.7 * (1 if key.startswith("x") else -1) + translation @ new_layout["ax" if key.startswith("x") else "ay"]}
    rerun, _, _ = build_room(scene=changed, layout=new_layout, factor=0.8, previous=room, previous_cameras=cameras)
    original = {entry["side"]: entry["wallId"] for entry in room["confidence"]}
    for entry in rerun["confidence"]:
        assert entry["wallId"] == original[mapping[entry["side"]]]


def test_wall_ids_are_not_guessed_without_shared_cameras(fitted_box):
    scene, layout, room, _, _ = fitted_box
    rerun, _, _ = build_room(scene=scene, layout=layout, factor=1, previous=room, previous_cameras=[])
    assert not {wall["id"] for wall in room["walls"]} & {wall["id"] for wall in rerun["walls"]}


def test_invalid_refit_falls_back_to_inferred_observed_bounds(monkeypatch):
    import room as room_module

    scene = synthetic_scene(visible_walls=[1, 2])
    layout = fit_layout(scene)

    def invalid_line(**kwargs):
        return np.array([1.0, 0.001]), 100.0

    monkeypatch.setattr(room_module, "wall_line", invalid_line)
    result, _, _ = build_room(scene=scene, layout=layout, factor=1)
    corners = np.array([[wall["startM"]["x"], wall["startM"]["z"]] for wall in result["walls"]])
    assert sorted(np.linalg.norm(np.roll(corners, -1, axis=0) - corners, axis=1)) == pytest.approx([3.05, 3.05, 5.25, 5.25], abs=0.12)
    assert all(wall["kind"] == "inferred" for wall in result["walls"])


def test_missing_extent_includes_camera_beyond_surface_support():
    scene = synthetic_scene(visible_walls=[0])
    original = fit_layout(scene)
    missing = next(key for key, side in original["sides"].items() if not side["plane"])
    axis = np.array(original["ax"] if missing.startswith("x") else original["ay"])
    sign = -1 if missing.endswith("min") else 1
    coordinate = original["sides"][missing]["pos"] + sign * 0.5
    pose = scene["camera_poses"][0]
    pose[:3, 3] += (coordinate - pose[:3, 3] @ axis) * axis
    layout = fit_layout(scene)
    assert (layout["sides"][missing]["pos"] - coordinate) * sign >= -1e-6


def test_tilt_requires_improvement_over_all_consistent_inliers():
    rng = np.random.default_rng(10)
    z = rng.uniform(-1.5, 1.5, 8000)
    tilted = np.column_stack([1.5 + 0.14 * z + rng.normal(0, 0.005, len(z)), z])
    square = np.column_stack([rng.normal(1.5, 0.005, 3500), rng.uniform(-1.5, 1.5, 3500)])
    normal, _ = wall_line(points=np.concatenate([tilted, square]), normal=np.array([1.0, 0]), offset=1.5, height=2.7, rng=np.random.default_rng(0))
    assert normal == pytest.approx([1, 0])
