import tempfile
from pathlib import Path

import numpy as np


def chunk_heads(views_per_chunk):
    import mlx.core as mx
    from mlx_spatial import mapanything_scene
    from mlx_spatial.mapanything_heads import MapAnythingDenseHeadOutput, MapAnythingHeadsOutput

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

    return run_heads, chunked


def predict(*, photos, photos_dir, weights_dir):
    import mlx.core as mx
    from mlx_spatial import MapAnythingScenePipeline, mapanything_scene

    previous_cache_limit = mx.set_cache_limit(1_000_000_000)
    original, chunked = chunk_heads(4)
    mapanything_scene.run_mapanything_heads = chunked
    try:
        with tempfile.TemporaryDirectory(prefix="planner-views-") as temporary:
            for photo in photos:
                source = (photos_dir / photo["visionPath"]).resolve(strict=True)
                (Path(temporary) / f"{photo['photoId']}.jpg").symlink_to(source)
            result = MapAnythingScenePipeline(weights_dir / "map-anything").generate(temporary)
        if not result.ready:
            raise ValueError(f"MapAnything failed: {result.trace.blocker}")
        prediction = result.predictions
        views = result.preprocessed.views
        transforms = []
        for view in views:
            scale = max(view.target_size[0] / view.original_size[0], view.target_size[1] / view.original_size[1]) + 1e-8
            resized = np.floor(np.array(view.original_size) * scale).astype(int)
            transforms.append([scale, (resized[0] - view.target_size[0]) // 2, (resized[1] - view.target_size[1]) // 2])
        return {
            "names": np.array([view.image_path.stem for view in views]),
            "world_points": np.asarray(prediction.world_points, dtype=np.float32),
            "confidence": np.asarray(prediction.confidence, dtype=np.float32),
            "masks": np.asarray(prediction.masks, dtype=bool),
            "camera_poses": np.asarray(prediction.camera_poses, dtype=np.float32),
            "intrinsics": np.asarray(prediction.intrinsics, dtype=np.float32),
            "transforms": np.asarray(transforms),
            "image_sizes": np.array([view.original_size for view in views]),
            "mlx_peak_gb": np.array(mx.get_peak_memory() / 1e9),
        }
    finally:
        mapanything_scene.run_mapanything_heads = original
        mx.set_cache_limit(previous_cache_limit)
        mx.clear_cache()
