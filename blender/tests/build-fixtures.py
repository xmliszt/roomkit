import argparse
import json
import struct
import os
import sys
from pathlib import Path

import bpy
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import glb_io


def build(output, shade, image_format='PNG', factor=None, opacity=1):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.mesh.primitive_cube_add(size=1)
    obj = bpy.context.object
    obj.name = 'fixture'
    obj.scale = (0.6, 0.5, 0.9)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    image = bpy.data.images.new('base-color', 64, 64, alpha=opacity < 1)
    pixels = np.ones((64, 64, 4), dtype=np.float32)
    gradient = np.linspace(shade * 0.8, min(1, shade * 1.2), 64)
    pixels[:, :, :3] = gradient[:, None, None]
    pixels[:, :, 3] = np.linspace(opacity * 0.8, opacity * 1.2, 64)[:, None] if opacity < 1 else 1
    glb_io.set_image_pixels(image, pixels)
    image.file_format = image_format
    material = bpy.data.materials.new('fixture')
    texture = material.node_tree.nodes.new('ShaderNodeTexImage')
    texture.image = image
    shader = next(node for node in material.node_tree.nodes if node.type == 'BSDF_PRINCIPLED')
    material.node_tree.links.new(texture.outputs['Color'], shader.inputs['Base Color'])
    if opacity < 1:
        material.node_tree.links.new(texture.outputs['Alpha'], shader.inputs['Alpha'])
    obj.data.materials.append(material)
    glb_io.export_glb(str(output), image_format="JPEG" if image_format == "JPEG" else "AUTO")
    if factor:
        document, binary = glb_io.read_glb(output)
        document['materials'][0]['pbrMetallicRoughness']['baseColorFactor'] = list(factor)
        glb_io.write_glb(output, document, binary)


parser = argparse.ArgumentParser()
parser.add_argument('--output', required=True)
args = parser.parse_args(glb_io.script_args())
output = Path(args.output)
output.mkdir(parents=True, exist_ok=True)
for name, shade in [('white', 0.9), ('black', 0.05), ('grey', 0.5)]:
    build(output / f'{name}.glb', shade)
build(output / 'factor.glb', 0.9, factor=(0.4, 0.6, 0.8, 1))
build(output / 'mixed-jpeg.glb', 0.5, image_format='JPEG')
glb_io.open_glb(str(output / 'grey.glb'))
obj = bpy.context.object
obj.shape_key_add(name='Basis')
key = obj.shape_key_add(name='Morph')
key.data[0].co.x += 0.1
glb_io.export_glb(str(output / 'morph.glb'))
glb_io.open_glb(str(output / 'grey.glb'))
obj = next(iter(glb_io.mesh_objects()))
bpy.ops.object.armature_add()
armature = bpy.context.object
modifier = obj.modifiers.new('skin', 'ARMATURE')
modifier.object = armature
group = obj.vertex_groups.new(name='Bone')
group.add(list(range(len(obj.data.vertices))), 1, 'REPLACE')
glb_io.export_glb(str(output / 'skinned.glb'))
glb_io.open_glb(str(output / 'grey.glb'))
obj = next(iter(glb_io.mesh_objects()))
bpy.context.view_layer.objects.active = obj
modifier = obj.modifiers.new('dense', 'SUBSURF')
modifier.subdivision_type = 'SIMPLE'
modifier.levels = 7
bpy.ops.object.modifier_apply(modifier=modifier.name)
glb_io.export_glb(str(output / 'dense.glb'))

build(output / 'jpeg-alpha.glb', 0.5, image_format='JPEG', factor=(1, 1, 1, 0.4))
document, binary = glb_io.read_glb(output / 'jpeg-alpha.glb')
document['materials'][0]['alphaMode'] = 'BLEND'
glb_io.write_glb(output / 'jpeg-alpha.glb', document, binary)
build(output / 'png-alpha.glb', 0.5, factor=(0.4, 0.6, 0.8, 0.4))
document, binary = glb_io.read_glb(output / 'png-alpha.glb')
document['materials'][0]['alphaMode'] = 'BLEND'
glb_io.write_glb(output / 'png-alpha.glb', document, binary)
build(output / 'rgba-alpha.glb', 0.5, opacity=0.4)
document, binary = glb_io.read_glb(output / 'rgba-alpha.glb')
document['materials'][0]['alphaMode'] = 'BLEND'
glb_io.write_glb(output / 'rgba-alpha.glb', document, binary)
for name in ['multi', 'default']:
    glb_io.open_glb(str(output / 'grey.glb'))
    first = glb_io.mesh_objects()[0]
    first.scale.x = 0.5
    first.location.x = -0.15
    second = first.copy()
    second.data = first.data.copy()
    second.location.x = 0.15
    bpy.context.scene.collection.objects.link(second)
    second.data.materials.clear()
    if name == 'multi':
        image = bpy.data.images.new('red-texture', 64, 64)
        pixels = np.ones((64, 64, 4), dtype=np.float32)
        pixels[:, :, :3] = [0.8, 0.2, 0.15]
        pixels[:, :, 0] = np.linspace(0.5, 1, 64)[None, :]
        glb_io.set_image_pixels(image, pixels)
        material = bpy.data.materials.new('red')
        texture = material.node_tree.nodes.new('ShaderNodeTexImage')
        texture.image = image
        shader = next(node for node in material.node_tree.nodes if node.type == 'BSDF_PRINCIPLED')
        material.node_tree.links.new(texture.outputs['Color'], shader.inputs['Base Color'])
        second.data.materials.append(material)
    for obj in [first, second]:
        mesh = obj.data
        coordinates = np.array([vertex.co for vertex in mesh.vertices])
        low, high = coordinates.min(axis=0), coordinates.max(axis=0)
        for polygon in mesh.polygons:
            axes = [axis for axis in range(3) if axis != int(np.argmax(np.abs(polygon.normal)))]
            for loop in polygon.loop_indices:
                coordinate = coordinates[mesh.loops[loop].vertex_index]
                uv = ((coordinate - low) / (high - low))[axes]
                mesh.uv_layers.active.data[loop].uv = uv * 2
    glb_io.export_glb(str(output / f'{name}.glb'))


def project_gradient_uvs():
    bpy.context.view_layer.update()
    for obj in glb_io.mesh_objects():
        mesh = obj.data
        coordinates = np.empty(len(mesh.vertices) * 3, dtype=np.float32)
        mesh.vertices.foreach_get('co', coordinates)
        world = np.array(obj.matrix_world)
        coordinates = coordinates.reshape(-1, 3) @ world[:3, :3].T + world[:3, 3]
        indices = np.empty(len(mesh.loops), dtype=np.int32)
        mesh.loops.foreach_get('vertex_index', indices)
        uv = np.column_stack((coordinates[indices, 0] / 0.6 + 0.5, coordinates[indices, 2] / 0.9 + 0.5))
        mesh.uv_layers.active.data.foreach_set('uv', uv.astype(np.float32).ravel())


def gradient_images():
    for image in glb_io.base_color_images():
        pixels = glb_io.image_pixels(image)
        pixels[:, :, 0] = np.linspace(0.1, 0.9, image.size[0])[None, :]
        pixels[:, :, 1] = np.linspace(0.2, 0.8, image.size[1])[:, None]
        pixels[:, :, 2] = 0.25
        glb_io.set_image_pixels(image, pixels)


glb_io.open_glb(str(output / 'grey.glb'))
image = glb_io.base_color_images()[0]
pixels = glb_io.image_pixels(image)
pixels[:, :, :3] = 0.5
pixels[:16, :, :3] = 0.05
glb_io.set_image_pixels(image, pixels)
body = glb_io.mesh_objects()[0]
plinth = body.copy()
plinth.data = body.data.copy()
bpy.context.collection.objects.link(plinth)
for obj, (bottom, top), (low, high) in [(body, (-0.25, 0.45), (16 / 64, 1)), (plinth, (-0.45, -0.25), (0, 16 / 64))]:
    for vertex in obj.data.vertices:
        vertex.co.z = bottom if vertex.co.z < 0 else top
    for polygon in obj.data.polygons:
        corners = [(0, low), (1, low), (1, high), (0, high)]
        if len(polygon.loop_indices) == 3:
            corners = corners[:3] if polygon.index % 2 == 0 else [corners[0], corners[2], corners[3]]
        for loop, uv in zip(polygon.loop_indices, corners):
            obj.data.uv_layers.active.data[loop].uv = uv
glb_io.export_glb(str(output / 'neutral.glb'))

glb_io.open_glb(str(output / 'grey.glb'))
obj = glb_io.mesh_objects()[0]
material = obj.data.materials[0]
shader = next(node for node in material.node_tree.nodes if node.type == 'BSDF_PRINCIPLED')
attribute = obj.data.color_attributes.new(name='Color', type='FLOAT_COLOR', domain='CORNER')
for loop in obj.data.loops:
    z = obj.data.vertices[loop.vertex_index].co.z
    attribute.data[loop.index].color = (0.2 + 0.6 * (z / 0.9 + 0.5), 0.1, 0.05, 1)
vertex = material.node_tree.nodes.new('ShaderNodeVertexColor')
vertex.layer_name = 'Color'
material.node_tree.links.new(vertex.outputs['Color'], shader.inputs['Base Color'])
glb_io.export_glb(str(output / 'vertex.glb'))
document, binary = glb_io.read_glb(output / 'vertex.glb')
assert 'COLOR_0' in document['meshes'][0]['primitives'][0]['attributes']
document['materials'][0]['pbrMetallicRoughness']['baseColorFactor'] = [0.4, 0.6, 0.8, 1]
glb_io.write_glb(output / 'vertex.glb', document, binary)

for name in ['multi-jpeg', 'mixed-formats']:
    glb_io.open_glb(str(output / 'multi.glb'))
    images = glb_io.base_color_images()
    for image in images if name == 'multi-jpeg' else images[:1]:
        pixels = glb_io.image_pixels(image)
        image.file_format = 'JPEG'
        glb_io.set_image_pixels(image, pixels)
    glb_io.export_glb(str(output / f'{name}.glb'))
    document, _ = glb_io.read_glb(output / f'{name}.glb')
    expected = {'image/jpeg'} if name == 'multi-jpeg' else {'image/jpeg', 'image/png'}
    assert {image['mimeType'] for image in document['images']} == expected

for name in ['unlit', 'unlit-textured']:
    document, binary = glb_io.read_glb(output / 'grey.glb')
    document['materials'][0].setdefault('extensions', {})['KHR_materials_unlit'] = {}
    document.setdefault('extensionsUsed', []).append('KHR_materials_unlit')
    if name == 'unlit':
        del document['materials'][0]['pbrMetallicRoughness']['baseColorTexture']
        document['materials'][0]['pbrMetallicRoughness']['baseColorFactor'] = [0.2, 0.4, 0.6, 1]
    glb_io.write_glb(output / f'{name}.glb', document, binary)

for name in ['mirror', 'mirror-atlas', 'mixed-wrap', 'dense-uv']:
    glb_io.open_glb(str(output / ('multi.glb' if name == 'mirror-atlas' else 'grey.glb')))
    gradient_images()
    project_gradient_uvs()
    if name != 'dense-uv':
        for obj in glb_io.mesh_objects():
            for loop in obj.data.uv_layers.active.data:
                loop.uv = np.array(loop.uv) * 2.5 - 0.25
    if name == 'dense-uv':
        obj = glb_io.mesh_objects()[0]
        bpy.context.view_layer.objects.active = obj
        modifier = obj.modifiers.new('dense', 'SUBSURF')
        modifier.subdivision_type = 'SIMPLE'
        modifier.uv_smooth = 'NONE'
        modifier.levels = 7
        bpy.ops.object.modifier_apply(modifier=modifier.name)
        project_gradient_uvs()
    glb_io.export_glb(str(output / f'{name}.glb'))
    if name != 'dense-uv':
        document, binary = glb_io.read_glb(output / f'{name}.glb')
        for sampler in document['samplers']:
            sampler['wrapS'] = 33648
            sampler['wrapT'] = 33071 if name == 'mixed-wrap' else 33648
        glb_io.write_glb(output / f'{name}.glb', document, binary)

document, binary = glb_io.read_glb(output / 'grey.glb')
view = document['bufferViews'][document['images'][0]['bufferView']]
start = view.get('byteOffset', 0)
(output / 'external texture.png').write_bytes(binary[start:start + view['byteLength']])
document['images'][0] = {'uri': 'external%20texture.png'}
glb_io.write_glb(output / 'external.glb', document, binary)


glb_io.open_glb(str(output / 'vertex.glb'))
project_gradient_uvs()
obj = glb_io.mesh_objects()[0]
material = obj.data.materials[0]
normal_image = bpy.data.images.new('normal-map', 64, 64)
normal_image.colorspace_settings.name = 'Non-Color'
normal_pixels = np.ones((64, 64, 4), dtype=np.float32)
normal_pixels[:, :, :3] = [0.5, 0.5, 1]
normal_pixels[:, :, 0] = np.linspace(0.4, 0.6, 64)[None, :]
glb_io.set_image_pixels(normal_image, normal_pixels)
texture = material.node_tree.nodes.new('ShaderNodeTexImage')
texture.image = normal_image
normal = material.node_tree.nodes.new('ShaderNodeNormalMap')
material.node_tree.links.new(texture.outputs['Color'], normal.inputs['Color'])
shader = next(node for node in material.node_tree.nodes if node.type == 'BSDF_PRINCIPLED')
material.node_tree.links.new(normal.outputs['Normal'], shader.inputs['Normal'])
glb_io.export_glb(str(output / 'vertex-normal.glb'))

glb_io.open_glb(str(output / 'multi.glb'))
for obj in glb_io.mesh_objects():
    material = obj.data.materials[0]
    node = glb_io.base_color_node(material)
    pixels = glb_io.image_pixels(node.image)
    pixels[:, :, 3] = np.linspace(0.1, 0.9, 64)[:, None]
    image = bpy.data.images.new(material.name + '-alpha', 64, 64, alpha=True)
    glb_io.set_image_pixels(image, pixels)
    node.image = image
    shader = next(node for node in material.node_tree.nodes if node.type == 'BSDF_PRINCIPLED')
    material.node_tree.links.new(node.outputs['Alpha'], shader.inputs['Alpha'])
glb_io.export_glb(str(output / 'multi-alpha.glb'))
document, binary = glb_io.read_glb(output / 'multi-alpha.glb')
for material in document['materials']:
    material['alphaMode'] = 'BLEND'
    material['pbrMetallicRoughness']['baseColorFactor'] = [1, 1, 1, 0.6 if material['name'] == 'fixture' else 0.8]
glb_io.write_glb(output / 'multi-alpha.glb', document, binary)

document, binary = glb_io.read_glb(output / 'grey.glb')
(output / 'external geometry.bin').write_bytes(binary)
document['buffers'][0]['uri'] = 'external%20geometry.bin'
encoded = json.dumps(document).encode()
encoded += b' ' * (-len(encoded) % 4)
(output / 'external-buffer.glb').write_bytes(struct.pack('<IIIII', 0x46546C67, 2, 20 + len(encoded),
                                                      len(encoded), 0x4E4F534A) + encoded)
for name, image_format, alpha in [('oversized', 'PNG', False), ('oversized-alpha', 'PNG', True), ('oversized-jpeg', 'JPEG', False), ('oversized-atlas', 'PNG', False)]:
    glb_io.open_glb(str(output / ('multi.glb' if name == 'oversized-atlas' else 'grey.glb')))
    for index, original in enumerate(glb_io.base_color_images()):
        width, height = (1024, 4096) if alpha else (4096, 1024)
        image = bpy.data.images.new(f'large-{index}', width, height, alpha=alpha)
        pixels = np.ones((height, width, 4), dtype=np.float32)
        pixels[:, :, 0] = np.linspace(0.2, 0.8, width)[None, :]
        pixels[:, :, 1] = 0.4
        pixels[:, :, 2] = 0.6
        if alpha:
            pixels[:, :, 3] = np.linspace(0.2, 0.8, height)[:, None]
        image.file_format = image_format
        glb_io.set_image_pixels(image, pixels)
        for obj in glb_io.mesh_objects():
            for material in obj.data.materials:
                node = glb_io.base_color_node(material)
                if node.image == original:
                    node.image = image
                    if alpha:
                        shader = next(node for node in material.node_tree.nodes if node.type == 'BSDF_PRINCIPLED')
                        material.node_tree.links.new(node.outputs['Alpha'], shader.inputs['Alpha'])
    glb_io.export_glb(str(output / f'{name}.glb'), image_format='JPEG' if image_format == 'JPEG' else 'AUTO')

glb_io.open_glb(str(output / 'grey.glb'))
material = glb_io.mesh_objects()[0].data.materials[0]
image = bpy.data.images.new('oversized-normal', 4096, 1024)
image.colorspace_settings.name = 'Non-Color'
pixels = np.ones((1024, 4096, 4), dtype=np.float32)
pixels[:, :, 0] = np.linspace(0.3, 0.7, 4096)[None, :]
pixels[:, :, 1] = 0.5
pixels[:, :, 2] = 0.9
glb_io.set_image_pixels(image, pixels)
texture = material.node_tree.nodes.new('ShaderNodeTexImage')
texture.image = image
normal = material.node_tree.nodes.new('ShaderNodeNormalMap')
material.node_tree.links.new(texture.outputs['Color'], normal.inputs['Color'])
shader = next(node for node in material.node_tree.nodes if node.type == 'BSDF_PRINCIPLED')
material.node_tree.links.new(normal.outputs['Normal'], shader.inputs['Normal'])
glb_io.export_glb(str(output / 'oversized-normal.glb'))

glb_io.print_result({'fixtures': str(output)})
