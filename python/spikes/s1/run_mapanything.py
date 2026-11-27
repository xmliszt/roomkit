"""Run MapAnything (mlx-spatial) on a folder of JPEGs and save the scene in the common S1 format."""

import argparse
from pathlib import Path

import mlx.core as mx
from mlx_spatial import MapAnythingScenePipeline, mapanything_scene
from mlx_spatial.mapanything_heads import MapAnythingDenseHeadOutput, MapAnythingHeadsOutput

from crop_transform import crop_transform
from paths import WEIGHTS_DIR
from save_scene import save_scene


def chunk_heads(views_per_chunk):
    """Patch the scene pipeline to run the prediction heads `views_per_chunk` views at a time, evaluating each chunk before the next."""
    run_heads = mapanything_scene.run_mapanything_heads

    def chunked(dense_features, scale_tokens, weights, **kwargs):
        batch = int(dense_features[0].shape[0])
        outputs = []
        for start in range(0, batch, views_per_chunk):
            out = run_heads([f[start : start + views_per_chunk] for f in dense_features], scale_tokens, weights, **kwargs)
            d = out.dense
            mx.eval(d.value, d.confidence, d.mask, d.logits, d.decoded_channels, out.pose_value, out.scale_value)
            outputs.append(out)
        cat = lambda get: mx.concatenate([get(o) for o in outputs], axis=0)
        return MapAnythingHeadsOutput(
            dense=MapAnythingDenseHeadOutput(
                value=cat(lambda o: o.dense.value),
                confidence=cat(lambda o: o.dense.confidence),
                mask=cat(lambda o: o.dense.mask),
                logits=cat(lambda o: o.dense.logits),
                decoded_channels=cat(lambda o: o.dense.decoded_channels),
            ),
            pose_value=cat(lambda o: o.pose_value),
            scale_value=outputs[0].scale_value,
            trace={**outputs[0].trace, "batch": batch, "views_per_chunk": views_per_chunk},
        )

    mapanything_scene.run_mapanything_heads = chunked


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("image_dir", type=Path)
    parser.add_argument("out_dir", type=Path)
    parser.add_argument("--resize-mode", default="fixed_mapping")
    parser.add_argument("--size", type=int)
    parser.add_argument("--stride", type=int, default=1)
    parser.add_argument("--head-chunk", type=int, help="views per prediction-head pass; default all at once")
    parser.add_argument("--cache-limit-gb", type=float, help="cap on MLX's cache of freed buffers")
    args = parser.parse_args()
    if args.cache_limit_gb is not None:
        mx.set_cache_limit(int(args.cache_limit_gb * 1e9))
    if args.head_chunk:
        chunk_heads(args.head_chunk)
    result = MapAnythingScenePipeline(WEIGHTS_DIR / "map-anything").generate(
        args.image_dir, resize_mode=args.resize_mode, size=args.size, stride=args.stride
    )
    if not result.ready:
        raise SystemExit(f"MapAnything failed: {result.trace.blocker}")
    pred = result.predictions
    views = result.preprocessed.views
    save_scene(
        out_dir=args.out_dir,
        names=[v.image_path.stem for v in views],
        images=pred.images,
        world_points=pred.world_points,
        confidence=pred.confidence,
        masks=pred.masks,
        camera_poses=pred.camera_poses,
        intrinsics=pred.intrinsics,
        transforms=[crop_transform(orig_size=v.original_size, target_size=v.target_size) for v in views],
        extra={
            "model": "MapAnything (mlx-spatial 0.0.3, facebook/map-anything)",
            "resize_mode": args.resize_mode,
            "head_chunk": args.head_chunk,
            "cache_limit_gb": args.cache_limit_gb,
            "target_size": list(result.preprocessed.target_size),
            "mlx_peak_gb": mx.get_peak_memory() / 1e9,
        },
    )


if __name__ == "__main__":
    main()
