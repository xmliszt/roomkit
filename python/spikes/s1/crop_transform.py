import numpy as np


def crop_transform(*, orig_size, target_size):
    """Return `[scale, left, top]` mapping upright-JPEG pixels to a resize-then-centre-crop grid of `target_size` (w, h)."""
    scale = max(target_size[0] / orig_size[0], target_size[1] / orig_size[1]) + 1e-8
    rescaled = np.floor(np.array(orig_size) * scale).astype(int)
    return np.array([scale, (rescaled[0] - target_size[0]) // 2, (rescaled[1] - target_size[1]) // 2], dtype=np.float64)
