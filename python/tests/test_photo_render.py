import math
import os
from pathlib import Path
import subprocess
import sys

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "blender"))

from photo_geometry import item_frame, kelvin_rgb, wall_polygons, wall_segments


def room():
    return {"ceilingHeightM": 3, "walls": [{"id": name, "kind": "solid", "startM": {"x": x, "z": z}} for name, x, z in [("a", 0, 0), ("b", 0, 4), ("c", 5, 4), ("d", 5, 0)]]}


def area(polygon):
    return abs(sum(a[0] * polygon[(i + 1) % len(polygon)][1] - polygon[(i + 1) % len(polygon)][0] * a[1] for i, a in enumerate(polygon))) / 2


def test_overlapping_openings_are_subtracted_once_and_do_not_block_the_floor():
    opening = {"cutsOpening": True, "sizeM": {"width": 1, "height": 2, "depth": 0.8}, "placement": {"kind": "wall", "wallId": "a", "alongM": 2, "heightM": 1.02, "rotationRad": 0}}
    pieces = wall_polygons(wall_segments(room())[0], 3, [opening, opening])
    assert sum(area(piece) for piece in pieces) == pytest.approx(12 - 2.02)


def test_rotated_opening_area_and_item_anchor_match_wall_coordinates():
    opening = {"cutsOpening": True, "sizeM": {"width": 1, "height": 1, "depth": 0.8}, "placement": {"kind": "wall", "wallId": "a", "alongM": 2, "heightM": 1.5, "rotationRad": math.pi / 4}}
    segments = wall_segments(room())
    assert sum(area(piece) for piece in wall_polygons(segments[0], 3, [opening])) == pytest.approx(11)
    position, yaw, roll, depth = item_frame(opening, room(), segments)
    assert position == pytest.approx([-0.12, 1.5, 2])
    assert yaw == pytest.approx(math.pi / 2)
    assert roll == pytest.approx(math.pi / 4)
    assert depth == 0.12


def test_kelvin_warm_light_has_more_red_and_cool_light_has_more_blue():
    warm = kelvin_rgb(2700)
    cool = kelvin_rgb(6500)
    assert warm[0] > warm[2]
    assert cool[2] > warm[2]
    assert all(0 <= channel <= 1 for channel in (*warm, *cool))


def test_cycles_switches_between_daylight_and_evening_and_preserves_lamp_units(tmp_path):
    script = tmp_path / "check_lighting.py"
    script.write_text('''
import math
import sys
import bpy
from mathutils import Matrix, Vector
sys.path.insert(0, sys.argv[sys.argv.index("--") + 1])
from render_photo import add_light, configure_scene, LUMENS_PER_WATT

lamp = {"id": "lamp", "name": "Lamp", "placement": {"kind": "floor"}, "sizeM": {"width": 1, "height": 2, "depth": 1}, "light": {"on": True, "lumens": 683, "temperatureK": 2700, "emitter": {"x": 0.5, "y": 0.7, "z": 0.5}, "beam": {"direction": {"x": 0, "y": -1, "z": 0}, "angleDeg": 100}}}
manifest = {"scene": {"items": [], "room": {"ceilingHeightM": 3, "walls": [{"startM": {"x": x, "z": z}} for x, z in [(0, 0), (4, 0), (4, 5), (0, 5)]]}}, "output": {"samples": 1, "widthPx": 64, "heightPx": 36}, "view": {"positionM": {"x": 2, "y": 1.6, "z": 0.5}, "targetM": {"x": 2, "y": 1.6, "z": 4}, "fovDeg": 60}}
for items, evening in [([], False), ([{"light": {"on": False}}], False), ([lamp], True), ([{"light": {"on": False}}, lamp, lamp], True)]:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    manifest["scene"]["items"] = items
    scene = configure_scene(manifest)
    background = scene.world.node_tree.nodes["Background"]
    assert math.isclose(scene.view_settings.exposure, 2.5 if evening else -0.75)
    assert math.isclose(background.inputs["Strength"].default_value, 0.03 if evening else 1.5, rel_tol=1e-6)
    expected = (0.035, 0.055, 0.12, 1) if evening else (0.55, 0.72, 1, 1)
    assert all(math.isclose(a, b, rel_tol=1e-6) for a, b in zip(background.inputs["Color"].default_value, expected))
    fill = bpy.data.objects.get("Soft room fill")
    assert (fill is None) == evening
    if fill:
        assert fill.data.energy == 80
    assert math.isclose(scene.camera.data.angle_y, math.radians(60), rel_tol=1e-6)
add_light(lamp, Matrix.Identity(4), [], 1)
source = bpy.data.objects["Lamp light"]
assert LUMENS_PER_WATT == 683
assert source.data.energy == 1
assert (source.rotation_euler.to_matrix() @ Vector((0, 0, -1))).z < -0.999
assert math.isclose(source.data.spot_size, math.radians(100), rel_tol=1e-6)
print("LIGHTING PASS")
''')
    result = subprocess.run(
        [os.environ.get("BLENDER", "/Applications/Blender.app/Contents/MacOS/Blender"), "--background", "--factory-startup", "--python-exit-code", "1", "--python", str(script), "--", str(Path(__file__).resolve().parents[2] / "blender")],
        capture_output=True, text=True, timeout=60, check=True,
    )
    assert "LIGHTING PASS" in result.stdout
