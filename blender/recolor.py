"""Write a `colorize` adjustment into a GLB's base colour textures, and into the base colour factor of untextured materials.

blender --background --factory-startup --python-exit-code 1 --python recolor.py -- \
    --input in.glb --output out.glb --color '#1E50E6' --strength 1
"""

import argparse
import os
import re
import math
from pathlib import Path
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy
import numpy as np

import glb_io

LUMA = np.array([0.3, 0.59, 0.11], dtype=np.float32)


def parse_hex_color(text):
    if not re.fullmatch(r"#[0-9a-fA-F]{6}", text):
        raise argparse.ArgumentTypeError(f"expected #RRGGBB, got {text}")
    return np.array([int(text[i : i + 2], 16) / 255 for i in (1, 3, 5)], dtype=np.float32)


def unit_interval(text):
    value = float(text)
    if not 0 <= value <= 1:
        raise argparse.ArgumentTypeError(f"expected a strength from 0 to 1, got {text}")
    return value


def colorize(rgb, color, strength, reference_luma):
    shading = (rgb @ LUMA)[:, None] / max(reference_luma, 0.02)
    result = np.clip(color[None, :] * shading, 0, 1)
    return rgb + (result - rgb) * strength


def positive_luma(text):
    value = float(text)
    if not math.isfinite(value) or value <= 0:
        raise argparse.ArgumentTypeError("reference luma must be finite and above 0")
    return value


def srgb_to_linear(values):
    return np.where(values <= 0.04045, values / 12.92, ((values + 0.055) / 1.055) ** 2.4)


def linear_to_srgb(values):
    return np.where(values <= 0.0031308, values * 12.92, 1.055 * values ** (1 / 2.4) - 0.055)


def recolor_image(image, color, strength, reference_luma, mask):
    pixels = glb_io.image_pixels(image)
    if mask is not None and mask.shape != pixels.shape[:2]:
        raise ValueError("colorMask.png must match the base colour texture size")
    rgb = pixels[:, :, :3].reshape(-1, 3)
    amount = strength if mask is None else strength * mask.reshape(-1, 1)
    pixels[:, :, :3] = colorize(rgb, color, amount, reference_luma).reshape(pixels.shape[0], pixels.shape[1], 3)
    glb_io.set_image_pixels(image, pixels)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--color", required=True, type=parse_hex_color)
    parser.add_argument("--strength", type=unit_interval, default=1.0)
    parser.add_argument("--reference-luma", type=positive_luma, default=0.5)
    parser.add_argument("--mask")
    args = parser.parse_args(glb_io.script_args())

    glb_io.open_static_glb(args.input)
    mask_path = Path(args.mask) if args.mask else Path(args.input).with_name("colorMask.png")
    mask = None
    if args.mask or mask_path.exists():
        mask_image = bpy.data.images.load(str(mask_path.resolve()), check_existing=False)
        mask = glb_io.image_pixels(mask_image)[:, :, 0]
    recolored_images = set()
    source_formats = set()
    recolored_factors = 0
    for material in bpy.data.materials:
        if material.node_tree is None:
            continue
        socket = glb_io.base_color_socket(material)
        if socket is None:
            continue
        image_node = glb_io.base_color_node(material)
        if image_node is not None:
            if image_node.image.name not in recolored_images:
                source_formats.add(image_node.image.file_format)
                recolor_image(image_node.image, args.color, args.strength, args.reference_luma, mask)
                recolored_images.add(image_node.image.name)
        elif not socket.is_linked:
            factor = np.array(socket.default_value[:3], dtype=np.float32)
            encoded = colorize(linear_to_srgb(factor)[None, :], args.color, args.strength, args.reference_luma)[0]
            socket.default_value[:3] = srgb_to_linear(encoded).tolist()
            recolored_factors += 1

    if not recolored_images and recolored_factors == 0:
        raise ValueError("the GLB has no base colour to recolor")
    image_format = "JPEG" if source_formats == {"JPEG"} else "AUTO"
    glb_io.export_glb(args.output, image_format=image_format)
    glb_io.print_result(
        {"images": sorted(recolored_images), "factors": recolored_factors, "imageFormat": image_format}
    )


if __name__ == "__main__":
    main()
