import json
import math
import resource
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import bpy
import numpy as np
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Matrix, Vector
from mathutils.geometry import tessellate_polygon

from photo_geometry import item_frame, kelvin_rgb, wall_polygons, wall_segments
from photo_materials import recolor_materials, surface_material
from photo_probes import collect_probes
import glb_io
from recolor import srgb_to_linear

LUMENS_PER_WATT = 683
Y_UP_TO_Z_UP = Matrix.Rotation(math.pi / 2, 4, "X")


def point(value):
    return Y_UP_TO_Z_UP @ Vector(value)


def mesh_object(name, polygons, material, hidden=False):
    vertices, faces, uvs = [], [], []
    for polygon in polygons:
        offset = len(vertices)
        vertices.extend(point(vertex) for vertex, _ in polygon)
        uvs.extend(uv for _, uv in polygon)
        faces.append(tuple(range(offset, len(vertices))))
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    uv_layer = mesh.uv_layers.new()
    for face in mesh.polygons:
        for loop_index in face.loop_indices:
            uv_layer.data[loop_index].uv = uvs[mesh.loops[loop_index].vertex_index]
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(material)
    obj.visible_camera = not hidden
    return obj


def build_room(manifest, root):
    room = manifest["scene"]["room"]
    hidden = manifest["view"]["hiddenSurfaceIds"]
    textures = {texture["assetId"]: texture for texture in manifest["surfaces"]}
    height = room["ceilingHeightM"]
    boundary = [Vector((wall["startM"]["x"], wall["startM"]["z"], 0)) for wall in room["walls"]]
    triangles = [[boundary[index] for index in triangle] for triangle in tessellate_polygon([boundary])]
    for name, y in [("floor", 0), ("ceiling", height)]:
        polygons = [[((v.x, y, v.y), (v.x, v.y)) for v in triangle] for triangle in triangles]
        mesh_object(name, polygons, surface_material(name, room, textures, root), name in hidden)
    segments = wall_segments(room)
    for segment in segments:
        if segment["kind"] == "open":
            continue
        def vertex(x, y, depth=0):
            return (segment["start"]["x"] + segment["dx"] * x - segment["dz"] * depth, y, segment["start"]["z"] + segment["dz"] * x + segment["dx"] * depth)
        polygons = []
        for piece in wall_polygons(segment, height, manifest["scene"]["items"]):
            polygons.append([(vertex(x, y), (x, y)) for x, y in piece])
            polygons.append([(vertex(x, y, 0.12), (x, y)) for x, y in reversed(piece)])
            for index, a in enumerate(piece):
                b = piece[(index + 1) % len(piece)]
                polygons.append([(vertex(*a), a), (vertex(*a, 0.12), a), (vertex(*b, 0.12), b), (vertex(*b), b)])
        mesh_object(segment["id"], polygons, surface_material(segment["id"], room, textures, root), segment["id"] in hidden)
    return segments


def add_light(item, transform, objects, depth):
    light = item.get("light")
    if not light or not light["on"]:
        return
    size = item["sizeM"]
    emitter = light["emitter"]
    kind = item["placement"]["kind"]
    local = Vector(((emitter["x"] - 0.5) * size["width"], (emitter["y"] - (1 if kind == "ceiling" else 0.5 if kind == "wall" else 0)) * size["height"], (emitter["z"] - (0 if kind == "wall" else 0.5)) * depth))
    beam = light.get("beam")
    translucent = light.get("shade") == "translucent"
    data = bpy.data.lights.new(item["name"], "SPOT" if beam else "POINT")
    data.energy = light["lumens"] / LUMENS_PER_WATT
    data.shadow_soft_size = 0.04
    data.color = srgb_to_linear(np.array(kelvin_rgb(light["temperatureK"]))).tolist()
    obj = bpy.data.objects.new(item["name"] + " light", data)
    bpy.context.collection.objects.link(obj)
    obj.location = point(transform @ local)
    if beam:
        direction = beam["direction"]
        axis = point(transform.to_3x3() @ Vector((direction["x"], direction["y"], direction["z"])))
        obj.rotation_euler = axis.to_track_quat("-Z", "Y").to_euler()
        data.spot_size = math.radians(beam["angleDeg"])
        data.spot_blend = 0.25
    if hasattr(obj, "light_linking") and hasattr(obj.light_linking, "blocker_collection"):
        blockers = bpy.data.collections.new(item["id"] + " shadow blockers")
        bpy.context.scene.collection.children.link(blockers)
        for mesh in objects:
            if mesh.type == "MESH":
                blockers.objects.link(mesh)
                blockers.collection_objects[-1].light_linking.link_state = "EXCLUDE"
        obj.light_linking.blocker_collection = blockers
    else:
        for mesh in objects:
            mesh.visible_shadow = False
    if translucent:
        shade_anchor = bpy.data.objects.new(item["id"] + " shade coordinates", None)
        bpy.context.collection.objects.link(shade_anchor)
        shade_anchor.matrix_world = Y_UP_TO_Z_UP @ transform
        shade_radius = 0.6 * max(size["width"], depth)
        shade_direction = Vector(tuple(beam["direction"][axis] for axis in "xyz")) if beam else Vector((0, 0, 0))
        colors = []
        images = {}
        coordinates = {}
        world_to_local = (Y_UP_TO_Z_UP @ transform).inverted()
        for mesh in objects:
            if mesh.type != "MESH":
                continue
            for polygon_index in range(0, len(mesh.data.polygons), max(1, len(mesh.data.polygons) // 512)):
                polygon = mesh.data.polygons[polygon_index]
                center = world_to_local @ mesh.matrix_world @ polygon.center
                offset = center - local
                if offset.length > shade_radius or offset.dot(shade_direction) > 0:
                    continue
                material = mesh.data.materials[polygon.material_index] if polygon.material_index < len(mesh.data.materials) else None
                socket = glb_io.base_color_socket(material) if material else None
                if socket is None:
                    continue
                color = np.array(socket.default_value[:3])
                image_node = glb_io.base_color_node(material)
                if image_node and image_node.image and mesh.data.uv_layers.active:
                    image = image_node.image
                    if image.name not in images:
                        images[image.name] = glb_io.image_pixels(image)
                    key = (mesh.name, image_node.name)
                    if key not in coordinates:
                        coordinates[key] = glb_io.base_color_uvs(mesh, image_node)
                    uv = coordinates[key][polygon.loop_start]
                    color *= srgb_to_linear(glb_io.sample_texture(images[image.name], uv, glb_io.texture_wrap_modes(image_node))[:3])
                if np.mean(color) > 0.03:
                    colors.append(color)
            for slot in mesh.material_slots:
                material = slot.material
                if not material or not material.use_nodes:
                    continue
                shader = material.node_tree.nodes.get("Principled BSDF")
                if not shader:
                    continue
                material.cycles.emission_sampling = "NONE"
                base = shader.inputs["Base Color"]
                emission = shader.inputs["Emission Color"]
                if base.is_linked:
                    material.node_tree.links.new(base.links[0].from_socket, emission)
                else:
                    emission.default_value = base.default_value
                nodes, links = material.node_tree.nodes, material.node_tree.links
                coordinate = nodes.new("ShaderNodeTexCoord")
                coordinate.object = shade_anchor
                offset_node = nodes.new("ShaderNodeVectorMath")
                offset_node.operation = "SUBTRACT"
                links.new(coordinate.outputs["Object"], offset_node.inputs[0])
                offset_node.inputs[1].default_value = local
                distance = nodes.new("ShaderNodeVectorMath")
                distance.operation = "LENGTH"
                links.new(offset_node.outputs["Vector"], distance.inputs[0])
                along = nodes.new("ShaderNodeVectorMath")
                along.operation = "DOT_PRODUCT"
                links.new(offset_node.outputs["Vector"], along.inputs[0])
                along.inputs[1].default_value = shade_direction
                masks = []
                for value, low, high in [(distance.outputs["Value"], 0.8 * shade_radius, shade_radius), (along.outputs["Value"], 0.15 * shade_radius, 0.25 * shade_radius)]:
                    mask = nodes.new("ShaderNodeMapRange")
                    mask.interpolation_type = "SMOOTHERSTEP"
                    mask.clamp = True
                    links.new(value, mask.inputs["Value"])
                    mask.inputs["From Min"].default_value = low
                    mask.inputs["From Max"].default_value = high
                    mask.inputs["To Min"].default_value = 1
                    mask.inputs["To Max"].default_value = 0
                    masks.append(mask.outputs["Result"])
                region = nodes.new("ShaderNodeMath")
                region.operation = "MULTIPLY"
                for index, mask in enumerate(masks):
                    links.new(mask, region.inputs[index])
                strength = nodes.new("ShaderNodeMath")
                strength.operation = "MULTIPLY"
                links.new(region.outputs[0], strength.inputs[0])
                strength.inputs[1].default_value = light["lumens"] * 0.00175
                links.new(strength.outputs[0], shader.inputs["Emission Strength"])
        if colors:
            tint = tuple(sum(color[index] for color in colors) / len(colors) for index in range(3))
        else:
            tint = (1, 1, 1)
        if beam:
            spill = bpy.data.lights.new(item["name"] + " shade light", "POINT")
            spill.energy = data.energy * 0.5
            spill.color = tuple(data.color[index] * tint[index] for index in range(3))
            spill.shadow_soft_size = data.shadow_soft_size
            spill_obj = bpy.data.objects.new(item["name"] + " shade light", spill)
            bpy.context.collection.objects.link(spill_obj)
            spill_obj.location = obj.location.copy()
            if hasattr(obj, "light_linking") and hasattr(obj.light_linking, "blocker_collection"):
                spill_obj.light_linking.blocker_collection = obj.light_linking.blocker_collection
        else:
            data.energy *= 0.5
            data.color = tuple(data.color[index] * tint[index] for index in range(3))


def build_items(manifest, root, segments):
    room = manifest["scene"]["room"]
    assets = {asset["assetId"]: asset for asset in manifest["assets"]}
    for item in manifest["scene"]["items"]:
        if item["model"]["kind"] != "asset":
            continue
        if item["placement"]["kind"] == "wall" and item["placement"]["wallId"] in manifest["view"]["hiddenSurfaceIds"]:
            continue
        asset = assets[item["model"]["assetId"]]
        before = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=str(root / asset["modelPath"]), import_shading="NORMALS")
        imported = list(set(bpy.data.objects) - before)
        models = [obj for obj in imported if obj.type in {"MESH", "EMPTY"}]
        for obj in imported:
            if obj.type not in {"MESH", "EMPTY"}:
                bpy.data.objects.remove(obj, do_unlink=True)
        imported = models
        meta = json.loads((root / asset["metaPath"]).read_text())
        recolor_materials(imported, item.get("colorAdjust"), meta, root / asset["colorMaskPath"] if asset.get("colorMaskPath") else None)
        position, yaw, roll, depth = item_frame(item, room, segments)
        placement = Matrix.Translation(Vector(position)) @ Matrix.Rotation(yaw, 4, "Y") @ Matrix.Rotation(roll, 4, "Z") @ Matrix.Diagonal((-1 if item.get("mirrored") else 1, 1, 1, 1))
        native = meta["nativeSizeM"]
        scale = Matrix.Diagonal((item["sizeM"]["width"] / native["width"], item["sizeM"]["height"] / native["height"], depth / native["depth"], 1))
        matrix = Y_UP_TO_Z_UP @ placement @ scale @ Y_UP_TO_Z_UP.inverted()
        bpy.context.view_layer.update()
        worlds = [(obj, obj.matrix_world.copy()) for obj in imported]
        for obj, world in worlds:
            obj.parent = None
            obj.matrix_world = matrix @ world
            obj["planner_item_id"] = item["id"]
        add_light(item, placement, imported, depth)


def configure_scene(manifest):
    scene = bpy.context.scene
    evening = any(item.get("light", {}).get("on", False) for item in manifest["scene"]["items"])
    scene.render.engine = "CYCLES"
    scene.cycles.samples = manifest["output"]["samples"]
    scene.cycles.use_adaptive_sampling = False
    scene.cycles.use_denoising = True
    scene.cycles.denoiser = "OPENIMAGEDENOISE"
    scene.cycles.device = "CPU"
    try:
        preferences = bpy.context.preferences.addons["cycles"].preferences
        preferences.compute_device_type = "METAL"
        preferences.get_devices()
        available = [device for device in preferences.devices if device.type == "METAL"]
        for device in preferences.devices:
            device.use = device.type == "METAL"
        if available:
            scene.cycles.device = "GPU"
    except (TypeError, RuntimeError):
        pass
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.exposure = 2.5 if evening else -0.75
    scene.render.resolution_x = manifest["output"]["widthPx"]
    scene.render.resolution_y = manifest["output"]["heightPx"]
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGB"
    scene.world = bpy.data.worlds.new("Dim dusk" if evening else "Soft daylight")
    scene.world.use_nodes = True
    scene.world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.035, 0.055, 0.12, 1) if evening else (0.55, 0.72, 1, 1)
    scene.world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.03 if evening else 1.5
    room = manifest["scene"]["room"]
    xs = [wall["startM"]["x"] for wall in room["walls"]]
    zs = [wall["startM"]["z"] for wall in room["walls"]]
    if not evening:
        key = bpy.data.lights.new("Soft room fill", "AREA")
        key.energy = 80
        key.shape = "DISK"
        key.size = min(max(xs) - min(xs), max(zs) - min(zs)) * 0.7
        obj = bpy.data.objects.new("Soft room fill", key)
        bpy.context.collection.objects.link(obj)
        obj.location = point(((max(xs) + min(xs)) / 2 - (max(xs) - min(xs)) * 0.12, room["ceilingHeightM"] - 0.04, (max(zs) + min(zs)) / 2 + (max(zs) - min(zs)) * 0.12))
    view = manifest["view"]
    camera = bpy.data.cameras.new("Current view")
    camera.sensor_fit = "VERTICAL"
    camera.sensor_height = 24
    camera.lens = camera.sensor_height / (2 * math.tan(math.radians(view["fovDeg"]) / 2))
    camera.clip_start = 0.01
    camera.clip_end = 1000
    obj = bpy.data.objects.new("Current view", camera)
    bpy.context.collection.objects.link(obj)
    obj.location = point(tuple(view["positionM"][axis] for axis in "xyz"))
    target = point(tuple(view["targetM"][axis] for axis in "xyz"))
    obj.rotation_euler = (target - obj.location).to_track_quat("-Z", "Y").to_euler()
    scene.camera = obj
    return scene


def main():
    started = time.monotonic()
    path = Path(sys.argv[sys.argv.index("--") + 1]).resolve()
    manifest = json.loads(path.read_text())
    bpy.ops.wm.read_factory_settings(use_empty=True)
    segments = build_room(manifest, path.parent)
    build_items(manifest, path.parent, segments)
    scene = configure_scene(manifest)
    bpy.app.handlers.render_stats.append(lambda stats: print(str(stats), flush=True))
    scene.render.filepath = str(path.parent / "render.png")
    try:
        bpy.ops.render.render(write_still=True)
    except RuntimeError:
        if scene.cycles.device != "GPU":
            raise
        scene.cycles.device = "CPU"
        bpy.ops.render.render(write_still=True)
    projected_corners = []
    for wall in manifest["scene"]["room"]["walls"]:
        for height in [0, manifest["scene"]["room"]["ceilingHeightM"]]:
            projected = world_to_camera_view(scene, scene.camera, point((wall["startM"]["x"], height, wall["startM"]["z"])))
            projected_corners.append([projected.x, projected.y])
    result = {"durationSeconds": time.monotonic() - started, "peakRssBytes": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss, "device": scene.cycles.device, "projectedCorners": projected_corners, **collect_probes(manifest, scene, point), **manifest["output"]}
    (path.parent / "metrics.json").write_text(json.dumps(result, indent=2) + "\n")
    print("RESULT " + json.dumps({**result, "colourProbes": len(result["colourProbes"])}), flush=True)


if __name__ == "__main__":
    main()
