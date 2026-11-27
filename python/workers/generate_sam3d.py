from generation import report_steps, run_generation
from protocol import run_worker


def generate(*, weights, directory, photo_path, mask_path, report):
    from mlx_spatial import sam3d_inference, sam3d_mesh

    original_release = sam3d_inference._release_mlx_stage_memory
    original_guard = sam3d_mesh._flexicubes_guard_blocker

    def release_memory(metadata, label, *args, **kwargs):
        report(label)
        return original_release(metadata, label, *args, **kwargs)

    def guard_surface_memory(estimate, max_flexicubes_bytes, metadata):
        if metadata.get("extraction_resolution") == 256 and "surface_cube_count" not in metadata:
            return None
        return original_guard(estimate, max_flexicubes_bytes, metadata)

    sam3d_inference._release_mlx_stage_memory = release_memory
    sam3d_mesh._flexicubes_guard_blocker = guard_surface_memory
    steps = [
        ("mlx_spatial.sam3d_ss_flow", "_run_ss_velocity"),
        ("mlx_spatial.sam3d_slat", "_run_slat_velocity"),
    ]
    try:
        with report_steps(targets=steps, report=report):
            root = weights / "sam-3d-objects-mlx"
            return sam3d_inference.Sam3dInferencePipeline(root).generate_gaussians_ply(
                photo_path, mask_path=mask_path, output_path=directory / "outputs/gaussians.ply",
                glb_output_path=directory / "outputs/model.glb", moge_root=root / "moge",
                seed=42, memory_profile="balanced", glb_target_faces=150_000, glb_texture_size=1024,
            )
    finally:
        sam3d_inference._release_mlx_stage_memory = original_release
        sam3d_mesh._flexicubes_guard_blocker = original_guard


def run(request):
    return run_generation(request=request, model="sam3d", generate=generate)


if __name__ == "__main__":
    run_worker(run)
