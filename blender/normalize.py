"""Normalize a GLB: +Y up, +Z front, anchor at the origin, largest dimension scaled to an expected size.

blender --background --factory-startup --python-exit-code 1 --python normalize.py -- \
    --input in.glb --output out.glb --mount floor --expected-size 0.9 [--source-up=+Y] [--source-front=+Z]

Sidecars use glTF coordinates (+Y up, +Z front) in meters. `points.bin` is
8,000 little-endian records of six float32 values: x, y, z, red, green, blue;
colours are sRGB in [0, 1]. `lines.bin` starts with a little-endian uint32
polyline count, followed by a uint32 vertex count and that many float32 XYZ
triples per polyline, ordered by descending length.

`--source-up` and `--source-front` name the input's axes in glTF file coordinates. Write them with `=`:
argparse reads a separate `-X` as an option.
"""

import argparse
import math
import os
import sys
import subprocess
import struct
from pathlib import Path

import bmesh
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy
from mathutils import Matrix, Vector

import glb_io
from color_mask import write_color_mask
from mesh_cleanup import clean_mesh

FILE_AXES = {
    "+X": (1, 0, 0),
    "-X": (-1, 0, 0),
    "+Y": (0, 1, 0),
    "-Y": (0, -1, 0),
    "+Z": (0, 0, 1),
    "-Z": (0, 0, -1),
}


def file_to_blender(axis):
    x, y, z = axis
    return Vector((x, -z, y))


def axis_correction(source_up, source_front):
    up = file_to_blender(FILE_AXES[source_up])
    front = file_to_blender(FILE_AXES[source_front])
    if abs(up.dot(front)) > 1e-6:
        raise ValueError(f"--source-up {source_up} and --source-front {source_front} are not perpendicular")
    right = up.cross(front)
    source = Matrix((right, front, up)).transposed()
    target = Matrix(((1, 0, 0), (0, -1, 0), (0, 0, 1)))
    return (target @ source.transposed()).to_4x4()


def anchor_point(mount, low, high):
    centre = (low + high) / 2
    if mount == "floor":
        return Vector((centre.x, centre.y, low.z))
    if mount == "ceiling":
        return Vector((centre.x, centre.y, high.z))
    return Vector((centre.x, high.y, centre.z))


def positive_meters(text):
    value = float(text)
    if not math.isfinite(value) or value <= 0:
        raise argparse.ArgumentTypeError(f"expected a size above 0, got {text}")
    return value


def decimate(budget):
    total = glb_io.triangle_count()
    if total <= budget:
        return
    for obj in glb_io.mesh_objects():
        obj.data.calc_loop_triangles()
        count = len(obj.data.loop_triangles)
        target = max(1, int(budget * count / total))
        for attempt in range(8):
            obj.data.calc_loop_triangles()
            count = len(obj.data.loop_triangles)
            if count <= target:
                break
            bpy.context.view_layer.objects.active = obj
            modifier = obj.modifiers.new("triangle-budget", "DECIMATE")
            modifier.ratio = max(0, (target - 1) / count)
            modifier.use_collapse_triangulate = True
            bpy.ops.object.modifier_apply(modifier=modifier.name)
    if glb_io.triangle_count() > budget:
        raise ValueError(f"decimation could not meet the {budget} triangle budget")


def remove_remnants(*, expected, is_floor_covering):
    objects = glb_io.mesh_objects()
    vertices, faces, owners = [], [], []
    offset = 0
    for obj in objects:
        mesh = obj.data
        mesh.calc_loop_triangles()
        positions = np.empty(len(mesh.vertices) * 3)
        mesh.vertices.foreach_get("co", positions)
        triangles = np.empty(len(mesh.loop_triangles) * 3, dtype=np.int64)
        mesh.loop_triangles.foreach_get("vertices", triangles)
        polygons = np.empty(len(mesh.loop_triangles), dtype=np.int64)
        mesh.loop_triangles.foreach_get("polygon_index", polygons)
        vertices.append(positions.reshape(-1, 3))
        faces.append(triangles.reshape(-1, 3) + offset)
        owners.append(polygons)
        offset += len(mesh.vertices)
    if not faces:
        return None
    keep, report = clean_mesh(vertices=np.concatenate(vertices), faces=np.concatenate(faces),
                              expected=expected, is_floor_covering=is_floor_covering)
    start = 0
    for obj, polygons in zip(objects, owners):
        kept = keep[start:start + len(polygons)]
        start += len(polygons)
        drop = set(polygons[~kept].tolist()) - set(polygons[kept].tolist())
        if not drop:
            continue
        if not kept.any():
            bpy.data.objects.remove(obj)
            continue
        work = bmesh.new()
        work.from_mesh(obj.data)
        work.faces.ensure_lookup_table()
        bmesh.ops.delete(work, geom=[work.faces[index] for index in sorted(drop)], context="FACES")
        bmesh.ops.delete(work, geom=[vertex for vertex in work.verts if not vertex.link_faces], context="VERTS")
        work.to_mesh(obj.data)
        work.free()
    return report


def downscale_textures():
    for image in bpy.data.images:
        width, height = image.size
        if max(width, height) <= 2048:
            continue
        image_format = image.file_format
        image.scale(max(1, round(width * 2048 / max(width, height))),
                    max(1, round(height * 2048 / max(width, height))))
        image.file_format = image_format
        glb_io.set_image_pixels(image, glb_io.image_pixels(image))


def write_points(path):
    rng = np.random.default_rng(0)
    triangles = []
    areas = []
    for obj in glb_io.mesh_objects():
        mesh = obj.data
        mesh.calc_loop_triangles()
        for triangle in mesh.loop_triangles:
            if triangle.area > 0:
                triangles.append((obj, triangle))
                areas.append(triangle.area)
    if not areas:
        raise ValueError("the GLB has no surface area")
    selected = rng.choice(len(triangles), 8000, p=np.array(areas) / sum(areas))
    weights = rng.random((8000, 2))
    root = np.sqrt(weights[:, 0])
    barycentric = np.column_stack((1 - root, root * (1 - weights[:, 1]), root * weights[:, 1]))
    records = np.empty((8000, 6), dtype='<f4')
    cached_pixels = {}
    cached_uvs = {}
    for index, triangle_index in enumerate(selected):
        obj, triangle = triangles[triangle_index]
        mesh = obj.data
        position = barycentric[index] @ np.array([mesh.vertices[v].co for v in triangle.vertices])
        records[index, :3] = (position[0], position[2], -position[1])
        material = mesh.materials[triangle.material_index]
        node = glb_io.base_color_node(material)
        image = node.image
        if image.name not in cached_pixels:
            cached_pixels[image.name] = glb_io.image_pixels(image)
        pixels = cached_pixels[image.name]
        key = (obj.name, material.name)
        if key not in cached_uvs:
            cached_uvs[key] = glb_io.base_color_uvs(obj, node)
        uv = barycentric[index] @ cached_uvs[key][list(triangle.loops)]
        records[index, 3:] = glb_io.sample_texture(pixels, uv[None, :], glb_io.texture_wrap_modes(node))[0, :3]
    path.write_bytes(records.tobytes())


def write_lines(path):
    proxy = bmesh.new()
    for obj in glb_io.mesh_objects():
        proxy.from_mesh(obj.data)
    bmesh.ops.remove_doubles(proxy, verts=list(proxy.verts), dist=1e-6)
    mesh = bpy.data.meshes.new('line-proxy')
    proxy.to_mesh(mesh)
    proxy.free()
    obj = bpy.data.objects.new('line-proxy', mesh)
    bpy.context.scene.collection.objects.link(obj)
    mesh.calc_loop_triangles()
    if len(mesh.loop_triangles) > 2000:
        bpy.context.view_layer.objects.active = obj
        modifier = obj.modifiers.new('line-budget', 'DECIMATE')
        modifier.ratio = 1990 / len(mesh.loop_triangles)
        modifier.use_collapse_triangulate = True
        bpy.ops.object.modifier_apply(modifier=modifier.name)
    obj.data.calc_loop_triangles()
    proxy_count = len(obj.data.loop_triangles)
    proxy = bmesh.new()
    proxy.from_mesh(obj.data)
    proxy.normal_update()
    proxy.verts.ensure_lookup_table()
    proxy.verts.index_update()
    vertices = [(vertex.co.x, vertex.co.z, -vertex.co.y) for vertex in proxy.verts]
    edges = [tuple(vertex.index for vertex in edge.verts) for edge in proxy.edges
             if len(edge.link_faces) != 2 or edge.calc_face_angle() >= math.radians(30)]
    adjacency = {i: set() for edge in edges for i in edge}
    for a, b in edges:
        adjacency[a].add(b)
        adjacency[b].add(a)
    remaining = {tuple(sorted(edge)) for edge in edges}
    polylines = []
    def trace(start, next_vertex):
        line = [start]
        while True:
            remaining.remove(tuple(sorted((start, next_vertex))))
            line.append(next_vertex)
            following = [v for v in adjacency[next_vertex] if tuple(sorted((next_vertex, v))) in remaining]
            if len(adjacency[next_vertex]) != 2 or not following:
                break
            start, next_vertex = next_vertex, min(following)
        polylines.append(np.array([vertices[v] for v in line], dtype='<f4'))
    for start in sorted(adjacency):
        if len(adjacency[start]) == 2:
            continue
        for neighbour in sorted(adjacency[start]):
            if tuple(sorted((start, neighbour))) in remaining:
                trace(start, neighbour)
    while remaining:
        trace(*min(remaining))
    polylines.sort(key=lambda line: float(np.linalg.norm(np.diff(line, axis=0), axis=1).sum()), reverse=True)
    with path.open('wb') as output:
        output.write(struct.pack('<I', len(polylines)))
        for line in polylines:
            output.write(struct.pack('<I', len(line)))
            output.write(line.tobytes())
    proxy.free()
    bpy.data.objects.remove(obj, do_unlink=True)
    bpy.data.meshes.remove(mesh)
    return proxy_count


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--mount", required=True, choices=["floor", "wall", "ceiling"])
    parser.add_argument("--expected-size", required=True, type=positive_meters)
    parser.add_argument("--expected-width", type=positive_meters)
    parser.add_argument("--expected-height", type=positive_meters)
    parser.add_argument("--expected-depth", type=positive_meters)
    parser.add_argument("--source-up", default="+Y", choices=list(FILE_AXES))
    parser.add_argument("--source-front", default="+Z", choices=list(FILE_AXES))
    parser.add_argument("--remove-remnants", action="store_true")
    parser.add_argument("--floor-covering", action="store_true")
    args = parser.parse_args(glb_io.script_args())

    expected = [args.expected_width, args.expected_height, args.expected_depth]
    if any(value is not None for value in expected) and not all(value is not None for value in expected):
        parser.error("--expected-width, --expected-height and --expected-depth must be supplied together")
    if args.remove_remnants and args.expected_width is None:
        parser.error("--remove-remnants needs the expected width, height and depth")
    glb_io.open_static_glb(args.input)
    glb_io.bake_world_transforms()
    glb_io.transform_meshes(axis_correction(args.source_up, args.source_front))

    cleanup = None
    if args.remove_remnants:
        cleanup = remove_remnants(
            expected=(args.expected_width, args.expected_depth, args.expected_height),
            is_floor_covering=args.floor_covering,
        )
    decimate(150000)
    low, high = glb_io.mesh_bounds()
    largest = max(high - low)
    if largest <= 0:
        raise ValueError("the GLB has no extent")
    scale = args.expected_size / largest
    anchor = anchor_point(args.mount, low, high)
    glb_io.transform_meshes(Matrix.Scale(scale, 4) @ Matrix.Translation(-anchor))

    low, high = glb_io.mesh_bounds()
    size = high - low
    output_dir = Path(args.output).resolve().parent
    output_dir.mkdir(parents=True, exist_ok=True)
    downscale_textures()
    image = glb_io.base_color_atlas()
    downscale_textures()
    _, reference_luma, _ = write_color_mask(image, output_dir / "colorMask.png")
    write_points(output_dir / "points.bin")
    proxy_count = write_lines(output_dir / "lines.bin")
    formats = {image.file_format for image in glb_io.base_color_images()}
    glb_io.export_glb(args.output, image_format="JPEG" if formats == {"JPEG"} else "AUTO")
    actual = [size.x, size.z, size.y]
    proportion_check = None
    if all(value is not None for value in expected):
        largest_axis = int(np.argmax(expected))
        expected_scaled = np.array(expected) * (args.expected_size / max(expected))
        errors = np.abs(np.array(actual) / expected_scaled - 1)
        checked = [axis for axis in range(3) if axis != largest_axis]
        proportion_check = {"passed": bool(all(errors[axis] <= 0.2 + 1e-6 for axis in checked)),
                            "relativeError": dict(zip(("width", "height", "depth"), errors.tolist()))}
    result_triangle_count = glb_io.triangle_count()
    thumbnail = subprocess.run(
        [bpy.app.binary_path, "--background", "--factory-startup", "--python-exit-code", "1",
         "--python", str(Path(__file__).with_name("thumbnail.py")), "--",
         "--input", str(Path(args.output).resolve()), "--output", str(output_dir / "thumb.png")],
        capture_output=True, text=True, timeout=120)
    if thumbnail.returncode != 0:
        raise RuntimeError("thumbnail failed: " + thumbnail.stdout + thumbnail.stderr)
    glb_io.print_result(
        {
            "blender": bpy.app.version_string,
            "mount": args.mount,
            "scale": scale,
            "nativeSizeM": {"width": size.x, "height": size.z, "depth": size.y},
            "triangleCount": result_triangle_count,
            "hasColorMask": True,
            "referenceLuma": reference_luma,
            "proportionCheck": proportion_check,
            "proxyTriangleCount": proxy_count,
            "cleanup": cleanup,
        }
    )


if __name__ == "__main__":
    main()
