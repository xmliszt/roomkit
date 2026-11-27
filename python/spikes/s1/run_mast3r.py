"""Run MASt3R-SfM (sparse global alignment) on a folder of JPEGs and save the scene in the common S1 format.

Needs the upstream repo at `~/.cache/interior-planner-spikes/s1/src/mast3r` (with its `dust3r` submodule).
"""

import argparse
import sys
import tempfile
from pathlib import Path

import numpy as np
import scipy.cluster.hierarchy
import scipy.spatial.distance
import torch
from PIL import Image

from crop_transform import crop_transform
from paths import OUT_DIR, WEIGHTS_DIR
from save_scene import save_scene


IMAGE_SIZE = 512

# Upstream reaches `squareform` through `scipy.cluster.hierarchy.distance`, which SciPy 1.18 no longer exposes.
scipy.cluster.hierarchy.distance = scipy.spatial.distance
MIN_CONF = 1.5


def pad_to(arrays, *, shape, fill):
    """Return `arrays` stacked after padding each at the bottom and right to `shape` with `fill`."""
    out = []
    for a in arrays:
        padded = np.full((*shape, *a.shape[2:]), fill, dtype=a.dtype)
        padded[: a.shape[0], : a.shape[1]] = a
        out.append(padded)
    return np.stack(out)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("image_dir", type=Path)
    parser.add_argument("out_dir", type=Path)
    parser.add_argument("--scene-graph", default="complete", help="complete, swin-<k>, logwin-<k>")
    parser.add_argument("--device", default="mps")
    args = parser.parse_args()

    sys.path.insert(0, str(OUT_DIR / "src/mast3r"))
    from dust3r.utils.image import load_images
    from mast3r.cloud_opt.sparse_ga import sparse_global_alignment
    from mast3r.image_pairs import make_pairs
    from mast3r.model import AsymmetricMASt3R

    files = sorted(str(p) for p in args.image_dir.glob("*.jpg"))
    model = AsymmetricMASt3R.from_pretrained(str(WEIGHTS_DIR / "mast3r")).to(args.device)
    imgs = load_images(files, size=IMAGE_SIZE, verbose=False)
    graph = args.scene_graph if args.scene_graph == "complete" else args.scene_graph + "-noncyclic"
    pairs = make_pairs(imgs, scene_graph=graph, prefilter=None, symmetrize=True)
    with tempfile.TemporaryDirectory(dir=OUT_DIR) as cache_dir:
        scene = sparse_global_alignment(
            files, pairs, cache_dir, model,
            lr1=0.07, niter1=300, lr2=0.01, niter2=300, device=args.device,
            opt_depth=True, shared_intrinsics=False, matching_conf_thr=0.0,
        )
        pts3d, _, confs = scene.get_dense_pts3d(clean_depth=True)

    sizes = [tuple(int(v) for v in im["true_shape"][0]) for im in imgs]
    shape = (max(h for h, _ in sizes), max(w for _, w in sizes))
    world = [p.detach().cpu().numpy().reshape(h, w, 3) for p, (h, w) in zip(pts3d, sizes)]
    conf = [c.detach().cpu().numpy() for c in confs]
    images = [np.asarray(im) for im in scene.imgs]
    transforms = []
    for f, (h, w) in zip(files, sizes):
        with Image.open(f) as im:
            transforms.append(crop_transform(orig_size=im.size, target_size=(w, h)))
    save_scene(
        out_dir=args.out_dir,
        names=[Path(f).stem for f in files],
        images=pad_to(images, shape=shape, fill=0),
        world_points=pad_to(world, shape=shape, fill=0),
        confidence=pad_to(conf, shape=shape, fill=0),
        masks=pad_to([c > MIN_CONF for c in conf], shape=shape, fill=False),
        camera_poses=scene.get_im_poses().detach().cpu().numpy(),
        intrinsics=np.stack([k.detach().cpu().numpy() for k in scene.intrinsics]),
        transforms=transforms,
        extra={
            "model": "MASt3R-SfM (naver/mast3r f5209af, MASt3R_ViTLarge_BaseDecoder_512_catmlpdpt_metric)",
            "scene_graph": args.scene_graph,
            "pairs": len(pairs),
            "device": args.device,
            "torch_mps_allocated_end_gb": torch.mps.driver_allocated_memory() / 1e9 if args.device == "mps" else None,
        },
    )


if __name__ == "__main__":
    main()
