"""Build `chair-wrong-axes.glb`: a 0.6 x 0.9 x 0.5 m chair written with +Z up, +X front, 2.5x too large, off the origin.

blender --background --factory-startup --python-exit-code 1 --python build_fixture.py -- \
    --output chair-wrong-axes.glb [--image-format JPEG]

Parts, named for the round-trip check: `seat`, `leg_1`..`leg_4`, `back` (at the back), `arm` (on the +x side only).
"""

import argparse
import sys
from typing import NamedTuple

import bpy
import numpy as np

WRONG_SCALE = 2.5
OFFSET = (0.7, 0.3, -0.4)
GREY_UV = (0.25, 0.75)
WOOD_UV = (0.25, 0.25)
GREY = (0.7, 0.7, 0.7, 1)
WOOD = (0.29, 0.2, 0.14, 1)
TEXTURE_SIZE = 64


class Part(NamedTuple):
    """A box from `low` to `high`, in meters with x right, y up, z front, textured at `uv`."""

    name: str
    low: tuple
    high: tuple
    uv: tuple


PARTS = [
    Part("seat", (-0.30, 0.40, -0.25), (0.30, 0.48, 0.25), GREY_UV),
    Part("back", (-0.30, 0.48, -0.25), (0.30, 0.90, -0.20), GREY_UV),
    Part("arm", (0.25, 0.48, -0.20), (0.30, 0.65, 0.20), GREY_UV),
    Part("leg_1", (-0.30, 0.00, -0.25), (-0.25, 0.40, -0.20), WOOD_UV),
    Part("leg_2", (0.25, 0.00, -0.25), (0.30, 0.40, -0.20), WOOD_UV),
    Part("leg_3", (-0.30, 0.00, 0.20), (-0.25, 0.40, 0.25), WOOD_UV),
    Part("leg_4", (0.25, 0.00, 0.20), (0.30, 0.40, 0.25), WOOD_UV),
]

BOX_FACES = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]


def to_wrong_axes(point):
    x, y, z = point
    return tuple(value * WRONG_SCALE + offset for value, offset in zip((z, x, y), OFFSET))


def build_texture():
    image = bpy.data.images.new("chair-base-color", TEXTURE_SIZE, TEXTURE_SIZE)
    pixels = np.empty((TEXTURE_SIZE, TEXTURE_SIZE, 4), dtype=np.float32)
    pixels[: TEXTURE_SIZE // 2] = WOOD
    pixels[TEXTURE_SIZE // 2 :] = GREY
    image.pixels.foreach_set(pixels.ravel())
    image.update()
    image.pack()
    return image


def build_material(image):
    material = bpy.data.materials.new("chair")
    nodes = material.node_tree.nodes
    texture = nodes.new("ShaderNodeTexImage")
    texture.image = image
    shader = next(node for node in nodes if node.type == "BSDF_PRINCIPLED")
    material.node_tree.links.new(texture.outputs["Color"], shader.inputs["Base Color"])
    return material


def add_box(part, material):
    low, high = part.low, part.high
    corners = [
        to_wrong_axes((x, y, z)) for x in (low[0], high[0]) for y in (low[1], high[1]) for z in (low[2], high[2])
    ]
    mesh = bpy.data.meshes.new(part.name)
    mesh.from_pydata(corners, [], BOX_FACES)
    layer = mesh.uv_layers.new(name="UVMap")
    for loop in layer.data:
        loop.uv = part.uv
    mesh.materials.append(material)
    mesh.update()
    bpy.context.scene.collection.objects.link(bpy.data.objects.new(part.name, mesh))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    parser.add_argument("--image-format", default="AUTO", choices=["AUTO", "JPEG"])
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1 :])

    bpy.ops.wm.read_factory_settings(use_empty=True)
    material = build_material(build_texture())
    for part in PARTS:
        add_box(part, material)
    bpy.ops.export_scene.gltf(
        filepath=args.output, export_format="GLB", export_yup=False, export_image_format=args.image_format
    )


main()
