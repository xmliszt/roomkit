import numpy as np
import pytest

from score_room import score_room


def room_from_corners(*, corners, height=3.0):
    return {"walls": [{"startM": {"x": x, "z": z}} for x, z in corners], "ceilingHeightM": height}


@pytest.mark.parametrize("shift", range(4))
def test_room_score_checks_opposite_pairs_in_any_start_order(shift):
    corners = np.roll([[0, 0], [0, 6.0], [4.0, 6.0], [4.0, 0]], shift, axis=0)
    result = score_room(width_m=4, length_m=6, height_m=3, room=room_from_corners(corners=corners))
    assert result["widthSidesM"] == pytest.approx([4.0, 4.0])
    assert result["lengthSidesM"] == pytest.approx([6.0, 6.0])
    assert result["cornerAnglesDeg"] == pytest.approx([90] * 4)


def test_room_score_rejects_review_footprint_with_one_long_width():
    diagonal = np.array([4.0, 6.0])
    distance = np.linalg.norm(diagonal)
    along = (5.656**2 - 6.002**2 + distance**2) / (2 * distance)
    across = np.sqrt(5.656**2 - along**2)
    last = along * diagonal / distance + across * np.array([diagonal[1], -diagonal[0]]) / distance
    corners = np.array([[0, 0], [0, 6.0], [4.0, 6.0], last])
    lengths = np.linalg.norm(np.roll(corners, -1, axis=0) - corners, axis=1)
    assert lengths == pytest.approx([6.0, 4.0, 6.002, 5.656])
    with pytest.raises(AssertionError, match="geometry gate"):
        score_room(width_m=4, length_m=6, height_m=3, room=room_from_corners(corners=corners))


def test_room_score_rejects_skewed_corners_even_with_correct_side_lengths():
    angle = np.radians(10)
    shift = np.array([6.0 * np.sin(angle), 6.0 * np.cos(angle)])
    corners = [[0, 0], shift, shift + [4.0, 0], [4.0, 0]]
    with pytest.raises(AssertionError, match="geometry gate"):
        score_room(width_m=4, length_m=6, height_m=3, room=room_from_corners(corners=corners))


@pytest.mark.parametrize("height", [0, 3.5, float("nan")])
def test_room_score_rejects_wrong_ceiling_height(height):
    with pytest.raises(AssertionError):
        score_room(width_m=4, length_m=6, height_m=3, room=room_from_corners(corners=[[0, 0], [0, 6.0], [4.0, 6.0], [4.0, 0]], height=height))


@pytest.mark.parametrize("height_m", [0, -1, float("nan"), float("inf")])
def test_room_score_rejects_invalid_reference_dimensions(height_m):
    room = room_from_corners(corners=[[0, 0], [0, 6], [4, 6], [4, 0]])
    with pytest.raises(ValueError, match="Reference dimensions"):
        score_room(room=room, width_m=4, length_m=6, height_m=height_m)
