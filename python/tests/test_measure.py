import json
import math
from pathlib import Path
import subprocess
import sys

import numpy as np
import pytest
from PIL import Image

from measure import clean_view_points, clipped_view, measure_views, inside_room, is_floor_covering, measure_object, read_points, resolve_floor_support, run


def room():
    return {"ceilingHeightM": 2.8, "walls": [
        {"id": "left", "startM": {"x": -3, "z": -4}, "kind": "solid"},
        {"id": "front", "startM": {"x": -3, "z": 4}, "kind": "solid"},
        {"id": "right", "startM": {"x": 3, "z": 4}, "kind": "solid"},
        {"id": "back", "startM": {"x": 3, "z": -4}, "kind": "solid"},
    ]}


def cuboid(*, width=1.8, height=0.8, depth=0.6, x=0.0, z=0.0, elevation=0.0, angle=0.0):
    values = np.linspace(-0.5, 0.5, 20)
    a, b = np.meshgrid(values, values)
    faces = []
    for fixed in (-0.5, 0.5):
        for axis in range(3):
            coords = [a, b]
            coords.insert(axis, np.full(a.shape, fixed))
            faces.append(np.stack(coords, axis=-1).reshape(-1, 3))
    points = np.concatenate(faces) * [width, height, depth]
    rotation = np.array([[math.cos(angle), 0, math.sin(angle)], [0, 1, 0], [-math.sin(angle), 0, math.cos(angle)]])
    return points @ rotation.T + [x, elevation + height / 2, z]


def test_rotated_floor_box_has_measured_size_anchor_and_orientation():
    points = cuboid(x=0.4, z=-0.7, angle=0.43)
    result = measure_object(points=points, obj={"objectId": "sofa", "mount": "floor"}, room=room())
    resolve_floor_support(objects=[result], room=room())
    assert result["sizeM"] == pytest.approx({"width": 1.8, "height": 0.8, "depth": 0.6}, abs=0.025)
    placement = result["placement"]
    assert placement["xM"] == pytest.approx(0.4, abs=0.01)
    assert placement["zM"] == pytest.approx(-0.7, abs=0.01)
    assert placement["elevationM"] == 0
    assert math.sin(placement["rotationRad"] - 0.43) == pytest.approx(0, abs=1e-10)
    assert measure_object(points=points[::-1], obj={"objectId": "sofa", "mount": "floor"}, room=room()) == result


def test_tv_on_console_keeps_its_elevation():
    result = measure_object(points=cuboid(width=1.18, height=0.68, depth=0.08, elevation=0.72), obj={"objectId": "tv", "mount": "floor"}, room=room())
    assert result["placement"]["elevationM"] == pytest.approx(0.72)
    assert result["sizeM"] == pytest.approx({"width": 1.18, "height": 0.68, "depth": 0.08})


@pytest.mark.parametrize("name", ["Rug", "Carpet (woven)", "Bath mat", "Doormat", "Mats"])
@pytest.mark.parametrize("height", [0, 0.00005, 0.001, 0.005, 0.01, 0.03])
def test_floor_covering_keeps_its_footprint_and_at_least_five_mm_height(name, height):
    result = measure_object(points=cuboid(width=2, height=height, depth=1.4), obj={"objectId": "rug", "name": name, "mount": "floor"}, room=room())
    resolve_floor_support(objects=[result], room=room(), floor_covering_ids={"rug"})
    assert result["sizeM"] == pytest.approx({"width": 2, "height": max(0.005, height), "depth": 1.4})
    assert result["placement"]["elevationM"] == 0


def test_other_objects_keep_their_measured_height():
    result = measure_object(points=cuboid(width=2, height=0.001, depth=1.4), obj={"objectId": "platform", "name": "Platform", "mount": "floor"}, room=room())
    assert result["sizeM"]["height"] == pytest.approx(0.001)


def test_ceiling_rug_does_not_receive_floor_covering_minimum():
    result = measure_object(points=cuboid(width=2, height=0.001, depth=1.4, elevation=2.799), obj={"objectId": "rug", "name": "Rug", "mount": "ceiling"}, room=room())
    assert result["sizeM"]["height"] == pytest.approx(0.001)


@pytest.mark.parametrize("height,elevation,expected_height", [
    (0, -0.001, 0.005),
    (0.00005, -0.005, 0.005),
    (0.001, -0.001, 0.005),
    (0.001, -0.005, 0.005),
    (0.01, -0.001, 0.009),
    (0.02, -0.005, 0.015),
    (0, 0.028, 0.028),
    (0.00005, 0.028, 0.02805),
    (0.01, 0.02, 0.03),
])
def test_rug_minimum_survives_floor_noise(height, elevation, expected_height):
    result = measure_object(points=cuboid(width=2, height=height, depth=1.4, elevation=elevation), obj={"objectId": "rug", "name": "Rug", "mount": "floor"}, room=room())
    resolve_floor_support(objects=[result], room=room(), floor_covering_ids={"rug"})
    assert result["sizeM"] == pytest.approx({"width": 2, "height": expected_height, "depth": 1.4})
    assert result["placement"]["elevationM"] == 0


def test_supported_thin_rug_keeps_its_elevation():
    platform = measure_object(points=cuboid(width=2, height=0.2, depth=1.4), obj={"objectId": "platform", "mount": "floor"}, room=room())
    rug = measure_object(points=cuboid(width=2, height=0.001, depth=1.4, elevation=0.2), obj={"objectId": "rug", "name": "Rug", "mount": "floor"}, room=room())
    resolve_floor_support(objects=[platform, rug], room=room(), floor_covering_ids={"rug"})
    assert rug["sizeM"]["height"] == pytest.approx(0.005)
    assert rug["placement"]["elevationM"] == pytest.approx(0.2)


def test_furniture_over_a_rug_is_not_supported_by_it():
    rug = measure_object(points=cuboid(width=2, height=0.01, depth=1.4), obj={"objectId": "rug", "name": "Rug", "mount": "floor"}, room=room())
    sofa = measure_object(points=cuboid(width=1.8, height=0.8, depth=0.9, elevation=0.05), obj={"objectId": "sofa", "name": "Sofa", "mount": "floor"}, room=room())
    resolve_floor_support(objects=[rug, sofa], room=room(), floor_covering_ids={"rug"})
    assert sofa["placement"]["elevationM"] == 0
    assert sofa["sizeM"]["height"] == pytest.approx(0.85)


@pytest.mark.parametrize("name,expected", [
    ("Rug", True),
    ("Carpet (woven)", True),
    ("Runner rug", True),
    ("Rug, wool", True),
    ("Rug.", True),
    ("Persian rug - red", True),
    ("Rug with fringe", True),
    ("Table mat", True),
    ("Bath mat", True),
    ("Doormat", True),
    ("Mats", True),
    ("Rug rack", False),
    ("Carpet cleaner", False),
    ("Coffee table (on rug)", False),
    ("Chair (mat finish)", False),
])
def test_floor_covering_is_detected_by_its_head_noun(name, expected):
    assert is_floor_covering({"name": name, "mount": "floor"}) is expected


def test_rug_representative_view_ignores_height():
    measured = measure_views(
        views=[({"photoId": photo_id}, cuboid(width=width, height=height, depth=1.4)) for photo_id, width, height in (("a", 2.0, 0.006), ("b", 2.1, 0.010), ("c", 2.2, 0.008))],
        obj={"objectId": "rug", "name": "Rug", "mount": "floor"},
        room=room(),
    )
    assert measured["sizeM"]["width"] == pytest.approx(2.1)


def test_rug_views_agree_within_five_mm_of_height():
    measured = measure_views(
        views=[({"photoId": photo_id}, cuboid(width=2, height=height, depth=1.4)) for photo_id, height in (("a", 0.006), ("b", 0.012))],
        obj={"objectId": "rug", "name": "Rug", "mount": "floor"},
        room=room(),
    )
    assert measured["sizeM"]["width"] == pytest.approx(2)


def test_floor_noise_snaps_base_to_floor_and_keeps_measured_top():
    points = cuboid(height=1.2, elevation=-0.01)
    result = measure_object(points=points, obj={"objectId": "fridge", "mount": "floor"}, room=room())
    resolve_floor_support(objects=[result], room=room())
    assert result["placement"]["elevationM"] == 0
    assert result["sizeM"]["height"] == pytest.approx(1.19)


def test_wall_anchor_uses_distance_from_start_and_back_center():
    points = cuboid(width=1.2, height=0.4, depth=0.2, x=-2.9, z=1, elevation=1.7, angle=math.pi / 2)
    result = measure_object(points=points, obj={"objectId": "aircon", "mount": "wall"}, room=room())
    assert result["sizeM"] == pytest.approx({"width": 1.2, "height": 0.4, "depth": 0.2})
    assert result["placement"] == {"kind": "wall", "wallId": "left", "alongM": 5.0, "heightM": pytest.approx(1.9), "rotationRad": 0}


def test_open_wall_is_not_a_mount_target():
    current_room = room()
    current_room["walls"][0]["kind"] = "open"
    points = cuboid(width=0.8, height=0.4, depth=0.2, x=-2.9, z=-3.9, elevation=1.7)
    result = measure_object(points=points, obj={"objectId": "aircon", "mount": "wall"}, room=current_room)
    assert result["placement"]["wallId"] == "back"


def test_ceiling_box_measures_to_ceiling_anchor():
    points = cuboid(width=0.8, height=0.4, depth=0.5, x=0.2, z=0.7, elevation=2.4)
    result = measure_object(points=points, obj={"objectId": "light", "mount": "ceiling"}, room=room())
    assert result["placement"] == {"kind": "ceiling", "xM": pytest.approx(0.2), "zM": pytest.approx(0.7), "rotationRad": pytest.approx(0)}
    assert result["sizeM"] == pytest.approx({"width": 0.8, "height": 0.4, "depth": 0.5})


def test_isolated_outliers_do_not_set_box_dimensions():
    points = np.concatenate([cuboid(angle=0.3), [[100, 100, -100], [-100, -100, 100]]])
    result = measure_object(points=points, obj={"objectId": "sofa", "mount": "floor"}, room=room())
    assert result["sizeM"] == pytest.approx({"width": 1.8, "height": 0.8, "depth": 0.6}, abs=0.03)


def test_mask_mapping_uses_resize_crop_and_valid_points(tmp_path):
    rows, columns = np.mgrid[:12, :12]
    points = np.stack([columns, rows, np.ones(rows.shape)], axis=-1).astype(float)
    mask = np.zeros((56, 64), dtype=np.uint8)
    mask[28:, 32:] = 255
    Image.fromarray(mask).save(tmp_path / "mask.png")
    scene = {"names": np.array(["photo"]), "world_points": points[None], "masks": np.ones((1, 12, 12), dtype=bool), "transforms": np.array([[0.5, 2, 1]]), "image_sizes": np.array([[32, 28]])}
    scene["masks"][0, 6, 6] = False
    scene["world_points"][0, 6, 7] = np.nan
    selected = read_points(scene=scene, view={"photoId": "photo", "maskPath": "mask.png"}, photo={"widthPx": 64, "heightPx": 56}, masks_dir=tmp_path)
    assert selected == pytest.approx(points[6:, 6:].reshape(-1, 3)[2:])


def fixture(*, tmp_path):
    points = cuboid().reshape(40, 60, 3)
    scene_path = tmp_path / "scene.npz"
    np.savez(scene_path, names=np.array(["photo-a", "photo-b"]), world_points=np.stack([points, points]), masks=np.ones((2, 40, 60), dtype=bool), transforms=np.array([[1, 0, 0], [1, 0, 0]]), image_sizes=np.array([[60, 40], [60, 40]]))
    photo_path = tmp_path / "photos.json"
    photo_path.write_text(json.dumps({"photos": [{"photoId": photo_id, "kind": "accepted", "origin": "capture", "widthPx": 60, "heightPx": 40} for photo_id in ("photo-a", "photo-b")]}))
    sparse = np.zeros((40, 60), dtype=np.uint8)
    sparse[0, :5] = 255
    Image.fromarray(sparse).save(tmp_path / "sparse.png")
    Image.fromarray(np.full((40, 60), 255, dtype=np.uint8)).save(tmp_path / "full.png")
    masks_path = tmp_path / "masks.json"
    masks_path.write_text(json.dumps({"objects": [
        {"objectId": "sofa", "views": [{"photoId": "photo-a", "maskPath": "sparse.png"}, {"photoId": "photo-b", "maskPath": "full.png"}]},
        {"objectId": "hidden", "views": [{"photoId": "photo-a", "maskPath": "sparse.png"}]},
    ]}))
    return {"scenePath": str(scene_path), "photosPath": str(photo_path), "masksPath": str(masks_path), "room": room(), "objects": [
        {"objectId": "sofa", "mount": "floor", "views": [{"photoId": "photo-a"}, {"photoId": "photo-b"}]},
        {"objectId": "hidden", "mount": "floor", "views": [{"photoId": "photo-a"}]},
    ], "outputDir": str(tmp_path / "result")}


def test_multiple_views_keep_valid_object_when_other_object_is_sparse(tmp_path):
    request = fixture(tmp_path=tmp_path)
    result = run(request)
    assert [obj["objectId"] for obj in result["objects"]] == ["sofa"]
    assert result["objects"][0]["sizeM"] == pytest.approx({"width": 1.8, "height": 0.8, "depth": 0.6})
    assert result["failures"] == [{"objectId": "hidden", "message": "Object masks have fewer than 30 reconstructed points"}]
    assert json.loads((tmp_path / "result" / "measurement.json").read_text()) == result


@pytest.mark.parametrize("elevation", [0, 0.028, 0.04])
def test_planar_rug_views_keep_the_measured_top(tmp_path, elevation):
    request = fixture(tmp_path=tmp_path)
    request["objects"][0]["name"] = "Rug"
    with np.load(request["scenePath"]) as stored:
        scene = dict(stored)
    scene["world_points"][1, :, :, 1] = elevation
    np.savez(request["scenePath"], **scene)
    result = run(request)
    measured, = result["objects"]
    assert measured["sizeM"]["height"] == pytest.approx(max(0.005, elevation))
    assert measured["placement"]["elevationM"] == 0


@pytest.mark.parametrize("visibility", ["mostly-visible", "more-than-half-hidden"])
def test_full_rug_view_survives_a_planar_view(visibility):
    measured = measure_views(
        views=[({"photoId": "top", "visibility": visibility}, cuboid(width=2, height=0, depth=1.4, elevation=0.01)), ({"photoId": "full", "visibility": "more-than-half-hidden"}, cuboid(width=2, height=0.01, depth=1.4))],
        obj={"objectId": "rug", "name": "Rug", "mount": "floor", "bestPhotoId": "top"},
        room=room(),
    )
    resolve_floor_support(objects=[measured], room=room(), floor_covering_ids={"rug"})
    assert measured["sizeM"] == pytest.approx({"width": 2, "height": 0.01, "depth": 1.4})
    assert measured["placement"]["elevationM"] == 0


def test_worker_emits_progress_then_result_without_loading_models(tmp_path):
    request = fixture(tmp_path=tmp_path)
    process = subprocess.run([sys.executable, str(Path(__file__).parents[1] / "workers" / "measure.py")], input=json.dumps(request), capture_output=True, text=True, timeout=10, check=True)
    events = [json.loads(line) for line in process.stdout.splitlines()]
    assert events[-1]["kind"] == "result"
    assert events[-1]["result"]["objects"][0]["objectId"] == "sofa"
    assert [event["progress"] for event in events[:-1]] == [0.5, 1]


def test_empty_inventory_is_valid(tmp_path):
    request = fixture(tmp_path=tmp_path)
    request["objects"] = []
    assert run(request) == {"objects": [], "failures": []}


def test_planar_or_sparse_points_fail_instead_of_inventing_size():
    for points in (np.zeros((5, 3)), cuboid(depth=0)):
        with pytest.raises(ValueError, match="fewer than 30|width and depth"):
            measure_object(points=points, obj={"objectId": "unknown", "mount": "floor"}, room=room())


def test_tilted_wall_item_keeps_its_measured_roll():
    points = cuboid(width=1.2, height=0.4, depth=0.2, elevation=-0.2)
    angle = 0.3
    roll = np.array([[math.cos(angle), -math.sin(angle), 0], [math.sin(angle), math.cos(angle), 0], [0, 0, 1]])
    yaw = np.array([[0, 0, 1], [0, 1, 0], [-1, 0, 0]])
    points = points @ roll.T @ yaw.T + [-2.9, 1.9, 1]
    result = measure_object(points=points, obj={"objectId": "frame", "mount": "wall"}, room=room())
    assert result["sizeM"] == pytest.approx({"width": 1.2, "height": 0.4, "depth": 0.2}, abs=0.02)
    assert result["placement"] == {"kind": "wall", "wallId": "left", "alongM": pytest.approx(5), "heightM": pytest.approx(1.9), "rotationRad": pytest.approx(angle)}


def test_tall_wall_item_does_not_swap_width_and_height():
    points = cuboid(width=0.4, height=1.2, depth=0.2, x=-2.9, z=1, elevation=1, angle=math.pi / 2)
    result = measure_object(points=points, obj={"objectId": "panel", "mount": "wall"}, room=room())
    assert result["sizeM"] == pytest.approx({"width": 0.4, "height": 1.2, "depth": 0.2})
    assert result["placement"]["rotationRad"] == pytest.approx(0)


def test_floor_item_does_not_require_closed_walls():
    current_room = room()
    for wall in current_room["walls"]:
        wall["kind"] = "open"
    result = measure_object(points=cuboid(), obj={"objectId": "table", "mount": "floor"}, room=current_room)
    assert result["placement"]["kind"] == "floor"


def test_rejected_or_chat_photo_cannot_supply_measurement_points(tmp_path):
    request = fixture(tmp_path=tmp_path)
    path = Path(request["photosPath"])
    manifest = json.loads(path.read_text())
    manifest["photos"][0]["origin"] = "chat"
    path.write_text(json.dumps(manifest))
    result = run(request)
    assert result["objects"] == []
    assert all(failure["message"] == "Object view does not name an accepted capture photo" for failure in result["failures"])


def test_mask_path_cannot_leave_job_directory(tmp_path):
    request = fixture(tmp_path=tmp_path)
    path = Path(request["masksPath"])
    masks = json.loads(path.read_text())
    masks["objects"][0]["views"][0]["maskPath"] = "../outside.png"
    path.write_text(json.dumps(masks))
    result = run(request)
    assert result["failures"][0] == {"objectId": "sofa", "message": "Mask path must stay inside the masks directory"}


def measure_inventory(objects):
    measured = [measure_object(points=points, obj={"objectId": name, "mount": "floor"}, room=room()) for name, points in objects]
    resolve_floor_support(objects=measured, room=room())
    return {obj["objectId"]: obj for obj in measured}


@pytest.mark.parametrize("bottom", [0.07, 0.10, 0.35])
def test_occluded_floor_items_snap_to_floor_and_preserve_measured_top(bottom):
    points = cuboid(height=1.2)
    measured = measure_inventory([("fridge", points[points[:, 1] >= bottom])])["fridge"]
    assert measured["placement"]["elevationM"] == 0
    assert measured["sizeM"]["height"] == pytest.approx(1.2)


@pytest.mark.parametrize("reverse", [False, True])
def test_support_resolution_preserves_tv_and_table_lamp_in_any_order(reverse):
    objects = [
        ("tv", cuboid(width=1.18, height=0.68, depth=0.08, elevation=0.72)),
        ("console", cuboid(width=1.5, height=0.63, depth=0.4, elevation=0.09)),
        ("lamp", cuboid(width=0.2, depth=0.2, height=0.4, x=2, elevation=0.8)),
        ("table", cuboid(width=0.8, depth=0.6, height=0.8, x=2)),
    ]
    measured = measure_inventory(objects[::-1] if reverse else objects)
    assert measured["tv"]["placement"]["elevationM"] == pytest.approx(0.72)
    assert measured["tv"]["sizeM"]["height"] == pytest.approx(0.68)
    assert measured["console"]["placement"]["elevationM"] == 0
    assert measured["console"]["sizeM"]["height"] == pytest.approx(0.72)
    assert measured["lamp"]["placement"]["elevationM"] == pytest.approx(0.8)
    assert measured["table"]["placement"]["elevationM"] == 0


def test_support_requires_bottom_near_top_and_center_in_rotated_footprint():
    measured = measure_inventory([
        ("console", cuboid(width=2, depth=0.3, height=0.7, angle=math.pi / 2)),
        ("supported", cuboid(width=0.2, depth=0.1, height=0.4, z=0.7, elevation=0.73)),
        ("beside", cuboid(width=0.2, depth=0.1, height=0.4, x=0.7, elevation=0.73)),
        ("above", cuboid(width=0.2, depth=0.1, height=0.4, z=-0.7, elevation=1.1)),
    ])
    assert measured["supported"]["placement"]["elevationM"] == pytest.approx(0.73)
    assert measured["beside"]["placement"]["elevationM"] == 0
    assert measured["above"]["placement"]["elevationM"] == 0


@pytest.mark.parametrize("mount", ["floor", "ceiling"])
def test_objects_outside_room_fail_measurement(mount):
    with pytest.raises(ValueError, match="outside the room"):
        measure_object(points=cuboid(z=4.4), obj={"objectId": "balcony-table", "mount": mount}, room=room())


def test_door_on_room_boundary_remains_wall_item():
    result = measure_object(points=cuboid(z=4.05), obj={"objectId": "door", "mount": "wall"}, room=room())
    assert result["placement"]["wallId"] == "front"


def test_room_filter_uses_polygon_and_includes_edges():
    current_room = {"walls": [{"startM": {"x": x, "z": z}} for x, z in [(0, 0), (0, 3), (1, 3), (1, 1), (3, 1), (3, 0)]]}
    assert inside_room(center=np.array([0.5, 2]), room=current_room)
    assert not inside_room(center=np.array([2, 2]), room=current_room)
    assert inside_room(center=np.array([1, 2]), room=current_room)
    assert inside_room(center=np.array([0, 0]), room=current_room)


def test_outside_object_is_reported_without_losing_inside_object(tmp_path):
    request = fixture(tmp_path=tmp_path)
    with np.load(request["scenePath"]) as stored:
        scene = dict(stored)
    scene["world_points"][0, :, :, 2] += 5
    np.savez(request["scenePath"], **scene)
    masks_path = Path(request["masksPath"])
    masks = json.loads(masks_path.read_text())
    masks["objects"][0]["views"] = [{"photoId": "photo-b", "maskPath": "full.png"}]
    masks["objects"][1]["views"] = [{"photoId": "photo-a", "maskPath": "full.png"}]
    masks_path.write_text(json.dumps(masks))
    result = run(request)
    assert [obj["objectId"] for obj in result["objects"]] == ["sofa"]
    assert result["failures"] == [{"objectId": "hidden", "message": "Skipped because its measured footprint centre is outside the room"}]


@pytest.mark.parametrize("reverse", [False, True])
def test_measured_wall_console_supports_a_tv(reverse):
    console = measure_object(points=cuboid(width=1.5, height=0.3, depth=0.4, x=-2.8, elevation=0.4, angle=math.pi / 2), obj={"objectId": "console", "mount": "wall"}, room=room())
    tv = measure_object(points=cuboid(width=1.18, height=0.68, depth=0.08, x=-2.8, elevation=0.7, angle=math.pi / 2), obj={"objectId": "tv", "mount": "floor"}, room=room())
    objects = [console, tv] if reverse else [tv, console]
    resolve_floor_support(objects=objects, room=room())
    assert tv["placement"]["elevationM"] == pytest.approx(0.7)
    assert tv["sizeM"]["height"] == pytest.approx(0.68)


def test_wall_fixture_wholly_outside_room_is_rejected():
    with pytest.raises(ValueError, match="outside the room"):
        measure_object(points=cuboid(z=8), obj={"objectId": "aircon", "mount": "wall"}, room=room())


def test_below_floor_object_fails_without_losing_valid_object(tmp_path):
    request = fixture(tmp_path=tmp_path)
    with np.load(request["scenePath"]) as stored:
        scene = dict(stored)
    scene["world_points"][0, :, :, 1] -= 0.9
    np.savez(request["scenePath"], **scene)
    masks_path = Path(request["masksPath"])
    masks = json.loads(masks_path.read_text())
    masks["objects"][0]["views"] = [{"photoId": "photo-b", "maskPath": "full.png"}]
    masks["objects"][1]["views"] = [{"photoId": "photo-a", "maskPath": "full.png"}]
    masks_path.write_text(json.dumps(masks))
    result = run(request)
    assert [obj["objectId"] for obj in result["objects"]] == ["sofa"]
    assert result["failures"] == [{"objectId": "hidden", "message": "Object points do not determine three positive dimensions"}]


def test_multiview_measurement_excludes_adjacent_object_points(tmp_path):
    request = fixture(tmp_path=tmp_path)
    with np.load(request["scenePath"]) as stored:
        scene = dict(stored)
    adjacent = cuboid(width=1.0, x=1.4).reshape(40, 60, 3)
    scene["world_points"] = np.concatenate((scene["world_points"], np.stack((adjacent, adjacent))), axis=2)
    scene["masks"] = np.ones((2, 40, 120), dtype=bool)
    scene["image_sizes"][:, 0] = 120
    np.savez(request["scenePath"], **scene)

    photos_path = Path(request["photosPath"])
    photos = json.loads(photos_path.read_text())
    for photo in photos["photos"]:
        photo["widthPx"] = 120
    photos_path.write_text(json.dumps(photos))

    exclusion = np.zeros((40, 120), dtype=np.uint8)
    exclusion[:, 60:] = 255
    Image.fromarray(exclusion).save(tmp_path / "adjacent.png")
    Image.fromarray(np.full_like(exclusion, 255)).save(tmp_path / "full.png")
    views = [{"photoId": photo_id, "maskPath": "full.png"} for photo_id in ("photo-a", "photo-b")]
    masks_path = Path(request["masksPath"])
    masks_path.write_text(json.dumps({"objects": [
        {"objectId": "sofa", "views": views},
        {"objectId": "adjacent", "views": [{**view, "maskPath": "adjacent.png"} for view in views]},
    ]}))
    request["objects"] = request["objects"][:1]

    result = run(request)
    assert result["failures"] == []
    measured, = result["objects"]
    assert measured["sizeM"] == pytest.approx({"width": 1.8, "height": 0.8, "depth": 0.6})
    assert measured["placement"]["xM"] == pytest.approx(0)
    assert measured["placement"]["elevationM"] == 0


def test_mask_subtracts_other_objects_on_same_photo(tmp_path):
    request = fixture(tmp_path=tmp_path)
    with np.load(request["scenePath"]) as stored:
        scene = dict(stored)
    excluded = np.zeros((40, 60), dtype=np.uint8)
    excluded[:, 30:] = 255
    Image.fromarray(excluded).save(tmp_path / "excluded.png")
    actual = read_points(scene=scene, view={"photoId": "photo-b", "maskPath": "full.png"}, photo={"widthPx": 60, "heightPx": 40}, masks_dir=tmp_path, excluded_views=[{"maskPath": "excluded.png"}])
    assert actual == pytest.approx(scene["world_points"][1, :, :30].reshape(-1, 3))


def test_view_consensus_rejects_large_mask_and_prefers_visible_views():
    normal = cuboid()
    bad = cuboid(width=3, height=2, depth=2)
    visible = {"visibility": "mostly-visible"}
    hidden = {"visibility": "more-than-half-hidden"}
    obj = {"objectId": "desk", "mount": "floor"}
    for views in ([(visible, normal), (visible, normal), (visible, bad)], [(visible, normal), (hidden, bad), (hidden, bad)]):
        measured = measure_views(views=views, obj=obj, room=room())
        assert measured["sizeM"] == pytest.approx({"width": 1.8, "height": 0.8, "depth": 0.6})


def test_largest_cluster_removes_disconnected_points_and_trims_spikes():
    main = cuboid()
    other = cuboid(width=0.2, height=0.2, depth=0.2, x=2)[::4]
    points = np.concatenate([main, other, [[0.92, 0.4, 0], [0, 0.82, 0]]])
    cleaned = clean_view_points(points)
    assert len(cleaned) >= 30
    assert np.max(cleaned[:, 0]) <= 0.9
    assert np.max(cleaned[:, 1]) <= 0.8
    assert clean_view_points(points[::-1]) == pytest.approx(cleaned[::-1])


@pytest.mark.parametrize("box", [[0, 10, 90, 90], [10, 0, 90, 90], [10, 10, 100, 90], [10, 10, 90, 100]])
def test_boxes_cut_by_any_image_edge_are_rejected(box):
    photo = {"visionWidthPx": 100, "visionHeightPx": 100, "widthPx": 400, "heightPx": 400}
    assert clipped_view(view={"box": box}, photo=photo)
    assert not clipped_view(view={"box": [10, 10, 90, 90]}, photo=photo)


def test_all_hidden_views_can_still_agree():
    obj = {"objectId": "desk", "mount": "floor"}
    measured = measure_views(views=[({"visibility": "more-than-half-hidden"}, cuboid())], obj=obj, room=room())
    assert measured["sizeM"]["width"] == pytest.approx(1.8)


def test_disagreeing_views_fail_instead_of_inventing_consensus():
    with pytest.raises(ValueError, match="no measurement consensus"):
        measure_views(views=[({}, cuboid(width=0.4)), ({}, cuboid(width=2))], obj={"objectId": "desk", "mount": "floor"}, room=room())


@pytest.mark.parametrize("offset", [0.4, 0.5])
def test_offset_views_cannot_enlarge_consensus_dimensions(offset):
    visible = {"visibility": "mostly-visible"}
    measured = measure_views(views=[(visible, cuboid(width=1.3, height=0.72, depth=0.72, x=x)) for x in (-offset, offset)], obj={"objectId": "desk", "mount": "floor"}, room=room())
    assert measured["sizeM"] == pytest.approx({"width": 1.3, "height": 0.72, "depth": 0.72})
