import colorsys
from pathlib import Path

import bpy
import numpy as np

import glb_io
from recolor import colorize, linear_to_srgb, parse_hex_color, srgb_to_linear


def recolor_materials(objects, adjustment, meta, mask_path):
    if not adjustment:
        return
    mask = None
    if mask_path and Path(mask_path).exists():
        mask = glb_io.image_pixels(bpy.data.images.load(str(mask_path), check_existing=False))[:, :, 0]
    materials = {slot.material for obj in objects if obj.type == "MESH" for slot in obj.material_slots if slot.material}
    changed = set()

    def adjust(rgb):
        if adjustment["kind"] == "colorize":
            return colorize(rgb, parse_hex_color(adjustment["color"]), adjustment["strength"], meta.get("referenceLuma", 0.5))
        return np.array([colorsys.hls_to_rgb((h + adjustment["hueShiftDeg"] / 360) % 1, max(0, min(1, lightness + adjustment["lightness"])), max(0, min(1, saturation + adjustment["saturation"]))) for h, lightness, saturation in [colorsys.rgb_to_hls(*pixel) for pixel in rgb]], dtype=np.float32)

    for material in materials:
        socket = glb_io.base_color_socket(material)
        node = glb_io.base_color_node(material)
        if socket is None:
            continue
        if node and node.image:
            if node.image.name in changed:
                continue
            pixels = glb_io.image_pixels(node.image)
            original = pixels[:, :, :3].reshape(-1, 3)
            result = adjust(original)
            amount = mask.reshape(-1, 1) if mask is not None else 1
            if mask is not None and mask.shape != pixels.shape[:2]:
                raise ValueError("The colour mask does not match the texture size")
            pixels[:, :, :3] = (original + (result - original) * amount).reshape(pixels.shape[0], pixels.shape[1], 3)
            glb_io.set_image_pixels(node.image, pixels)
            changed.add(node.image.name)
        elif not socket.is_linked:
            rgb = linear_to_srgb(np.array(socket.default_value[:3]))
            socket.default_value[:3] = srgb_to_linear(adjust(rgb[None, :])[0]).tolist()


def surface_material(surface_id, room, textures, root):
    surface = room["surfaces"].get(surface_id, {})
    source = surface.get("material", {"kind": "paint", "color": surface.get("color", "#F7F5EF" if surface_id == "floor" else "#FCFBF9"), "finish": "matte"})
    material = bpy.data.materials.new(surface_id)
    material.use_nodes = True
    nodes, links = material.node_tree.nodes, material.node_tree.links
    shader = nodes.get("Principled BSDF")
    color = source.get("color", source.get("baseColor", "#ffffff"))
    shader.inputs["Base Color"].default_value = (*srgb_to_linear(parse_hex_color(color)).tolist(), 1)
    shader.inputs["Roughness"].default_value = {"matte": 0.95, "eggshell": 0.65, "satin": 0.35}.get(source.get("finish"), source.get("roughness", 0.8))
    repeat = source.get("repeatSizeM", source.get("tileSizeM", source.get("plankSizeM", {"u": 1, "v": 1})))
    uv = nodes.new("ShaderNodeTexCoord")
    scale = nodes.new("ShaderNodeVectorMath")
    scale.operation = "MULTIPLY"
    scale.inputs[1].default_value = (1 / repeat["u"], 1 / repeat["v"], 1)
    links.new(uv.outputs["UV"], scale.inputs[0])
    texture = textures.get(source.get("textureAssetId"))
    if texture:
        for path_key, socket_name in [("texturePath", "Base Color"), ("roughnessPath", "Roughness"), ("normalPath", "Normal")]:
            if not texture.get(path_key):
                continue
            image = nodes.new("ShaderNodeTexImage")
            image.image = bpy.data.images.load(str(root / texture[path_key]), check_existing=True)
            image.extension = "REPEAT"
            links.new(scale.outputs["Vector"], image.inputs["Vector"])
            if path_key == "normalPath":
                image.image.colorspace_settings.name = "Non-Color"
                normal = nodes.new("ShaderNodeNormalMap")
                links.new(image.outputs["Color"], normal.inputs["Color"])
                links.new(normal.outputs["Normal"], shader.inputs[socket_name])
            else:
                if path_key == "roughnessPath":
                    image.image.colorspace_settings.name = "Non-Color"
                links.new(image.outputs["Color"], shader.inputs[socket_name])
    grout = source.get("groutWidthM", 0.001 if source["kind"] == "planks" else 0)
    if grout:
        separate = nodes.new("ShaderNodeSeparateXYZ")
        links.new(uv.outputs["UV"], separate.inputs[0])
        seams = []
        for axis, period in [("X", repeat["u"]), ("Y", repeat["v"])]:
            previous = separate.outputs[axis]
            for operation, operand in [("DIVIDE", period), ("ADD", 0.5), ("FRACT", 0), ("SUBTRACT", 0.5), ("ABSOLUTE", 0), ("MULTIPLY", period), ("LESS_THAN", grout / 2)]:
                math_node = nodes.new("ShaderNodeMath")
                math_node.operation = operation
                links.new(previous, math_node.inputs[0])
                math_node.inputs[1].default_value = operand
                previous = math_node.outputs[0]
            seams.append(previous)
        maximum = nodes.new("ShaderNodeMath")
        maximum.operation = "MAXIMUM"
        for index, seam in enumerate(seams):
            links.new(seam, maximum.inputs[index])
        mix = nodes.new("ShaderNodeMixRGB")
        links.new(maximum.outputs[0], mix.inputs[0])
        base = shader.inputs["Base Color"]
        if base.is_linked:
            links.new(base.links[0].from_socket, mix.inputs[1])
        else:
            mix.inputs[1].default_value = base.default_value
        grout_color = source.get("groutColor", color)
        factor = 0.55 if source["kind"] == "planks" else 1
        mix.inputs[2].default_value = (*[v * factor for v in srgb_to_linear(parse_hex_color(grout_color)).tolist()], 1)
        links.new(mix.outputs[0], base)
    return material
