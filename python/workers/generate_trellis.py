from functools import partial

from generation import report_steps, run_generation, save_crop
from protocol import run_worker


def generate(*, weights, directory, photo_path, mask_path, report, pipeline_type, target_faces):
    from mlx_spatial import trellis2_inference

    image = save_crop(photo_path=photo_path, mask_path=mask_path, output_path=directory / "crop.png")
    original = trellis2_inference._stage_output

    def stage_output(stage, name, payload, detail, **kwargs):
        report(stage)
        return original(stage, name, payload, detail, **kwargs)

    trellis2_inference._stage_output = stage_output
    steps = [
        ("mlx_spatial.trellis2_sparse_structure", "_flow_euler_guided_prediction"),
        ("mlx_spatial.trellis2_slat", "_flow_euler_guided_slat_prediction"),
    ]
    try:
        with report_steps(targets=steps, report=report):
            pipeline = trellis2_inference.Trellis2InferencePipeline(weights / "trellis2", rmbg_root=None)
            return pipeline.generate_textured_glb(
                image, output_path=directory / "outputs/model.glb",
                dino_root=weights / "dinov3-vitl16-pretrain-lvd1689m",
                pipeline_type=pipeline_type, seed=42, texture_size=1024,
                glb_target_faces=target_faces, retain_trace_payloads=False,
            )
    finally:
        trellis2_inference._stage_output = original


def run(request):
    return run_generation(
        request=request, model="trellis2",
        generate=partial(generate, pipeline_type=request.get("pipelineType", "512"),
                         target_faces=request.get("targetFaces", 150_000)),
    )


if __name__ == "__main__":
    run_worker(run)
