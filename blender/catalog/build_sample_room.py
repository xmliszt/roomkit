import argparse
import json
import math
import subprocess
import sys
from pathlib import Path
from tempfile import TemporaryDirectory

import bpy
import numpy as np
from mathutils import Euler, Matrix, Vector

BLENDER_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BLENDER_DIR / "procedural"))
sys.path.insert(0, str(BLENDER_DIR))
import glb_io
from modeler_lib import material, rounded_rect

TAU = math.tau


def image_texture(mat, name, rgb, normal=False, repeat=(1, 1)):
    height, width, _ = rgb.shape
    image = bpy.data.images.new(name, width, height, alpha=False)
    if normal:
        image.colorspace_settings.name = "Non-Color"
    else:
        image.file_format = "JPEG"
    alpha = np.ones((height, width, 1), dtype=np.float32)
    glb_io.set_image_pixels(image, np.concatenate([np.clip(rgb, 0, 1), alpha], axis=2))
    tree = mat.node_tree
    texture = tree.nodes.new("ShaderNodeTexImage")
    texture.image = image
    if repeat != (1, 1):
        uv = tree.nodes.new("ShaderNodeTexCoord")
        mapping = tree.nodes.new("ShaderNodeMapping")
        mapping.inputs["Scale"].default_value = (*repeat, 1)
        tree.links.new(uv.outputs["UV"], mapping.inputs["Vector"])
        tree.links.new(mapping.outputs["Vector"], texture.inputs["Vector"])
    output = texture.outputs["Color"]
    if normal:
        relief = tree.nodes.new("ShaderNodeNormalMap")
        tree.links.new(output, relief.inputs["Color"])
        output = relief.outputs["Normal"]
    tree.links.new(output, tree.nodes["Principled BSDF"].inputs["Normal" if normal else "Base Color"])


def surface_maps(mat, color, height, strength, repeat=(1, 1)):
    image_texture(mat, mat.name, color / 255)
    dx = np.roll(height, 1, axis=1) - np.roll(height, -1, axis=1)
    dy = np.roll(height, 1, axis=0) - np.roll(height, -1, axis=0)
    normals = np.stack((dx * strength, dy * strength, np.ones_like(dx)), axis=2)
    normals /= np.linalg.norm(normals, axis=2, keepdims=True)
    image_texture(mat, mat.name + " relief", normals * 0.5 + 0.5, normal=True, repeat=repeat)


def woven(name, color, stripe=False):
    mat = material(name, "#ffffff", 0.96)
    x, y = np.meshgrid(np.arange(256) / 256, np.arange(256) / 256)
    warp = 32 * x + 0.08 * np.sin(TAU * (5 * y + 2 * x))
    weft = 32 * y + 0.11 * np.sin(TAU * (3 * x + y))
    crossing = np.cos(math.pi * warp) * np.cos(math.pi * weft)
    height = (1 + crossing) * np.cos(TAU * warp) + (1 - crossing) * np.cos(TAU * weft)
    rng = np.random.default_rng(26)
    slubs = rng.normal(0, 1.9, (32, 1)).repeat(8, axis=0) + rng.normal(0, 1.5, (1, 32)).repeat(8, axis=1)
    dye = height * 3 + slubs + rng.normal(0, 1.8, x.shape)
    if stripe:
        bands = (np.abs(x - 0.5) < 0.13) | (np.abs(np.abs(x - 0.5) - 0.23) < 0.022)
        dye -= bands * 56
    surface_maps(mat, np.array(color) + dye[:, :, None], height, 0.059)
    return mat


def oak():
    mat = material("Quarter and plain sawn oak", "#ffffff", 0.48)
    x, y = np.meshgrid(np.arange(1024) / 1024, np.arange(512) / 512)
    board = np.floor(y * 4)
    cross = y * 4 % 1
    phase = TAU * (x + board * 0.34)
    bow = 0.24 * np.sin(phase) + 0.048 * np.sin(2 * phase + 2.2 * cross)
    growth = 10 * np.sqrt((cross + 0.3 + bow) ** 2 + (0.32 * np.sin(phase)) ** 2)
    grain = (0.5 + 0.5 * np.cos(TAU * growth)) ** 8
    capillaries = np.sin(TAU * (cross * 62 + bow * 18) + 1.2 * np.sin(phase - cross * 11))
    pores = np.maximum(0, capillaries - 0.58) * np.maximum(0, np.sin(phase * 17 + cross * 81))
    fleck = np.random.default_rng(91).normal(0, 1.7, x.shape)
    tone = 6 * np.sin(growth * 2) - 16 * grain - 16 * pores + (board % 3 - 1) * 4 + fleck
    color = np.array([179, 132, 84]) + tone[:, :, None] * [1.05, 0.98, 0.77]
    surface_maps(mat, color, -grain - 2 * pores, 0.1)
    return mat


def rug_weave(x, y):
    yarn = 8 * y + 0.10 * np.sin(TAU * (x + y))
    warp = 8 * x + 0.07 * np.sin(TAU * (y + 2 * x))
    return 0.65 * np.cos(TAU * yarn) + np.cos(TAU * warp) * np.sin(math.pi * yarn) * np.sin(math.pi * warp)


def rug_face():
    mat = material("Wool flatweave", "#ffffff", 1)
    width, height = 1536, 1024
    x, y = np.meshgrid((np.arange(width) + 0.5) / width, (np.arange(height) + 0.5) / height)
    rng = np.random.default_rng(71)
    repeat = (48, 30)
    relief = rug_weave(x * repeat[0], y * repeat[1])
    edge = np.minimum(np.minimum(x, 1 - x) * 2.5, np.minimum(y, 1 - y) * 1.8)
    border = ((edge > 0.027) & (edge < 0.033)) | ((edge > 0.043) & (edge < 0.052))
    band = np.minimum(x, 1 - x) * 2.5
    end_stripe = ((band > 0.091) & (band < 0.103)) | ((band > 0.114) & (band < 0.139))
    across = np.abs((y * 6 + 0.5) % 1 - 0.5)
    end_chevron = np.abs(band - 0.175 - across * 0.109) < 0.008
    stepped_x = np.floor(x * 168) / 168
    stepped_y = np.floor(y * 128) / 128
    diamond = np.abs((stepped_x * 6) % 1 - 0.5) + np.abs((stepped_y * 4) % 1 - 0.5)
    pattern = (np.abs(diamond - 0.48) < 0.042) & (band > 0.25) & (edge > 0.065)
    color = np.tile([203., 185., 153.], (*x.shape, 1))
    color[pattern] = [179, 158, 127]
    color[(end_stripe | end_chevron) & (edge > 0.055)] = [142, 126, 98]
    color[border] = [150, 133, 104]
    tone = relief * 8 + rng.normal(0, 3.4, x.shape) + rng.normal(0, 2, (height, 1))
    tile = (np.arange(64) + 0.5) / 64
    surface_maps(mat, color + tone[:, :, None], rug_weave(*np.meshgrid(tile, tile)), 0.16, repeat)
    return mat


def projected_uv(mesh, scale_uv, grain_axis, offset_uv):
    coords = mesh.uv_layers.new(name="UVMap")
    for face in mesh.polygons:
        normal_axis = max(range(3), key=lambda a: abs(face.normal[a]))
        axes = [a for a in range(3) if a != normal_axis]
        if grain_axis == axes[1]:
            axes.reverse()
        for index in face.loop_indices:
            point = mesh.vertices[mesh.loops[index].vertex_index].co
            coords.data[index].uv = [point[a] / size + offset for a, size, offset in zip(axes, scale_uv, offset_uv)]


def panel_uv(rings):
    xy = rings[:, :, :2]
    steps = np.diff(rings, axis=0)
    stretch = np.linalg.norm(steps, axis=2) - np.linalg.norm(steps[:, :, :2], axis=2)
    allowance = np.cumsum(np.vstack((np.zeros(len(rings[0])), stretch)), axis=0)
    return xy + allowance[:, :, None] * xy / np.linalg.norm(xy, axis=2, keepdims=True)


def upholstery_uv(mesh, rings, welt_rings):
    points = np.asarray(rings)
    bottom, top = welt_rings
    count = len(rings[0])
    tile_m = 0.1
    underside = panel_uv(points[:bottom + 1]) * [1, -1]
    face = panel_uv(points[top:][::-1])[::-1]
    band = points[bottom:top + 1]
    perimeter = np.linalg.norm(np.roll(band[0], -1, axis=0) - band[0], axis=1)
    u = np.concatenate(([0], np.cumsum(perimeter))) / perimeter.sum() * round(perimeter.sum() / tile_m)
    v = np.cumsum(np.vstack((np.zeros(count), np.linalg.norm(np.diff(band, axis=0), axis=2))), axis=0) / tile_m
    coords = mesh.uv_layers.new(name="UVMap")
    for polygon in mesh.polygons:
        row, i = divmod(polygon.index - 1, count)
        if bottom <= row < top:
            j = (i + 1) % count
            level = row - bottom
            uvs = [(u[i], v[level, i]), (u[i + 1], v[level, j]),
                   (u[i + 1], v[level + 1, j]), (u[i], v[level + 1, i])]
        else:
            panel, offset = (underside, 0) if row < bottom else (face, top)
            uvs = [panel[k // count - offset, k % count] / tile_m for k in polygon.vertices]
        for index, uv in zip(polygon.loop_indices, uvs):
            coords.data[index].uv = uv


def rings_mesh(name, rings, mat, scale_uv=(0.1, 0.1), grain_axis=0, offset_uv=(0, 0), welt_rings=None):
    count = len(rings[0])
    if welt_rings is not None:
        for index in [0, -1]:
            cap = rings[index]
            height = sum(p[2] for p in cap) / count
            rings[index] = [(x, y, height) for x, y, _ in cap]
    faces = [tuple(reversed(range(count)))]
    for row in range(len(rings) - 1):
        for i in range(count):
            j = (i + 1) % count
            a = row * count
            faces.append((a + i, a + j, a + count + j, a + count + i))
    faces.append(tuple(range((len(rings) - 1) * count, len(rings) * count)))
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([p for ring in rings for p in ring], [], faces)
    mesh.update()
    mesh.materials.append(mat)
    for face in mesh.polygons:
        face.use_smooth = welt_rings is not None or len(face.vertices) == 4
    if welt_rings is None:
        projected_uv(mesh, scale_uv, grain_axis, offset_uv)
    else:
        upholstery_uv(mesh, rings, welt_rings)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def perimeter(width, depth, radius, spacing=0.09):
    corners = rounded_rect(width, depth, radius, 5)
    outline = []
    for start, end in zip(corners, corners[1:] + corners[:1]):
        steps = max(1, math.ceil(math.dist(start, end) / spacing))
        for i in range(steps):
            outline.append(tuple(a + (b - a) * i / steps for a, b in zip(start, end)))
    return outline


def cord(name, ring, radius, mat):
    centre = np.asarray(ring)
    tangent = np.roll(centre, -1, axis=0) - np.roll(centre, 1, axis=0)
    side = np.column_stack((tangent[:, 1], -tangent[:, 0], np.zeros(len(tangent))))
    side /= np.linalg.norm(side, axis=1, keepdims=True)
    tangent /= np.linalg.norm(tangent, axis=1, keepdims=True)
    up = np.cross(side, tangent)
    sections = [centre + radius * (side * math.cos(a) + up * math.sin(a)) for a in np.arange(6) * TAU / 6]
    count = len(ring)
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([p for section in sections for p in section], [], [
        (s * count + i, s * count + (i + 1) % count, ((s + 1) % 6) * count + (i + 1) % count, ((s + 1) % 6) * count + i)
        for s in range(6) for i in range(count)
    ])
    mesh.materials.append(mat)
    for poly in mesh.polygons:
        poly.use_smooth = True
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def place(parts, location, angles):
    for part in parts:
        part.location = location
        part.rotation_euler = Euler(tuple(math.radians(a) for a in angles))


def cushion(name, size, location, face, welt, angles=(0, 0, 0), softness=1, seed=1):
    w, d, h = size
    outline = perimeter(w, d, min(0.082, w * 0.2, d * 0.2), 0.048)
    profile = [(0.09, -0.49), (0.78, -0.49), (0.945, -0.46), (0.98, -0.35),
               (1.0, -0.12), (1.0, 0.10), (0.986, 0.30), (0.965, 0.38),
               (0.927, 0.392), (0.85, 0.424), (0.69, 0.48), (0.48, 0.507),
               (0.28, 0.518), (0.09, 0.52)]
    rings = []
    for scale, height in profile:
        ring = []
        for x, y in outline:
            u, v = 2 * x / w, 2 * y / d
            ripple = math.sin(11 * u + 3 * v + seed) * math.sin(4 * v - 3 * u + seed)
            bulge = (1 - u * u) * v * math.sin(u * 5 + seed) + (1 - v * v) * u * math.cos(v * 5)
            z = height * h + softness * scale * (0.0035 * ripple + 0.004 * bulge)
            if height > 0.39:
                crease = math.cos(10 * u + 4 * v + seed + (1 - scale) * 6) ** 12
                z -= softness * 0.012 * crease * math.exp(-((scale - 0.85) / 0.18) ** 2)
            ring.append((scale * (x + softness * 0.003 * v * ripple), scale * y, z))
        rings.append(ring)
    parts = [rings_mesh(name, rings, face, welt_rings=(3, 7))]
    if welt:
        parts.append(cord(name + " top welt", rings[7], 0.0027, welt))
        parts.append(cord(name + " lower welt", rings[3], 0.0024, welt))
    place(parts, location, angles)


def throw_pillow(name, size, location, cloth, seam, angles):
    width, depth, loft = size
    outline = perimeter(width, depth, 0.028, 0.025)
    rings = []
    for t in [-0.07, -0.3, -0.52, -0.71, -0.85, -0.94, -0.985, 1, 0.985, 0.94, 0.85, 0.71, 0.52, 0.3, 0.07]:
        ring = []
        for x, y in outline:
            u, v = 2 * x * abs(t) / width, 2 * y * abs(t) / depth
            filling = max(0, (1 - u * u) * (1 - v * v)) ** 0.48
            fold = math.exp(-((abs(u) - 0.71) / 0.23) ** 2 - ((abs(v) - 0.72) / 0.22) ** 2)
            ripples = math.cos(13 * u - 9 * v + 0.8) ** 6
            z = math.copysign(loft * (0.5 * filling - 0.14 * fold * ripples), t)
            z += 0.014 * (u * u * v + u * v * v)
            ring.append((u * width / 2 * (0.94 + 0.06 * v * v),
                         v * depth / 2 * (0.93 + 0.07 * u * u), z))
        rings.append(ring)
    place([rings_mesh(name, rings, cloth, welt_rings=(7, 7)), cord(name + " seam", rings[7], 0.0021, seam)], location, angles)


def slab(name, size, radius, bevel, mat, location, grain_axis=0, scale_uv=(1.5, 0.59), offset_uv=(0.43, 0.53)):
    w, d, h = size
    rings = []
    for inset, z in [(bevel, 0), (bevel * 0.29, bevel * 0.29), (0, bevel), (0, h - bevel),
                     (bevel * 0.29, h - bevel * 0.29), (bevel, h)]:
        outline = rounded_rect(w - 2 * inset, d - 2 * inset, max(0.001, radius - inset))
        rings.append([(x, y, z - h / 2) for x, y in outline])
    obj = rings_mesh(name, rings, mat, scale_uv, grain_axis, offset_uv)
    obj.location = location
    return obj


def timber(name, start, end, bottom, top, mat, grain_offset=0.55):
    start, end = Vector(start), Vector(end)
    length = (end - start).length
    rings = []
    bevel = 0.002
    for t, inset in [(0, bevel), (bevel / length, 0), (1 - bevel / length, 0), (1, bevel)]:
        w, d = [a * (1 - t) + b * t - 2 * inset for a, b in zip(bottom, top)]
        radius = min(w, d) * 0.22
        rings.append([(x, y, length * t) for x, y in rounded_rect(w, d, radius, 3)])
    obj = rings_mesh(name, rings, mat, (1.5, 0.59), 2, (0.18, grain_offset))
    rotation = (end - start).to_track_quat("Z", "Y")
    obj.rotation_euler = rotation.to_euler()
    if start.z == 0:
        vertical = rotation.inverted() @ Vector((0, 0, 1))
        for vertex in list(obj.data.vertices)[:2 * len(rings[0])]:
            floor_height = 0 if vertex.index < len(rings[0]) else bevel
            vertex.co += vertical * (floor_height - (rotation @ vertex.co).z)
    obj.location = start
    return obj


def sofa():
    cloth = woven("Olive basketweave", [113, 120, 79])
    piping = material("Olive welt cord", "#626a45", 0.93)
    wood = material("Smoked oak feet", "#5e422f", 0.55)
    for x in [-0.94, 0.94]:
        for y in [-0.32, 0.32]:
            slab("Recessed foot", (0.105, 0.094, 0.126), 0.017, 0.004, wood, (x, y, 0.063))
    cushion("Upholstered seat deck", (2.085, 0.864, 0.202), (0, -0.006, 0.207), cloth, piping, softness=0.32)
    cushion("Outside back", (2.045, 0.534, 0.162), (0, 0.338, 0.466), cloth, piping, (82, 0, 0), 0.48)
    for side in [-1, 1]:
        cushion("Arm panel", (0.887, 0.477, 0.179), (side * 1.003, 0.0, 0.389), cloth, piping,
                (90, 0, 90 * side), 0.55, side)
        cushion("Box seat cushion", (0.924, 0.743, 0.17), (side * 0.463, -0.066, 0.355), cloth, piping,
                (-3, 0, 0), 0.9, side)
        cushion("Loose back cushion", (0.945, 0.476, 0.19), (side * 0.466, 0.227, 0.621), cloth, piping,
                (76 + side, side * 0.8, side * 0.4), 1.35, side * 3)
    linen = woven("Flax ticking", [207, 190, 150], stripe=True)
    throw_pillow("Ticking throw pillow", (0.407, 0.423, 0.172), (-0.71, -0.01, 0.585), linen,
            material("Flax rolled seam", "#b1a084", 0.94), (67, -14, -12))
    ochre = woven("Ochre linen", [172, 125, 74])
    throw_pillow("Linen lumbar pillow", (0.47, 0.264, 0.15), (0.60, -0.018, 0.507), ochre,
            material("Ochre rolled seam", "#9d7549", 0.92), (72, 7, 9))


def chair():
    wood = oak()
    cloth = woven("Petrol wool", [66, 101, 102])
    piping = material("Petrol welt cord", "#384f50", 0.94)
    for side in [-1, 1]:
        x = side * 0.333
        timber("Front post", (side * 0.358, -0.356, 0), (x, -0.24, 0.558),
               (0.036, 0.039), (0.052, 0.055), wood)
        timber("Back leg", (side * 0.347, 0.362, 0), (x, 0.205, 0.36),
               (0.035, 0.036), (0.053, 0.058), wood, 0.39)
        timber("Raked back stile", (x, 0.172, 0.275), (x, 0.366, 0.791),
               (0.052, 0.057), (0.044, 0.041), wood, 0.44)
        timber("Side seat rail", (x, -0.279, 0.285), (x, 0.224, 0.253),
               (0.041, 0.075), (0.041, 0.075), wood)
        arm = slab("Shaped armrest", (0.089, 0.693, 0.037), 0.044, 0.011, wood,
                   (side * 0.341, -0.025, 0.559), 1)
        for vert in arm.data.vertices:
            y = vert.co.y
            t = y / 0.693 + 0.5
            vert.co.x *= 1.1 - 0.40 * t + 0.08 * math.sin(t * math.pi)
            vert.co.x += side * 0.018 * math.sin(t * math.pi)
            vert.co.z += 0.087 * t - 0.014 * math.sin(math.pi * t)
        for y, z in [(-0.275, 0.293), (0.227, 0.277)]:
            peg = slab("End grain joinery plug", (0.013, 0.013, 0.003), 0.0064, 0.0005,
                       material("Oiled end grain", "#8d653e", 0.7), (side * 0.357, y, z))
            peg.rotation_euler.y = side * math.pi / 2
    for y, z in [(-0.278, 0.285), (0.203, 0.26), (0.345, 0.744)]:
        timber("Cross rail", (-0.339, y, z), (0.339, y, z), (0.052, 0.049), (0.052, 0.049), wood)
    for x in [-0.237, -0.079, 0.079, 0.237]:
        timber("Back support slat", (x, 0.212, 0.318), (x, 0.359, 0.756),
               (0.054, 0.02), (0.054, 0.02), wood, 0.68)
    sling = material("Woven seat webbing", "#5d5440", 0.98)
    for x in [-0.245, -0.123, 0, 0.123, 0.245]:
        timber("Underseat webbing", (x, -0.276, 0.305), (x, 0.209, 0.277),
               (0.078, 0.006), (0.078, 0.006), sling)
    cushion("Seat pad", (0.644, 0.611, 0.145), (0, -0.05, 0.372), cloth, piping, (-6, 0, 0))
    cushion("Inclined back pad", (0.627, 0.473, 0.142), (0, 0.235, 0.592), cloth, piping,
            (69, 0, 0), 1.25, 3)


def table():
    wood = oak()
    slab("Solid oak top", (1.22, 0.62, 0.034), 0.17, 0.009, wood, (0, 0, 0.408))
    for sx in [-1, 1]:
        for sy in [-1, 1]:
            timber("Tapered leg", (sx * 0.515, sy * 0.224, 0),
                   (sx * 0.453, sy * 0.181, 0.395), (0.032, 0.038), (0.050, 0.052), wood, 0.38 + sx * sy * 0.12)
        slab("End apron", (0.031, 0.371, 0.06), 0.005, 0.003, wood, (sx * 0.453, 0, 0.372), 1)
        slab("Shelf cleat", (0.029, 0.41, 0.029), 0.004, 0.002, wood, (sx * 0.496, 0, 0.124), 1)
    for sy in [-1, 1]:
        slab("Side apron", (0.902, 0.034, 0.054), 0.006, 0.003, wood, (0, sy * 0.181, 0.372))
    for i in range(7):
        slab("Lower shelf slat", (1.016, 0.042, 0.016), 0.009, 0.0035, wood, (0, (i - 3) * 0.058, 0.146),
             offset_uv=(0.4 + 0.065 * i, 0.18 + 0.11 * i))
    paper = material("Uncoated paper", "#dbcfb3", 0.93)
    for z, x, angle, w, d, h, cover in [
        (0.154, -0.20, 6, 0.297, 0.211, 0.031, material("Clothbound ink", "#374c51", 0.96)),
        (0.189, -0.18, -5, 0.247, 0.177, 0.022, material("Clothbound clay", "#a66f52", 0.96)),
    ]:
        for name, dz, size, mat in [
            ("Book cover", 0.0015, (w, d, 0.003), cover),
            ("Book pages", h / 2, (w - 0.005, d - 0.006, h - 0.003), paper),
            ("Book cover", h - 0.0015, (w, d, 0.003), cover),
        ]:
            part = slab(name, size, 0.003, 0.0007, mat, (x, -0.013, z + dz))
            part.rotation_euler.z = math.radians(angle)


def rug():
    width, depth = 2.5, 1.8
    mat = rug_face()
    thickness = 0.012
    slab("Bound flatweave", (width, depth, thickness), 0.017, 0.0035, mat, (0, 0, thickness / 2),
                scale_uv=(width, depth), offset_uv=(0.5, 0.5))
    yarn = material("Undyed cotton warp", "#b8a685", 1)
    verts, faces = [], []
    rng = np.random.default_rng(16)
    for end in [-1, 1]:
        for y in np.linspace(-0.884, 0.884, 168):
            length = rng.uniform(0.026, 0.039)
            lean = rng.uniform(-0.004, 0.004)
            for strand in [-1, 1]:
                start = len(verts)
                for t, rad in [(0, 0.0018), (0.28, 0.0022), (0.52, 0.0017), (1, 0.0011)]:
                    cy = y + lean * t + strand * (0.001 + 0.0022 * t * t) + 0.0016 * math.sin(t * math.pi)
                    cz = 0.0031 + 0.0036 * (1 - t) ** 2
                    for a in np.arange(4) * TAU / 4:
                        verts.append((end * (width / 2 - 0.005 + length * t), cy + rad * math.cos(a), cz + rad * math.sin(a)))
                for row in range(3):
                    for k in range(4):
                        a = start + row * 4
                        face = (a + k, a + (k + 1) % 4, a + 4 + (k + 1) % 4, a + 4 + k)
                        faces.append(face if end > 0 else face[::-1])
    mesh = bpy.data.meshes.new("Twisted fringe")
    mesh.from_pydata(verts, [], faces)
    mesh.materials.append(yarn)
    for polygon in mesh.polygons:
        polygon.use_smooth = True
    fringe = bpy.data.objects.new("Twisted fringe", mesh)
    bpy.context.scene.collection.objects.link(fringe)


def turned(name, profile, mat, steps=64):
    angles = np.arange(steps) * TAU / steps
    return rings_mesh(name, [[(r * math.cos(a), r * math.sin(a), z) for a in angles]
                             for r, z in profile], mat)


def lamp():
    bronze = material("Rubbed bronze", "#594638", 0.38, 0.78)
    brass = material("Aged brass", "#ac8554", 0.36, 0.73)
    turned("Weighted base", [(0.117, 0), (0.129, 0.003), (0.132, 0.008),
           (0.132, 0.019), (0.130, 0.024), (0.124, 0.028), (0.054, 0.033),
           (0.038, 0.037), (0.032, 0.042), (0.029, 0.048)], bronze)
    turned("Base ferrule", [(0.028, 0.046), (0.028, 0.053), (0.022, 0.056),
           (0.019, 0.066), (0.018, 0.078), (0.015, 0.081)], brass)
    turned("Standard", [(0.014, 0.078), (0.014, 0.089), (0.012, 0.098),
           (0.011, 1.288), (0.016, 1.303), (0.016, 1.314)], bronze)
    turned("Lamp holder", [(0.014, 1.311), (0.018, 1.317), (0.018, 1.328),
           (0.023, 1.334), (0.023, 1.341), (0.018, 1.345), (0.018, 1.381),
           (0.020, 1.384), (0.020, 1.389)], brass)
    turned("Opal bulb", [(0.012, 1.385), (0.014, 1.398), (0.019, 1.409),
           (0.026, 1.423), (0.030, 1.436), (0.030, 1.444), (0.028, 1.453),
           (0.022, 1.462), (0.013, 1.468), (0.004, 1.471)],
           material("Opal glass", "#f3eee0", 0.28), 48)
    for angle in np.arange(3) * TAU / 3:
        start = Vector((0, 0, 1.337))
        end = Vector((0.197 * math.cos(angle), 0.197 * math.sin(angle), 1.324))
        spoke = turned("Shade frame spoke", [(0.002, 0), (0.002, (end - start).length)], bronze, 12)
        spoke.location = start
        spoke.rotation_euler = (end - start).to_track_quat("Z", "Y").to_euler()

    linen = woven("Ivory pleated linen", [225, 211, 180])
    angles = np.arange(192) * TAU / 192
    profile = [(0.198, 1.322, 0), (0.197, 1.328, 0),
               (0.194, 1.341, 0.0034), (0.134, 1.585, 0.0028),
               (0.132, 1.595, 0), (0.132, 1.600, 0)]
    rings = [[((r - fold * (1 - math.cos(48 * a))) * math.cos(a),
               (r - fold * (1 - math.cos(48 * a))) * math.sin(a), z) for a in angles]
             for r, z, fold in profile]
    count = len(angles)
    mesh = bpy.data.meshes.new("Pleated shade")
    mesh.from_pydata([p for ring in rings for p in ring], [], [
        (row * count + i, row * count + (i + 1) % count,
         (row + 1) * count + (i + 1) % count, (row + 1) * count + i)
        for row in range(len(rings) - 1) for i in range(count)
    ])
    mesh.materials.append(linen)
    uv = mesh.uv_layers.new(name="UVMap")
    for poly in mesh.polygons:
        row, i = divmod(poly.index, count)
        poly.use_smooth = True
        for index, u, level in zip(poly.loop_indices, [i, i + 1, i + 1, i], [row, row, row + 1, row + 1]):
            uv.data[index].uv = (u / count * 13, (profile[level][1] - 1.322) / 0.08)
    bpy.context.scene.collection.objects.link(bpy.data.objects.new("Pleated shade", mesh))
    binding = material("Linen binding", "#d3c3a5", 0.92)
    for radius, z in [(0.198, 1.324), (0.132, 1.598)]:
        cord("Rolled linen binding", [(radius * math.cos(a), radius * math.sin(a), z) for a in angles],
             0.002, binding)


BUILDERS = {"sofa": sofa, "chair": chair, "table": table, "rug": rug, "lamp": lamp}


def build(asset, output):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    BUILDERS[asset]()
    glb_io.bake_world_transforms()
    low, high = glb_io.mesh_bounds()
    glb_io.transform_meshes(Matrix.Translation((-(low.x + high.x) / 2, -(low.y + high.y) / 2, -low.z)))
    bpy.ops.object.select_all(action="SELECT")
    bpy.context.view_layer.objects.active = glb_io.mesh_objects()[0]
    bpy.ops.object.join()
    model = bpy.context.object
    model.name = "sample-" + asset
    triangles = model.modifiers.new("Triangles", "TRIANGULATE")
    bpy.ops.object.modifier_apply(modifier=triangles.name)
    directory = output / ("sample-" + asset)
    directory.mkdir(exist_ok=True, parents=True)
    model_path = str(directory / "model.glb")
    bpy.ops.export_scene.gltf(filepath=model_path, export_format="GLB", export_tangents=True,
                              export_cameras=False, export_lights=False, export_animations=False)
    glb_io.open_glb(model_path)
    low, high = glb_io.mesh_bounds()
    width, depth, height = [round(n, 6) for n in high - low]
    metadata = {
        "id": "sample-" + asset, "kind": "catalog",
        "nativeSizeM": {"width": width, "height": height, "depth": depth}, "mount": "floor",
        "triangleCount": glb_io.triangle_count(), "hasColorMask": False,
        "provenance": {"method": "roomkit-sample", "sourcePhotoIds": []},
    }
    (directory / "meta.json").write_text(json.dumps(metadata, indent=2) + "\n")
    subprocess.run([bpy.app.binary_path, "-b", "--factory-startup", "--python-exit-code", "1",
                    "-P", str(BLENDER_DIR / "thumbnail.py"), "--", "--input", model_path,
                    "--output", str(directory / "thumb.png"), "--size", "256"], check=True)


def build_bundles(assets, output):
    if output.exists():
        raise FileExistsError(f"Choose a new output directory: {output}")
    output.parent.mkdir(parents=True, exist_ok=True)
    with TemporaryDirectory(dir=output.parent) as temporary:
        staging = Path(temporary) / output.name
        for asset in assets:
            build(asset, staging)
        staging.rename(output)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--asset", choices=BUILDERS)
    args = parser.parse_args(glb_io.script_args())
    build_bundles([args.asset] if args.asset else BUILDERS, args.output.resolve())
