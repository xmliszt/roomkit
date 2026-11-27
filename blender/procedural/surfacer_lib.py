import json
import os

import bpy

from modeler_lib import _bake_pass, _input_as_emission, tileable


def bake_surface(job, mat, repeat_size_m, size=1024):
    if not 2 <= size <= 2048:
        raise ValueError("Texture size must be between 2 and 2048 px")
    bpy.ops.mesh.primitive_plane_add(size=1)
    obj = bpy.context.object
    obj.scale = (repeat_size_m["u"], repeat_size_m["v"], 1)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(mat)
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 1
    scene.cycles.use_denoising = False
    for name, bake_type, input_name in [
        ("baseColor", "EMIT", "Base Color"),
        ("roughness", "ROUGHNESS", None),
        ("normal", "NORMAL", None),
    ]:
        image = bpy.data.images.new(name, width=size, height=size, alpha=False)
        if name != "baseColor":
            image.colorspace_settings.name = "Non-Color"
        prepare = (lambda: _input_as_emission(obj, input_name)) if input_name else None
        _bake_pass(obj, image, bake_type, 0, prepare=prepare)
        path = os.path.join(job["dir"], f"{name}.png")
        image.filepath_raw = path
        image.file_format = "PNG"
        image.save()
        tileable(path, path)


def finish_surface(job, color, material):
    with open(os.path.join(job["dir"], "surface.json"), "w") as file:
        json.dump({"color": color, "material": material}, file)
