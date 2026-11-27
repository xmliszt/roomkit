import numpy as np


def score_room(*, room, width_m, length_m, height_m):
    if any(not np.isfinite(value) or value <= 0 for value in (width_m, length_m, height_m)):
        raise ValueError("Reference dimensions must be positive and finite")
    if len(room["walls"]) != 4:
        raise AssertionError("Expected four wall sides")
    corners = np.array([[wall["startM"]["x"], wall["startM"]["z"]] for wall in room["walls"]])
    edges = np.roll(corners, -1, axis=0) - corners
    lengths = np.linalg.norm(edges, axis=1)
    if not np.isfinite(corners).all() or not np.isfinite(room["ceilingHeightM"]) or np.any(lengths <= 0):
        raise AssertionError("Room geometry must be finite with positive side lengths")
    turns = edges[:, 0] * np.roll(edges[:, 1], -1) - edges[:, 1] * np.roll(edges[:, 0], -1)
    units = edges / lengths[:, None]
    angles = np.degrees(np.arccos(np.clip(-np.sum(units * np.roll(units, -1, axis=0), axis=1), -1, 1)))
    pairs = [lengths[::2], lengths[1::2]]
    width, length = sorted(pairs, key=np.mean)
    width_m, length_m = sorted((width_m, length_m))
    dimensions = [*width, *length, room["ceilingHeightM"]]
    errors = np.array(dimensions) / [width_m, width_m, length_m, length_m, height_m] - 1
    if not np.all(turns < 0) or np.max(np.abs(angles - 90)) > 5 or np.max(np.abs(errors)) > 0.10:
        raise AssertionError(f"Room failed geometry gate: sides/height {dimensions}; errors {errors.tolist()}; corners {angles.tolist()}")
    return {"widthSidesM": width.tolist(), "lengthSidesM": length.tolist(), "ceilingHeightM": room["ceilingHeightM"], "signedErrors": errors.tolist(), "cornerAnglesDeg": angles.tolist()}
