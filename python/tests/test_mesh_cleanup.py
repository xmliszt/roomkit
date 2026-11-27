from pathlib import Path
import sys

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "blender"))

from mesh_cleanup import clean_mesh, label_components, weld


def build_box(*, low, high, divisions=4):
    low, high = np.asarray(low, dtype=float), np.asarray(high, dtype=float)
    vertices, faces = [], []
    steps = np.linspace(0, 1, divisions + 1)
    for axis in range(3):
        others = [other for other in range(3) if other != axis]
        for side in (0, 1):
            start = len(vertices)
            for u in steps:
                for v in steps:
                    point = np.empty(3)
                    point[axis] = (low if side == 0 else high)[axis]
                    point[others[0]] = low[others[0]] + u * (high - low)[others[0]]
                    point[others[1]] = low[others[1]] + v * (high - low)[others[1]]
                    vertices.append(point)
            for i in range(divisions):
                for j in range(divisions):
                    a = start + i * (divisions + 1) + j
                    b, c, d = a + 1, a + divisions + 1, a + divisions + 2
                    faces.extend([(a, c, b), (b, c, d)])
    return np.array(vertices), np.array(faces)


def combine(*parts):
    vertices, faces, offset = [], [], 0
    for part_vertices, part_faces in parts:
        vertices.append(part_vertices)
        faces.append(part_faces + offset)
        offset += len(part_vertices)
    return np.concatenate(vertices), np.concatenate(faces)


def kept_bounds(*, vertices, faces, keep):
    used = vertices[faces[keep]].reshape(-1, 3)
    return used.min(axis=0), used.max(axis=0)


BEAN_BAG = build_box(low=(-0.3, -0.27, 0.0), high=(0.3, 0.27, 0.4), divisions=8)
FLOOR = build_box(low=(-1.0, -1.0, -0.02), high=(1.0, 1.0, 0.0), divisions=24)
EXPECTED = (1.0, 0.92, 0.67)


@pytest.mark.parametrize("floor", [FLOOR, build_box(low=(-1.0, -1.0, -0.05), high=(1.0, 1.0, -0.03), divisions=24)])
def test_object_on_floor_slab_keeps_the_object_only(floor):
    vertices, faces = combine(BEAN_BAG, floor)
    keep, report = clean_mesh(vertices=vertices, faces=faces, expected=EXPECTED, is_floor_covering=False)
    low, high = kept_bounds(vertices=vertices, faces=faces, keep=keep)
    assert np.allclose(low[:2], (-0.3, -0.27), atol=0.1) and np.allclose(high[:2], (0.3, 0.27), atol=0.1)
    assert high[2] == pytest.approx(0.4)
    under = vertices[faces[keep]].mean(axis=1)
    under = under[under[:, 2] < 0]
    assert (np.abs(under[:, 0]) <= 0.4).all() and (np.abs(under[:, 1]) <= 0.37).all()
    assert report["removedSides"] == ["-z"]
    assert report["removedAreaShare"] > 0.5


def test_back_wall_slab_is_removed():
    wall = build_box(low=(-1.0, 0.27, -0.1), high=(1.0, 0.3, 1.2), divisions=24)
    vertices, faces = combine(BEAN_BAG, wall)
    keep, report = clean_mesh(vertices=vertices, faces=faces, expected=EXPECTED, is_floor_covering=False)
    low, high = kept_bounds(vertices=vertices, faces=faces, keep=keep)
    assert high[2] == pytest.approx(0.4, abs=0.15)
    assert "+y" in report["removedSides"]


def test_loose_scraps_are_dropped():
    scrap = build_box(low=(0.8, 0.8, 0.6), high=(0.82, 0.82, 0.62), divisions=1)
    vertices, faces = combine(BEAN_BAG, scrap)
    keep, _ = clean_mesh(vertices=vertices, faces=faces, expected=EXPECTED, is_floor_covering=False)
    assert keep[: len(BEAN_BAG[1])].all() and not keep[len(BEAN_BAG[1]):].any()


def test_a_base_that_belongs_to_the_object_stays():
    lamp_base = build_box(low=(-0.2, -0.2, 0.0), high=(0.2, 0.2, 0.03), divisions=8)
    stem = build_box(low=(-0.02, -0.02, 0.03), high=(0.02, 0.02, 1.6), divisions=8)
    vertices, faces = combine(lamp_base, stem)
    keep, report = clean_mesh(vertices=vertices, faces=faces, expected=(0.4, 0.4, 1.6), is_floor_covering=False)
    assert keep.all()
    assert report["removedSides"] == []


def test_floor_covering_keeps_its_slab():
    vertices, faces = FLOOR
    keep, _ = clean_mesh(vertices=vertices, faces=faces, expected=(2.0, 2.0, 0.02), is_floor_covering=True)
    assert keep.all()


def test_uv_seam_duplicates_stay_one_component():
    vertices, faces = BEAN_BAG
    split = np.concatenate([vertices, vertices[faces[0]]])
    seam_faces = faces.copy()
    seam_faces[0] = np.arange(len(vertices), len(vertices) + 3)
    labels = label_components(faces=seam_faces, ids=weld(split))
    assert len(np.unique(labels)) == 1


def test_thin_separate_legs_that_carry_the_height_stay():
    top = build_box(low=(-0.6, -0.3, 0.7), high=(0.6, 0.3, 0.73), divisions=8)
    legs = [build_box(low=(x - 0.01, y - 0.01, 0.0), high=(x + 0.01, y + 0.01, 0.69), divisions=2) for x in (-0.55, 0.55) for y in (-0.25, 0.25)]
    vertices, faces = combine(top, *legs)
    keep, _ = clean_mesh(vertices=vertices, faces=faces, expected=(1.2, 0.6, 0.73), is_floor_covering=False)
    assert keep.all()


@pytest.mark.parametrize("estimate_width", [0.3, 0.36, 0.42, 0.5])
def test_floor_lamp_keeps_its_base(estimate_width):
    base = build_box(low=(-0.25, -0.25, 0.0), high=(0.25, 0.25, 0.03), divisions=8)
    stem = build_box(low=(-0.015, -0.015, 0.03), high=(0.015, 0.015, 1.3), divisions=4)
    shade = build_box(low=(-0.15, -0.15, 1.3), high=(0.15, 0.15, 1.6), divisions=6)
    vertices, faces = combine(base, stem, shade)
    keep, report = clean_mesh(vertices=vertices, faces=faces, expected=(estimate_width, estimate_width, 1.6), is_floor_covering=False)
    assert keep.all()
    assert report["removedSides"] == []


def test_table_on_a_floor_slab_loses_the_slab_and_keeps_its_legs():
    top = build_box(low=(-0.5, -0.25, 0.38), high=(0.5, 0.25, 0.42), divisions=8)
    legs = [build_box(low=(x - 0.02, y - 0.02, 0.0), high=(x + 0.02, y + 0.02, 0.38), divisions=2) for x in (-0.45, 0.45) for y in (-0.2, 0.2)]
    table = combine(top, *legs)
    vertices, faces = combine(table, FLOOR)
    keep, report = clean_mesh(vertices=vertices, faces=faces, expected=(1.0, 0.5, 0.42), is_floor_covering=False)
    assert keep[: len(table[1])].all() and not keep[len(table[1]):].any()
    assert report["removedSides"] == ["-z"]


def test_cabinet_knobs_stay():
    cabinet = build_box(low=(-0.4, -0.2, 0.0), high=(0.4, 0.2, 0.8), divisions=8)
    knobs = [build_box(low=(x - 0.017, -0.233, 0.503), high=(x + 0.017, -0.203, 0.537), divisions=2) for x in (-0.13, 0.13)]
    vertices, faces = combine(cabinet, *knobs)
    keep, _ = clean_mesh(vertices=vertices, faces=faces, expected=(0.8, 0.4, 0.8), is_floor_covering=False)
    assert keep.all()


def test_sofa_cushion_inside_the_body_stays():
    sofa = build_box(low=(-1.0, -0.45, 0.0), high=(1.0, 0.45, 0.85), divisions=12)
    cushion = build_box(low=(-0.15, -0.43, 0.46), high=(0.15, -0.33, 0.7), divisions=2)
    vertices, faces = combine(sofa, cushion)
    keep, _ = clean_mesh(vertices=vertices, faces=faces, expected=(2.0, 0.9, 0.85), is_floor_covering=False)
    assert keep.all()


def test_floor_patch_just_under_the_body_is_removed():
    patch = build_box(low=(-0.36, -0.33, -0.022), high=(0.36, 0.33, -0.002), divisions=8)
    vertices, faces = combine(BEAN_BAG, patch)
    keep, report = clean_mesh(vertices=vertices, faces=faces, expected=(0.6, 0.54, 0.4), is_floor_covering=False)
    assert keep[: len(BEAN_BAG[1])].all() and not keep[len(BEAN_BAG[1]):].any()
    assert report["removedSides"] == ["-z"]


def test_floor_slab_far_wider_than_a_pedestal_chair_is_removed():
    seat = build_box(low=(-0.4, -0.4, 0.4), high=(0.4, 0.4, 0.5), divisions=8)
    pedestal = build_box(low=(-0.03, -0.03, 0.05), high=(0.03, 0.03, 0.4), divisions=2)
    foot = build_box(low=(-0.1, -0.1, 0.0), high=(0.1, 0.1, 0.05), divisions=4)
    chair = combine(seat, pedestal, foot)
    vertices, faces = combine(chair, build_box(low=(-1.0, -1.0, -0.02), high=(1.0, 1.0, -0.002), divisions=24))
    keep, report = clean_mesh(vertices=vertices, faces=faces, expected=(0.8, 0.8, 0.5), is_floor_covering=False)
    assert keep[: len(chair[1])].all() and not keep[len(chair[1]):].any()
    assert report["removedSides"] == ["-z"]


def test_floor_fragment_beside_the_body_is_dropped():
    fragment = build_box(low=(0.31, -0.05, 0.0), high=(0.36, 0.05, 0.01), divisions=1)
    vertices, faces = combine(BEAN_BAG, fragment)
    keep, _ = clean_mesh(vertices=vertices, faces=faces, expected=(0.6, 0.54, 0.4), is_floor_covering=False)
    assert keep[: len(BEAN_BAG[1])].all() and not keep[len(BEAN_BAG[1]):].any()


def test_floor_slab_under_a_lamp_with_a_separate_thin_base_keeps_the_base():
    shade = build_box(low=(-0.15, -0.15, 1.2), high=(0.15, 0.15, 1.5), divisions=8)
    stem = build_box(low=(-0.015, -0.015, 0.02), high=(0.015, 0.015, 1.2), divisions=2)
    base = build_box(low=(-0.16, -0.16, 0.0), high=(0.16, 0.16, 0.02), divisions=5)
    lamp = combine(shade, stem, base)
    vertices, faces = combine(lamp, build_box(low=(-0.8, -0.8, -0.02), high=(0.8, 0.8, -0.002), divisions=24))
    keep, report = clean_mesh(vertices=vertices, faces=faces, expected=(0.32, 0.32, 1.5), is_floor_covering=False)
    assert report["removedSides"] == ["-z"]
    assert keep[: len(lamp[1])].all()
    assert not keep[len(lamp[1]) :].any()
