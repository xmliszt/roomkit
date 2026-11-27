"""Helpers for modeler scripts run headless in Blender.

A script starts with `job = start()`, adds parts with `box`, `cylinder`, `lathe`, `slab` and `tube`, gives them
materials from `surface` or `image_material`, then calls `bake(job, size)` and `finish(job)`.

Build in Blender space with the object's front toward -Y and up +Z, which the glTF exporter writes as +Z front
and +Y up. Width is X, depth is Y, height is Z. Locations are part centres in meters.
"""

import argparse
import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.dirname(HERE))

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

import glb_io

MAX_FIT_CORRECTION = 0.05


def start():
    """Parse `--job <job.json>`, empty the scene and return the job spec with its folder as `job["dir"]`."""
    parser = argparse.ArgumentParser()
    parser.add_argument("--job", required=True)
    args = parser.parse_args(glb_io.script_args())
    with open(args.job) as file:
        job = json.load(file)
    job["dir"] = os.path.dirname(os.path.abspath(args.job))
    bpy.ops.wm.read_factory_settings(use_empty=True)
    return job


def hex_to_linear(color):
    """Convert `#rrggbb` to a linear RGBA tuple for a Principled BSDF input."""
    channels = [int(color[index : index + 2], 16) / 255 for index in (1, 3, 5)]
    linear = [value / 12.92 if value <= 0.04045 else ((value + 0.055) / 1.055) ** 2.4 for value in channels]
    return (*linear, 1.0)


def material(name, color, roughness=0.5, metallic=0.0):
    """Return the material `name`, creating it with the given base colour, roughness and metallic on first use."""
    existing = bpy.data.materials.get(name)
    if existing:
        return existing
    created = bpy.data.materials.new(name)
    created.use_nodes = True
    shader = created.node_tree.nodes["Principled BSDF"]
    shader.inputs["Base Color"].default_value = hex_to_linear(color)
    shader.inputs["Roughness"].default_value = roughness
    shader.inputs["Metallic"].default_value = metallic
    return created


def _finish_part(obj, name, mat, bevel, segments, smooth):
    obj.name = name
    obj.data.name = name
    obj.data.materials.append(mat)
    if bevel > 0:
        modifier = obj.modifiers.new("bevel", "BEVEL")
        modifier.width = bevel
        modifier.segments = segments
        modifier.limit_method = "ANGLE"
    if smooth:
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)
        bpy.ops.object.shade_auto_smooth(angle=math.radians(40))
        obj.select_set(False)
    return obj


def _deselect():
    for obj in bpy.context.scene.objects:
        obj.select_set(False)


def box(name, size, location, mat, bevel=0.0, segments=3, smooth=True):
    """Add a box `size` = (width, depth, height) centred on `location`, with an optional bevel."""
    _deselect()
    bpy.ops.mesh.primitive_cube_add(size=1, location=location)
    obj = bpy.context.active_object
    obj.scale = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return _finish_part(obj, name, mat, bevel, segments, smooth)


def cylinder(name, radius, height, location, mat, radius_top=None, vertices=48, bevel=0.0, segments=2, axis="Z"):
    """Add a cylinder, or a cone when `radius_top` differs, centred on `location` along `axis`."""
    _deselect()
    bpy.ops.mesh.primitive_cone_add(
        vertices=vertices,
        radius1=radius,
        radius2=radius if radius_top is None else radius_top,
        depth=height,
        location=location,
        rotation={"Z": (0, 0, 0), "X": (0, math.pi / 2, 0), "Y": (math.pi / 2, 0, 0)}[axis],
    )
    obj = bpy.context.active_object
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    return _finish_part(obj, name, mat, bevel, segments, True)


def lathe(name, profile, location, mat, steps=64):
    """Add a solid of revolution around Z from `profile`, a list of (radius, z) points from bottom to top."""
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    rings = []
    for step in range(steps):
        angle = 2 * math.pi * step / steps
        rings.append([bm.verts.new((r * math.cos(angle), r * math.sin(angle), z)) for r, z in profile])
    for step in range(steps):
        ring, following = rings[step], rings[(step + 1) % steps]
        for index in range(len(profile) - 1):
            bm.faces.new((ring[index], following[index], following[index + 1], ring[index + 1]))
    if profile[0][0] > 0:
        bm.faces.new([ring[0] for ring in reversed(rings)])
    if profile[-1][0] > 0:
        bm.faces.new([ring[-1] for ring in rings])
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    obj.location = location
    bpy.context.scene.collection.objects.link(obj)
    return _finish_part(obj, name, mat, 0, 0, True)


def slab(name, outline, z_bottom, height, mat, bevel=0.0, segments=3):
    """Add a flat solid from a closed 2D `outline` of (x, y) points, extruded up by `height` from `z_bottom`."""
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bottom = [bm.verts.new((x, y, z_bottom)) for x, y in outline]
    face = bm.faces.new(bottom)
    extruded = bmesh.ops.extrude_face_region(bm, geom=[face])
    top = [element for element in extruded["geom"] if isinstance(element, bmesh.types.BMVert)]
    bmesh.ops.translate(bm, verts=top, vec=(0, 0, height))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    return _finish_part(obj, name, mat, bevel, segments, True)


def tube(name, points, radius, mat, resolution=12):
    """Add a round tube of `radius` along a smooth curve through `points`."""
    data = bpy.data.curves.new(name, "CURVE")
    data.dimensions = "3D"
    data.bevel_depth = radius
    data.bevel_resolution = 4
    data.use_fill_caps = True
    spline = data.splines.new("BEZIER")
    spline.bezier_points.add(len(points) - 1)
    for point, location in zip(spline.bezier_points, points):
        point.co = location
        point.handle_left_type = "AUTO"
        point.handle_right_type = "AUTO"
    spline.resolution_u = resolution
    obj = bpy.data.objects.new(name, data)
    bpy.context.scene.collection.objects.link(obj)
    obj.data.materials.append(mat)
    return obj


def surface(name, color, roughness=0.5, metallic=0.0, color_noise=0.0, roughness_noise=0.0, bump=0.0,
            noise_scale=60.0, stretch=(1.0, 1.0, 1.0), detail=6.0):
    """Return a new procedural material: base `color` varied by noise, with optional roughness variation and bump.

    `stretch` scales the noise per object axis, so (1, 1, 30) gives vertical streaks (brushed metal, wood grain).
    Bake it with `bake()` before export: the glTF exporter keeps only image textures.
    """
    mat = material(name, color, roughness, metallic)
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    shader = nodes["Principled BSDF"]
    coords = nodes.new("ShaderNodeTexCoord")
    mapping = nodes.new("ShaderNodeMapping")
    mapping.inputs["Scale"].default_value = stretch
    links.new(coords.outputs["Object"], mapping.inputs["Vector"])
    noise = nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = noise_scale
    noise.inputs["Detail"].default_value = detail
    links.new(mapping.outputs["Vector"], noise.inputs["Vector"])
    if color_noise > 0:
        tint = nodes.new("ShaderNodeHueSaturation")
        tint.inputs["Color"].default_value = hex_to_linear(color)
        value = nodes.new("ShaderNodeMapRange")
        value.inputs["To Min"].default_value = 1 - color_noise
        value.inputs["To Max"].default_value = 1 + color_noise
        links.new(noise.outputs["Fac"], value.inputs["Value"])
        links.new(value.outputs["Result"], tint.inputs["Value"])
        links.new(tint.outputs["Color"], shader.inputs["Base Color"])
    if roughness_noise > 0:
        spread = nodes.new("ShaderNodeMapRange")
        spread.inputs["To Min"].default_value = max(0.0, roughness - roughness_noise)
        spread.inputs["To Max"].default_value = min(1.0, roughness + roughness_noise)
        links.new(noise.outputs["Fac"], spread.inputs["Value"])
        links.new(spread.outputs["Result"], shader.inputs["Roughness"])
    if bump > 0:
        relief = nodes.new("ShaderNodeBump")
        relief.inputs["Strength"].default_value = bump
        relief.inputs["Distance"].default_value = 0.002
        links.new(noise.outputs["Fac"], relief.inputs["Height"])
        links.new(relief.outputs["Normal"], shader.inputs["Normal"])
    return mat


def fabric(name, color, weave="boucle", loop_mm=6.0, relief=0.6, roughness=0.96, color_noise=0.05):
    """Return a new matte upholstery material: base `color` with a fine `weave` relief ("boucle" loops, "plain"
    crossed threads or "velvet" soft pile) about `loop_mm` across, and roughness near 1.

    The relief and its colour variation bake into the normal, roughness and base colour maps. `loop_mm` below 4 is
    raised to 4, the smallest relief a 2048 px bake of a large piece keeps.
    """
    loop_mm = max(loop_mm, 4.0)
    mat = material(name, color, roughness, 0.0)
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    shader = nodes["Principled BSDF"]
    coords = nodes.new("ShaderNodeTexCoord")
    scale = 1000.0 / loop_mm
    if weave == "plain":
        across = nodes.new("ShaderNodeTexWave")
        across.wave_type = "BANDS"
        across.bands_direction = "X"
        across.inputs["Scale"].default_value = scale / 2
        along = nodes.new("ShaderNodeTexWave")
        along.wave_type = "BANDS"
        along.bands_direction = "Z"
        along.inputs["Scale"].default_value = scale / 2
        links.new(coords.outputs["Object"], across.inputs["Vector"])
        links.new(coords.outputs["Object"], along.inputs["Vector"])
        height = nodes.new("ShaderNodeMath")
        height.operation = "MULTIPLY"
        links.new(across.outputs["Fac"], height.inputs[0])
        links.new(along.outputs["Fac"], height.inputs[1])
        height_socket = height.outputs["Value"]
    elif weave == "velvet":
        pile = nodes.new("ShaderNodeTexNoise")
        pile.inputs["Scale"].default_value = scale / 2
        pile.inputs["Detail"].default_value = 8
        links.new(coords.outputs["Object"], pile.inputs["Vector"])
        height_socket = pile.outputs["Fac"]
    else:
        loops = nodes.new("ShaderNodeTexVoronoi")
        loops.feature = "SMOOTH_F1"
        loops.inputs["Scale"].default_value = scale
        links.new(coords.outputs["Object"], loops.inputs["Vector"])
        invert = nodes.new("ShaderNodeMath")
        invert.operation = "SUBTRACT"
        invert.inputs[0].default_value = 1.0
        links.new(loops.outputs["Distance"], invert.inputs[1])
        height_socket = invert.outputs["Value"]
    relief_node = nodes.new("ShaderNodeBump")
    relief_node.inputs["Strength"].default_value = relief
    relief_node.inputs["Distance"].default_value = loop_mm / 1000 / 3
    links.new(height_socket, relief_node.inputs["Height"])
    links.new(relief_node.outputs["Normal"], shader.inputs["Normal"])
    shade = nodes.new("ShaderNodeMapRange")
    shade.inputs["To Min"].default_value = 1 - color_noise * 2
    shade.inputs["To Max"].default_value = 1 + color_noise
    links.new(height_socket, shade.inputs["Value"])
    tint = nodes.new("ShaderNodeHueSaturation")
    tint.inputs["Color"].default_value = hex_to_linear(color)
    links.new(shade.outputs["Result"], tint.inputs["Value"])
    links.new(tint.outputs["Color"], shader.inputs["Base Color"])
    spread = nodes.new("ShaderNodeMapRange")
    spread.inputs["To Min"].default_value = min(1.0, roughness + 0.03)
    spread.inputs["To Max"].default_value = max(0.0, roughness - 0.04)
    links.new(height_socket, spread.inputs["Value"])
    links.new(spread.outputs["Result"], shader.inputs["Roughness"])
    return mat


def image_material(name, image_path, roughness=0.5, metallic=0.0):
    """Return a new material whose base colour is the image at `image_path`, read through the mesh's UV map."""
    mat = material(name, "#ffffff", roughness, metallic)
    nodes = mat.node_tree.nodes
    texture = nodes.new("ShaderNodeTexImage")
    texture.image = bpy.data.images.load(image_path, check_existing=True)
    mat.node_tree.links.new(texture.outputs["Color"], nodes["Principled BSDF"].inputs["Base Color"])
    return mat


def _read_pixels(image):
    width, height = image.size
    pixels = np.empty(width * height * 4, dtype=np.float32)
    image.pixels.foreach_get(pixels)
    return pixels.reshape(height, width, 4)[::-1]


def _write_image(array, path):
    height, width = array.shape[:2]
    image = bpy.data.images.new(os.path.basename(path), width, height)
    image.pixels.foreach_set(np.ascontiguousarray(array[::-1]).astype(np.float32).ravel())
    image.filepath_raw = path
    image.file_format = "JPEG" if path.lower().endswith((".jpg", ".jpeg")) else "PNG"
    image.save()
    return path


def _sample(pixels, xs, ys):
    height, width = pixels.shape[:2]
    xs = np.clip(xs, 0, width - 1.001)
    ys = np.clip(ys, 0, height - 1.001)
    x0, y0 = xs.astype(int), ys.astype(int)
    fx, fy = (xs - x0)[..., None], (ys - y0)[..., None]
    top = pixels[y0, x0] * (1 - fx) + pixels[y0, x0 + 1] * fx
    bottom = pixels[y0 + 1, x0] * (1 - fx) + pixels[y0 + 1, x0 + 1] * fx
    return top * (1 - fy) + bottom * fy


def photo_color(photo_path, box):
    """Return the median colour of the photo inside `box` (x0, y0, x1, y1 as fractions of the image, origin at the
    top left) as `#rrggbb`, sRGB-encoded as the photo stores it. Use it in a script run through the blender
    command to sample surfaces and neutral references."""
    pixels = _read_pixels(bpy.data.images.load(photo_path, check_existing=True))
    height, width = pixels.shape[:2]
    x0, y0, x1, y1 = box
    region = pixels[int(y0 * height) : max(int(y1 * height), int(y0 * height) + 1), int(x0 * width) : max(int(x1 * width), int(x0 * width) + 1), :3]
    median = np.median(region.reshape(-1, 3), axis=0)
    return "#" + "".join(f"{round(float(np.clip(value, 0, 1)) * 255):02x}" for value in median)


def photo_quad(photo_path, corners_px, out_path, width_px, height_px):
    """Write the photo region inside `corners_px` (top-left, top-right, bottom-right, bottom-left, in photo pixels
    with the origin at the top left) as a flat `width_px` x `height_px` image at `out_path`, removing perspective."""
    pixels = _read_pixels(bpy.data.images.load(photo_path, check_existing=True))
    target = [(0, 0), (width_px - 1, 0), (width_px - 1, height_px - 1), (0, height_px - 1)]
    rows = []
    for (u, v), (x, y) in zip(target, corners_px):
        rows.append([u, v, 1, 0, 0, 0, -u * x, -v * x, -x])
        rows.append([0, 0, 0, u, v, 1, -u * y, -v * y, -y])
    homography = np.linalg.svd(np.array(rows, dtype=np.float64))[2][-1].reshape(3, 3)
    us, vs = np.meshgrid(np.arange(width_px), np.arange(height_px))
    mapped = homography @ np.stack([us.ravel(), vs.ravel(), np.ones(us.size)])
    xs = (mapped[0] / mapped[2]).reshape(height_px, width_px)
    ys = (mapped[1] / mapped[2]).reshape(height_px, width_px)
    return _write_image(_sample(pixels, xs, ys), out_path)


def tileable(image_path, out_path):
    """Write a copy of the image at `image_path` whose opposite edges match, so it repeats without visible seams."""
    pixels = _read_pixels(bpy.data.images.load(image_path, check_existing=True))
    height, width = pixels.shape[:2]
    shifted = np.roll(pixels, (height // 2, width // 2), axis=(0, 1))
    wx = 1 - np.abs(np.linspace(-1, 1, width))
    wy = 1 - np.abs(np.linspace(-1, 1, height))
    weight = np.minimum.outer(wy, wx)[..., None] ** 0.5
    result = pixels * weight + shifted * (1 - weight)
    result[:, 0] = result[:, -1] = (result[:, 0] + result[:, -1]) / 2
    result[0, :] = result[-1, :] = (result[0, :] + result[-1, :]) / 2
    return _write_image(result, out_path)


def uv_cube(obj, size=1.0):
    """Give `obj` a box-projected UV map where one UV unit is `size` meters, for tiled textures."""
    _deselect()
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.cube_project(cube_size=size, scale_to_bounds=False, correct_aspect=True)
    bpy.ops.object.mode_set(mode="OBJECT")
    obj.select_set(False)


def uv_face_fit(obj, axis="-Y"):
    """Give `obj` a planar UV map seen from `axis` that stretches its extent to the 0..1 square, for a photo of
    one flat face (`photo_quad`). Faces turned away get the same projection."""
    index = "XYZ".index(axis[1])
    u_axis, v_axis = {0: (1, 2), 1: (0, 2), 2: (0, 1)}[index]
    flip = (axis[0] == "+") == (index == 1)
    coords = [vertex.co for vertex in obj.data.vertices]
    low = [min(c[a] for c in coords) for a in range(3)]
    high = [max(c[a] for c in coords) for a in range(3)]
    layer = obj.data.uv_layers.get("UVMap") or obj.data.uv_layers.new(name="UVMap")
    obj.data.uv_layers.active = layer
    for loop in obj.data.loops:
        co = obj.data.vertices[loop.vertex_index].co
        u = (co[u_axis] - low[u_axis]) / max(high[u_axis] - low[u_axis], 1e-9)
        v = (co[v_axis] - low[v_axis]) / max(high[v_axis] - low[v_axis], 1e-9)
        layer.data[loop.index].uv = (1 - u if flip else u, v)


def _to_single_mesh():
    _deselect()
    parts = list(bpy.context.scene.objects)
    for obj in parts:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.convert(target="MESH")
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    for obj in bpy.context.scene.objects:
        obj.select_set(obj in meshes)
    bpy.context.view_layer.objects.active = meshes[0]
    if len(meshes) > 1:
        bpy.ops.object.join()
    joined = bpy.context.view_layer.objects.active
    joined.name = "model"
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    return joined


def _image_node(mat, image):
    node = mat.node_tree.nodes.new("ShaderNodeTexImage")
    node.image = image
    mat.node_tree.nodes.active = node
    return node


def _bake_pass(obj, image, bake_type, margin_px, prepare=None):
    added = []
    for slot in obj.material_slots:
        if slot.material:
            added.append((slot.material, _image_node(slot.material, image)))
    restore = prepare() if prepare else None
    settings = bpy.context.scene.render.bake
    settings.margin = margin_px
    if bake_type == "NORMAL":
        settings.normal_space = "TANGENT"
    bpy.ops.object.bake(type=bake_type)
    if restore:
        restore()
    for mat, node in added:
        mat.node_tree.nodes.remove(node)


def _input_as_emission(obj, input_name):
    saved = []
    for slot in obj.material_slots:
        mat = slot.material
        if not mat:
            continue
        shader = mat.node_tree.nodes.get("Principled BSDF")
        socket = shader.inputs[input_name]
        links = mat.node_tree.links
        emission = mat.node_tree.nodes.new("ShaderNodeEmission")
        output = mat.node_tree.nodes["Material Output"]
        previous = output.inputs["Surface"].links[0].from_socket
        value = socket.default_value
        emission.inputs["Color"].default_value = tuple(value) if hasattr(value, "__len__") else (value, value, value, 1)
        if socket.links:
            links.new(socket.links[0].from_socket, emission.inputs["Color"])
        links.new(emission.outputs["Emission"], output.inputs["Surface"])
        saved.append((mat, emission, previous, output))

    def restore():
        for mat, emission, previous, output in saved:
            mat.node_tree.links.new(previous, output.inputs["Surface"])
            mat.node_tree.nodes.remove(emission)

    return restore


def bake(job, size=2048, ao_samples=32, margin_px=8, island_margin=0.004):
    """Join every part into one mesh, unwrap it, and bake base colour, roughness, metallic, normal and ambient
    occlusion into `size` px images in `<job dir>/textures/`, replacing all materials with one image-based material
    the glTF exporter keeps. Returns the joined object."""
    obj = _to_single_mesh()
    for layer in obj.data.uv_layers:
        layer.active_render = True
        break
    bake_layer = obj.data.uv_layers.new(name="bake")
    obj.data.uv_layers.active = bake_layer
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=island_margin)
    bpy.ops.object.mode_set(mode="OBJECT")
    if len(obj.data.uv_layers) == 1:
        bake_layer.active_render = True

    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 1
    scene.cycles.use_denoising = False
    world = bpy.data.worlds.new("bake")
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (1, 1, 1, 1)
    scene.world = world

    def new_image(label, non_color):
        image = bpy.data.images.new(f"{obj.name}_{label}", size, size, alpha=False)
        if non_color:
            image.colorspace_settings.name = "Non-Color"
        return image

    images = {
        "base": new_image("base", False),
        "roughness": new_image("roughness", True),
        "metallic": new_image("metallic", True),
        "normal": new_image("normal", True),
        "ao": new_image("ao", True),
    }
    _bake_pass(obj, images["base"], "EMIT", margin_px, prepare=lambda: _input_as_emission(obj, "Base Color"))
    _bake_pass(obj, images["roughness"], "ROUGHNESS", margin_px)
    _bake_pass(obj, images["metallic"], "EMIT", margin_px, prepare=lambda: _input_as_emission(obj, "Metallic"))
    _bake_pass(obj, images["normal"], "NORMAL", margin_px)
    scene.cycles.samples = ao_samples
    _bake_pass(obj, images["ao"], "AO", margin_px)
    folder = os.path.join(job["dir"], "textures")
    os.makedirs(folder, exist_ok=True)
    for label, image in list(images.items()):
        path = os.path.join(folder, f"{label}.jpg" if label == "base" else f"{label}.png")
        image.filepath_raw = path
        image.file_format = "JPEG" if label == "base" else "PNG"
        image.save()
        saved = bpy.data.images.load(path)
        saved.colorspace_settings.name = image.colorspace_settings.name
        images[label] = saved

    baked = bpy.data.materials.new("baked")
    baked.use_nodes = True
    baked.use_backface_culling = True
    nodes, links = baked.node_tree.nodes, baked.node_tree.links
    shader = nodes["Principled BSDF"]

    def texture(image):
        node = nodes.new("ShaderNodeTexImage")
        node.image = image
        return node

    links.new(texture(images["base"]).outputs["Color"], shader.inputs["Base Color"])
    links.new(texture(images["roughness"]).outputs["Color"], shader.inputs["Roughness"])
    links.new(texture(images["metallic"]).outputs["Color"], shader.inputs["Metallic"])
    normal_map = nodes.new("ShaderNodeNormalMap")
    links.new(texture(images["normal"]).outputs["Color"], normal_map.inputs["Color"])
    links.new(normal_map.outputs["Normal"], shader.inputs["Normal"])
    group = bpy.data.node_groups.new("glTF Material Output", "ShaderNodeTree")
    group.interface.new_socket("Occlusion", in_out="INPUT", socket_type="NodeSocketFloat")
    settings = nodes.new("ShaderNodeGroup")
    settings.node_tree = group
    links.new(texture(images["ao"]).outputs["Color"], settings.inputs["Occlusion"])

    obj.data.materials.clear()
    obj.data.materials.append(baked)
    for layer in [layer for layer in obj.data.uv_layers if layer.name != "bake"]:
        obj.data.uv_layers.remove(layer)
    return obj


def soften(obj, levels=2):
    """Add a subdivision surface to `obj` so its bevelled box shape becomes plump and rounded, as upholstery is."""
    modifier = obj.modifiers.new("soften", "SUBSURF")
    modifier.levels = levels
    modifier.render_levels = levels
    return obj


def rounded_rect(width, depth, radius, corner_steps=8):
    """Return the outline of a `width` x `depth` rectangle centred on the origin with rounded corners."""
    points = []
    corners = [
        (width / 2 - radius, depth / 2 - radius, 0),
        (-width / 2 + radius, depth / 2 - radius, 90),
        (-width / 2 + radius, -depth / 2 + radius, 180),
        (width / 2 - radius, -depth / 2 + radius, 270),
    ]
    for cx, cy, start_deg in corners:
        for step in range(corner_steps + 1):
            angle = math.radians(start_deg + 90 * step / corner_steps)
            points.append((cx + radius * math.cos(angle), cy + radius * math.sin(angle)))
    return points


def finish(job, output="raw.glb"):
    """Convert every part to a mesh, fit the parts to `job["sizeM"]` with the bottom centre at the origin, and export
    `output` in the job folder."""
    _deselect()
    parts = list(bpy.context.scene.objects)
    for obj in parts:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.convert(target="MESH")
    parts = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    for obj in parts:
        if obj.data.users > 1:
            obj.data = obj.data.copy()
        obj.data.transform(obj.matrix_world)
        obj.matrix_world = Matrix.Identity(4)

    low, high = glb_io.mesh_bounds()
    built = high - low
    size = job["sizeM"]
    target = Vector((size["width"], size["depth"], size["height"]))
    correction = Vector([target[axis] / built[axis] for axis in range(3)])
    if any(abs(factor - 1) > MAX_FIT_CORRECTION for factor in correction):
        raise ValueError(f"built size {tuple(built)} is more than 5% off {tuple(target)}; fix the script")
    anchor = Vector(((low.x + high.x) / 2, (low.y + high.y) / 2, low.z))
    fit = Matrix.Diagonal((*correction, 1)) @ Matrix.Translation(-anchor)
    for obj in parts:
        obj.data.transform(fit)

    glb_io.export_glb(os.path.join(job["dir"], output))
    glb_io.print_result(
        {
            "builtSizeM": list(built),
            "fitCorrection": list(correction),
            "triangleCount": glb_io.triangle_count(),
            "parts": len(parts),
        }
    )
