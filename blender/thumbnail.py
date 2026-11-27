"""Render a square PNG thumbnail of a normalized GLB on a transparent background.

blender --background --factory-startup --python-exit-code 1 --python thumbnail.py -- \
    --input in.glb --output thumb.png [--size 512] [--view front|side]

With --view, the camera is orthographic and framed exactly on the mesh bounds, and the image
has the bounds' aspect ratio with its longest side --size px. Front looks at the model's front
(glTF +Z, Blender -Y) with x running left to right; side looks from glTF -X with z (back to
front) running left to right. Both have up at the top.
"""

import argparse
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy
from mathutils import Vector

import glb_io

ENGINES = ["BLENDER_EEVEE", "BLENDER_EEVEE_NEXT", "CYCLES"]
VIEW_DIRECTION = Vector((0.7, -1.0, 0.55)).normalized()
SUN_DIRECTION = Vector((-0.5, -0.6, 1.0)).normalized()
FIELD_OF_VIEW_RAD = math.radians(30)


def aim(obj, direction):
    obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def add_camera(low, high, direction=VIEW_DIRECTION):
    centre = (low + high) / 2
    radius = (high - low).length / 2
    distance = radius / math.sin(FIELD_OF_VIEW_RAD / 2)
    data = bpy.data.cameras.new("thumbnail")
    data.angle = FIELD_OF_VIEW_RAD
    data.clip_start = distance / 100
    data.clip_end = distance * 10
    camera = bpy.data.objects.new("thumbnail", data)
    camera.location = centre + direction * distance
    aim(camera, -direction)
    bpy.context.scene.collection.objects.link(camera)
    bpy.context.scene.camera = camera


ORTHO_VIEWS = {
    "front": {"direction": Vector((0, 1, 0)), "across": 0},
    "side": {"direction": Vector((1, 0, 0)), "across": 1},
}


def add_orthographic_camera(low, high, view):
    centre = (low + high) / 2
    extent = high - low
    setting = ORTHO_VIEWS[view]
    width = extent[setting["across"]]
    height = extent[2]
    distance = extent.length + 1
    data = bpy.data.cameras.new("view")
    data.type = "ORTHO"
    data.ortho_scale = max(width, height)
    data.clip_start = distance / 100
    data.clip_end = distance * 3
    camera = bpy.data.objects.new("view", data)
    camera.location = centre - setting["direction"] * distance
    aim(camera, setting["direction"])
    bpy.context.scene.collection.objects.link(camera)
    bpy.context.scene.camera = camera
    return width, height


def add_lighting(environment=False):
    sun_data = bpy.data.lights.new("key", "SUN")
    sun_data.energy = 3
    sun = bpy.data.objects.new("key", sun_data)
    aim(sun, -SUN_DIRECTION)
    bpy.context.scene.collection.objects.link(sun)

    world = bpy.data.worlds.new("ambient")
    background = world.node_tree.nodes["Background"]
    background.inputs["Color"].default_value = (1, 1, 1, 1)
    background.inputs["Strength"].default_value = 1.0 if environment else 0.6
    bpy.context.scene.world = world


def render(output, size_px):
    scene = bpy.context.scene
    scene.render.resolution_x = size_px[0]
    scene.render.resolution_y = size_px[1]
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.filepath = output
    scene.view_settings.view_transform = "Standard"
    failures = []
    for engine in ENGINES:
        if os.path.exists(output):
            os.remove(output)
        try:
            scene.render.engine = engine
            bpy.ops.render.render(write_still=True)
        except (TypeError, RuntimeError) as error:
            failures.append(f"{engine}: {error}")
            continue
        if os.path.exists(output):
            return engine
        failures.append(f"{engine}: no file written")
    raise RuntimeError("no render engine produced a thumbnail: " + "; ".join(failures))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--size", type=int, default=512)
    parser.add_argument("--view", choices=sorted(ORTHO_VIEWS))
    parser.add_argument("--azimuth", type=float)
    parser.add_argument("--elevation", type=float, default=20)
    parser.add_argument("--environment", action="store_true")
    args = parser.parse_args(glb_io.script_args())
    if not args.output.lower().endswith(".png"):
        parser.error("--output must end in .png")

    glb_io.open_glb(args.input)
    low, high = glb_io.mesh_bounds()
    if args.view:
        width, height = add_orthographic_camera(low, high, args.view)
        scale = args.size / max(width, height)
        size_px = (max(1, round(width * scale)), max(1, round(height * scale)))
    else:
        direction = VIEW_DIRECTION
        if args.azimuth is not None:
            azimuth = math.radians(args.azimuth)
            elevation = math.radians(args.elevation)
            radius = math.cos(elevation)
            direction = Vector((
                math.sin(azimuth) * radius,
                -math.cos(azimuth) * radius,
                math.sin(elevation),
            ))
        add_camera(low, high, direction)
        size_px = (args.size, args.size)
    add_lighting(args.environment)
    engine = render(os.path.abspath(args.output), size_px)
    glb_io.print_result({"engine": engine, "widthPx": size_px[0], "heightPx": size_px[1]})


main()
