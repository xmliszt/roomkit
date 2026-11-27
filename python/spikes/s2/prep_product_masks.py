"""Write a binary mask and an RGBA cut-out for each product photo with RMBG-2.0 (mlx-spatial)."""

import time

import numpy as np
from PIL import Image

from mlx_spatial.trellis2_rmbg_forward import remove_background_rmbg2_mlx
from paths import PRODUCTS, WEIGHTS, load_inputs

(PRODUCTS / "masks").mkdir(exist_ok=True)
for spec in load_inputs():
    if spec["kind"] != "product":
        continue
    stem = spec["image"].removesuffix(".jpg")
    start = time.perf_counter()
    rgba = remove_background_rmbg2_mlx(Image.open(PRODUCTS / spec["image"]).convert("RGB"), root=WEIGHTS / "rmbg2")
    alpha = np.array(rgba)[..., 3]
    Image.fromarray(((alpha >= 128) * 255).astype(np.uint8)).save(PRODUCTS / "masks" / f"{stem}.png")
    rgba.save(PRODUCTS / "masks" / f"{stem}-rgba.png")
    print(f"{stem}: {time.perf_counter() - start:.1f} s, foreground {(alpha >= 128).mean():.1%}")
