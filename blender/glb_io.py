import json
import sys

import bpy
import numpy as np
from mathutils import Matrix, Vector


def script_args():
    return sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []


def open_glb(path):
    """Replace the current scene with the contents of the GLB at `path`."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=path)


def mesh_objects():
    return [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]


def bake_world_transforms():
    """Move every mesh object's world transform into its vertex data, clear parents, and delete non-mesh objects."""
    bpy.context.view_layer.update()
    meshes = mesh_objects()
    world_matrices = [obj.matrix_world.copy() for obj in meshes]
    for obj, world in zip(meshes, world_matrices):
        if obj.data.users > 1:
            obj.data = obj.data.copy()
        obj.parent = None
        obj.data.transform(world)
        if world.determinant() < 0:
            obj.data.flip_normals()
        obj.matrix_world = Matrix.Identity(4)
    for obj in [obj for obj in bpy.context.scene.objects if obj.type != "MESH"]:
        bpy.data.objects.remove(obj)


def transform_meshes(matrix):
    for obj in mesh_objects():
        obj.data.transform(matrix)


def mesh_bounds():
    """Return `(min, max)` corners of the box around all mesh vertices, in world space."""
    corners = []
    for obj in mesh_objects():
        coords = np.empty(len(obj.data.vertices) * 3, dtype=np.float32)
        obj.data.vertices.foreach_get("co", coords)
        coords = coords.reshape(-1, 3)
        world = np.array(obj.matrix_world)
        coords = coords @ world[:3, :3].T + world[:3, 3]
        corners.append(coords.min(axis=0))
        corners.append(coords.max(axis=0))
    if not corners:
        raise ValueError("the GLB has no mesh")
    stacked = np.stack(corners)
    return Vector(stacked.min(axis=0).tolist()), Vector(stacked.max(axis=0).tolist())


def triangle_count():
    total = 0
    for obj in mesh_objects():
        obj.data.calc_loop_triangles()
        total += len(obj.data.loop_triangles)
    return total


def export_glb(path, image_format="AUTO"):
    """Write the scene to `path` as a +Y up GLB without cameras, lights or animation, with textures in `image_format`."""
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        export_image_format=image_format,
        export_yup=True,
        export_cameras=False,
        export_lights=False,
        export_animations=False,
    )


def print_result(result):
    """Print `result` as one `RESULT <json>` line for the caller to parse."""
    print("RESULT " + json.dumps(result), flush=True)


def read_glb(path):
    import struct
    from pathlib import Path

    data = Path(path).read_bytes()
    json_size = struct.unpack_from('<I', data, 12)[0]
    document = json.loads(data[20:20 + json_size])
    offset = 20 + json_size
    binary = data[offset + 8:] if offset < len(data) else b''
    return document, binary


def write_glb(path, document, binary):
    import struct
    from pathlib import Path

    document['buffers'][0]['byteLength'] = len(binary)
    encoded_json = json.dumps(document).encode()
    encoded_json += b' ' * (-len(encoded_json) % 4)
    binary += b'\0' * (-len(binary) % 4)
    output = struct.pack('<III', 0x46546C67, 2, 28 + len(encoded_json) + len(binary))
    output += struct.pack('<II', len(encoded_json), 0x4E4F534A) + encoded_json
    output += struct.pack('<II', len(binary), 0x004E4942) + binary
    Path(path).write_bytes(output)


def image_pixels(image):
    pixels = np.empty(image.size[0] * image.size[1] * 4, dtype=np.float32)
    image.pixels.foreach_get(pixels)
    return pixels.reshape(image.size[1], image.size[0], 4)


def set_image_pixels(image, pixels):
    image_format = image.file_format
    image.pixels.foreach_set(np.asarray(pixels, dtype=np.float32).ravel())
    image.update()
    if image_format == 'JPEG':
        import tempfile
        from pathlib import Path

        with tempfile.TemporaryDirectory() as directory:
            image.filepath_raw = str(Path(directory) / 'image.jpg')
            image.file_format = 'JPEG'
            image.save()
            if image.packed_file is not None:
                image.unpack(method='REMOVE')
            image.source = 'FILE'
            image.reload()
            image.pack()
    else:
        image.pack()


def base_color_socket(material):
    if material is None or material.node_tree is None:
        return None
    for node in material.node_tree.nodes:
        if node.type == 'BSDF_PRINCIPLED':
            return node.inputs['Base Color']
        if node.type == 'EMISSION':
            return node.inputs['Color']
    return None


def base_alpha_socket(material):
    for node in material.node_tree.nodes:
        if node.type == 'BSDF_PRINCIPLED':
            return node.inputs['Alpha']
    output = next(node for node in material.node_tree.nodes if node.type == 'OUTPUT_MATERIAL')
    if output.inputs['Surface'].is_linked:
        node = output.inputs['Surface'].links[0].from_node
        if node.type == 'MIX_SHADER':
            factor = node.inputs[0]
            if not factor.is_linked or factor.links[0].from_node.type != 'LIGHT_PATH':
                return factor
    return None


def base_color_node(material):
    socket = base_color_socket(material)
    pending = [link.from_node for link in socket.links] if socket else []
    seen = set()
    while pending:
        node = pending.pop()
        if node.name in seen:
            continue
        seen.add(node.name)
        if node.type == 'TEX_IMAGE' and node.image is not None:
            return node
        pending.extend(link.from_node for socket in node.inputs for link in socket.links)
    return None


def base_color_images():
    return list({node.image.name: node.image for obj in mesh_objects()
                 for material in obj.data.materials
                 if (node := base_color_node(material)) is not None}.values())


def constant_alpha(socket):
    if not socket.is_linked:
        return socket.default_value
    node = socket.links[0].from_node
    if node.type == 'TEX_IMAGE' and socket.links[0].from_socket.name == 'Alpha' and node.image.file_format == 'JPEG':
        return 1.0
    if node.type == 'MATH' and node.operation == 'MULTIPLY':
        left = constant_alpha(node.inputs[0])
        right = constant_alpha(node.inputs[1])
        if left is not None and right is not None:
            return left * right
    return None


def open_static_glb(path):
    import base64
    import os
    import tempfile
    from pathlib import Path

    document, binary = read_glb(path)
    if document.get('skins') or any('skin' in node for node in document.get('nodes', [])):
        raise ValueError('skinned meshes are not supported')
    if any(primitive.get('targets') for mesh in document.get('meshes', [])
           for primitive in mesh.get('primitives', [])):
        raise ValueError('morph targets are not supported')
    with tempfile.TemporaryDirectory() as directory:
        for index, buffer in enumerate(document.get('buffers', [])):
            if 'uri' not in buffer:
                continue
            uri = buffer['uri']
            if uri.startswith('data:'):
                encoded = base64.b64decode(uri.split(',', 1)[1])
            else:
                from urllib.parse import unquote
                encoded = (Path(path).resolve().parent / unquote(uri)).read_bytes()
            binary += b'\0' * (-len(binary) % 4)
            offset = len(binary)
            for view in document.get('bufferViews', []):
                if view.get('buffer', 0) == index:
                    view['buffer'] = 0
                    view['byteOffset'] = view.get('byteOffset', 0) + offset
            binary += encoded
        document['buffers'] = [{'byteLength': len(binary)}]
        for image in document.get('images', []):
            if 'uri' not in image:
                continue
            uri = image.pop('uri')
            if uri.startswith('data:'):
                encoded = base64.b64decode(uri.split(',', 1)[1])
            else:
                from urllib.parse import unquote
                encoded = (Path(path).resolve().parent / unquote(uri)).read_bytes()
            binary += b'\0' * (-len(binary) % 4)
            image['bufferView'] = len(document.setdefault('bufferViews', []))
            image['mimeType'] = 'image/jpeg' if encoded.startswith(b'\xff\xd8') else 'image/png'
            document['bufferViews'].append({'buffer': 0, 'byteOffset': len(binary), 'byteLength': len(encoded)})
            binary += encoded
        for material in document.get('materials', []):
            pbr = material.get('pbrMetallicRoughness', {})
            factor = pbr.get('baseColorFactor', [1, 1, 1, 1])
            texture = pbr.get('baseColorTexture')
            if texture is None or factor == [1, 1, 1, 1]:
                continue
            source = document['textures'][texture['index']]
            image_spec = document['images'][source['source']]
            suffix = '.jpg' if image_spec.get('mimeType') == 'image/jpeg' else '.png'
            if factor[:3] == [1, 1, 1]:
                continue
            image_path = os.path.join(directory, f'{len(document["images"])}{suffix}')
            if 'bufferView' in image_spec:
                view = document['bufferViews'][image_spec['bufferView']]
                start = view.get('byteOffset', 0)
                image_data = binary[start:start + view['byteLength']]
            elif image_spec['uri'].startswith('data:'):
                image_data = base64.b64decode(image_spec['uri'].split(',', 1)[1])
            else:
                image_data = (Path(path).parent / image_spec['uri']).read_bytes()
            Path(image_path).write_bytes(image_data)
            image = bpy.data.images.load(image_path, check_existing=False)
            image.alpha_mode = 'CHANNEL_PACKED'
            pixels = image_pixels(image)
            rgb = pixels[:, :, :3]
            linear = np.where(rgb <= 0.04045, rgb / 12.92, ((rgb + 0.055) / 1.055) ** 2.4)
            linear *= np.array(factor[:3])
            pixels[:, :, :3] = np.where(linear <= 0.0031308, linear * 12.92,
                                       1.055 * linear ** (1 / 2.4) - 0.055)
            set_image_pixels(image, pixels)
            image.filepath_raw = image_path
            image.file_format = 'JPEG' if suffix == '.jpg' else 'PNG'
            image.save()
            encoded = Path(image_path).read_bytes()
            binary += b'\0' * (-len(binary) % 4)
            view_index = len(document['bufferViews'])
            document['bufferViews'].append({'buffer': 0, 'byteOffset': len(binary), 'byteLength': len(encoded)})
            binary += encoded
            image_index = len(document['images'])
            document['images'].append({'bufferView': view_index, 'mimeType': 'image/jpeg' if suffix == '.jpg' else 'image/png'})
            texture_index = len(document['textures'])
            document['textures'].append({**source, 'source': image_index})
            texture['index'] = texture_index
            pbr['baseColorFactor'] = [1, 1, 1, factor[3]]
        temporary = os.path.join(directory, 'baked.glb')
        write_glb(temporary, document, binary)
        open_glb(temporary)
        for index, spec in enumerate(document.get('images', [])):
            image = bpy.data.images.get(spec.get('name') or f'Image_{index}')
            if image is not None and image.has_data:
                image.file_format = 'JPEG' if spec.get('mimeType') == 'image/jpeg' else 'PNG'
                image.pack()

        for material in bpy.data.materials:
            if material.node_tree is None:
                continue
            for shader in material.node_tree.nodes:
                if shader.type != 'BSDF_PRINCIPLED':
                    continue
                alpha = shader.inputs['Alpha']
                value = constant_alpha(alpha)
                if value is not None and alpha.is_linked:
                    for link in list(alpha.links):
                        material.node_tree.links.remove(link)
                    alpha.default_value = value


def texture_wrap_modes(node):
    if node is None:
        return ('REPEAT', 'REPEAT')
    links = node.inputs['Vector'].links
    if links and links[0].from_node.type == 'COMBXYZ':
        combine = links[0].from_node
        modes = []
        for socket in list(combine.inputs)[:2]:
            source = socket.links[0].from_node if socket.is_linked else None
            mode = {'WRAP': 'REPEAT', 'PINGPONG': 'MIRROR'}.get(source.operation, 'EXTEND') if source and source.type == 'MATH' else 'EXTEND'
            modes.append(mode)
        return tuple(modes)
    return (node.extension, node.extension)


def sample_texture(pixels, uv, modes):
    coordinates = np.asarray(uv).copy()
    for axis, mode in enumerate(modes):
        values = coordinates[..., axis]
        if mode == 'REPEAT':
            values = values % 1
        elif mode == 'MIRROR':
            values = 1 - np.abs(values % 2 - 1)
        coordinates[..., axis] = np.clip(values, 0, 1 - np.finfo(np.float32).eps)
    x = np.minimum((coordinates[..., 0] * pixels.shape[1]).astype(int), pixels.shape[1] - 1)
    y = np.minimum((coordinates[..., 1] * pixels.shape[0]).astype(int), pixels.shape[0] - 1)
    return pixels[y, x]


def base_color_uvs(obj, node):
    mesh = obj.data
    active = next((layer for layer in mesh.uv_layers if layer.active_render), mesh.uv_layers.active)
    original = np.array([loop.uv for loop in active.data]) if active else np.full((len(mesh.loops), 2), 0.5)
    if node is None:
        return original

    def coordinates(socket):
        if not socket.is_linked:
            return original
        link = socket.links[0]
        source = link.from_node
        if source.type == 'UVMAP':
            layer = mesh.uv_layers.get(source.uv_map) or active
            return np.array([loop.uv for loop in layer.data]) if layer else original
        if source.type == 'TEX_COORD' and link.from_socket.name == 'UV':
            return original
        if source.type == 'COMBXYZ':
            pending = [link.from_node for socket in source.inputs for link in socket.links]
            while pending:
                upstream = pending.pop()
                if upstream.type == 'SEPXYZ':
                    return coordinates(upstream.inputs[0])
                pending.extend(link.from_node for socket in upstream.inputs for link in socket.links)
            raise ValueError('wrapping nodes have no UV input')
        if source.type == 'MAPPING':
            from mathutils import Euler

            values = coordinates(source.inputs['Vector'])
            scale = np.array(source.inputs['Scale'].default_value)
            location = np.array(source.inputs['Location'].default_value)
            rotation = np.array(Euler(source.inputs['Rotation'].default_value).to_matrix())
            values = np.column_stack((values, np.zeros(len(values))))
            if source.vector_type == 'TEXTURE':
                values = ((values - location) @ rotation) / scale
            else:
                values = (values * scale) @ rotation.T + location
            return values[:, :2]
        raise ValueError(f'unsupported base colour UV node: {source.type}')

    return coordinates(node.inputs['Vector'])


def bake_vertex_colors():
    import bmesh
    import math

    objects = mesh_objects()
    if not any(obj.data.color_attributes for obj in objects):
        return
    if not any(node.type in ('VERTEX_COLOR', 'ATTRIBUTE') for obj in objects
               for material in obj.data.materials for node in material.node_tree.nodes):
        return
    materials = list({material.name: material for obj in objects for material in obj.data.materials}.values())
    original_uvs = {}
    for obj in objects:
        render_uv = next((layer for layer in obj.data.uv_layers if layer.active_render), obj.data.uv_layers.active)
        original_uvs[obj.name] = (obj.data.uv_layers.active_index, render_uv.name if render_uv else None)
        for material in obj.data.materials:
            for node in list(material.node_tree.nodes):
                if node.type == 'TEX_IMAGE' and not node.inputs['Vector'].is_linked and render_uv:
                    uv = material.node_tree.nodes.new('ShaderNodeUVMap')
                    uv.uv_map = render_uv.name
                    material.node_tree.links.new(uv.outputs['UV'], node.inputs['Vector'])
                if node.type == 'NORMAL_MAP' and not node.uv_map and render_uv:
                    node.uv_map = render_uv.name
        mesh = bmesh.new()
        mesh.from_mesh(obj.data)
        bmesh.ops.triangulate(mesh, faces=list(mesh.faces))
        mesh.to_mesh(obj.data)
        mesh.free()
    triangle_total = sum(len(obj.data.polygons) for obj in objects)
    columns = math.ceil(math.sqrt(triangle_total))
    cell_size = max(4, min(64, 2048 // columns))
    size = columns * cell_size
    layer_name = 'VertexColorBake'
    while any(obj.data.uv_layers.get(layer_name) for obj in objects):
        layer_name += '_1'
    index = 0
    for obj in objects:
        layer = obj.data.uv_layers.new(name=layer_name)
        layer.active_render = True
        obj.data.uv_layers.active_index = len(obj.data.uv_layers) - 1
        for polygon in obj.data.polygons:
            x, y = index % columns * cell_size, index // columns * cell_size
            corners = [(x + 1.5, y + 1.5), (x + cell_size - 1.5, y + 1.5), (x + 1.5, y + cell_size - 1.5)]
            for loop, uv in zip(polygon.loop_indices, corners):
                layer.data[loop].uv = np.array(uv) / size
            index += 1
    target = bpy.data.images.new('vertex-bake-linear', size, size, alpha=True, float_buffer=True)
    sources = []
    for material in materials:
        tree = material.node_tree
        color = base_color_socket(material)
        alpha = base_alpha_socket(material)
        output = next(node for node in tree.nodes if node.type == 'OUTPUT_MATERIAL')
        original = output.inputs['Surface'].links[0].from_socket
        emission = tree.nodes.new('ShaderNodeEmission')
        tree.links.new(emission.outputs[0], output.inputs['Surface'])
        texture = tree.nodes.new('ShaderNodeTexImage')
        texture.image = target
        tree.nodes.active = texture
        sources.append((material, color, alpha, output, original, emission, texture))
    previous_engine = bpy.context.scene.render.engine
    bpy.context.scene.render.engine = 'CYCLES'
    bpy.context.scene.cycles.samples = 1
    bpy.context.scene.cycles.device = 'CPU'
    bpy.ops.object.select_all(action='DESELECT')
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    baked = []
    try:
        for channel in ('color', 'alpha'):
            for material, color, alpha, output, original, emission, texture in sources:
                socket = color if channel == 'color' else alpha
                destination = emission.inputs['Color']
                for link in list(destination.links):
                    material.node_tree.links.remove(link)
                if socket is not None and socket.is_linked:
                    material.node_tree.links.new(socket.links[0].from_socket, destination)
                else:
                    value = socket.default_value if socket is not None else 1
                    destination.default_value = tuple(value) if channel == 'color' else (value, value, value, 1)
            bpy.ops.object.bake(type='EMIT', use_clear=False, margin=1)
            baked.append(image_pixels(target))
    finally:
        for material, color, alpha, output, original, emission, texture in sources:
            material.node_tree.links.new(original, output.inputs['Surface'])
            material.node_tree.nodes.remove(emission)
            material.node_tree.nodes.remove(texture)
        bpy.context.scene.render.engine = previous_engine
    pixels = baked[0]
    linear = np.maximum(pixels[:, :, :3], 0)
    pixels[:, :, :3] = np.where(linear <= 0.0031308, linear * 12.92, 1.055 * linear ** (1 / 2.4) - 0.055)
    pixels[:, :, 3] = baked[1][:, :, 0]
    atlas = bpy.data.images.new('vertex-color-atlas', size, size, alpha=True)
    set_image_pixels(atlas, pixels)
    for material, color, alpha, output, original, emission, texture in sources:
        tree = material.node_tree
        texture = tree.nodes.new('ShaderNodeTexImage')
        texture.image = atlas
        uv = tree.nodes.new('ShaderNodeUVMap')
        uv.uv_map = layer_name
        tree.links.new(uv.outputs['UV'], texture.inputs['Vector'])
        tree.links.new(texture.outputs['Color'], color)
        if alpha is not None:
            tree.links.new(texture.outputs['Alpha'], alpha)
    for obj in objects:
        active_index, render_name = original_uvs[obj.name]
        if render_name is not None:
            obj.data.uv_layers.active_index = active_index
            obj.data.uv_layers[render_name].active_render = True
        for attribute in list(obj.data.color_attributes):
            obj.data.color_attributes.remove(attribute)
    bpy.data.images.remove(target)


def base_color_atlas():
    default = None
    for obj in mesh_objects():
        if not obj.data.materials or any(material is None for material in obj.data.materials):
            if default is None:
                default = bpy.data.materials.new('default-material')
                shader = next(node for node in default.node_tree.nodes if node.type == 'BSDF_PRINCIPLED')
                shader.inputs['Base Color'].default_value = (1, 1, 1, 1)
                shader.inputs['Metallic'].default_value = 1
                shader.inputs['Roughness'].default_value = 1
            if not obj.data.materials:
                obj.data.materials.append(default)
            for index, material in enumerate(obj.data.materials):
                if material is None:
                    obj.data.materials[index] = default
    bake_vertex_colors()
    materials = list({material.name: material for obj in mesh_objects()
                      for material in obj.data.materials}.values())
    images = base_color_images()
    if len(images) == 1 and all(base_color_node(material) is not None for material in materials):
        return images[0]
    object_uvs = {}
    material_uvs = {material.name: [] for material in materials}
    for obj in mesh_objects():
        object_uvs[obj.name] = {}
        for material in obj.data.materials:
            object_uvs[obj.name][material.name] = base_color_uvs(obj, base_color_node(material))
        for polygon in obj.data.polygons:
            material = obj.data.materials[polygon.material_index]
            material_uvs[material.name].extend(object_uvs[obj.name][material.name][list(polygon.loop_indices)])
    tiles = []
    bounds = {}
    sizes = {}
    for material in materials:
        node = base_color_node(material)
        if node is not None:
            tile = image_pixels(node.image)
        else:
            factor = np.array(base_color_socket(material).default_value)
            linear = factor[:3]
            factor[:3] = np.where(linear <= 0.0031308, linear * 12.92, 1.055 * linear ** (1 / 2.4) - 0.055)
            tile = np.tile(factor, (8, 8, 1))
        uv = np.array(material_uvs[material.name]) if material_uvs[material.name] else np.array([[0, 0], [1, 1]])
        low = np.floor(uv.min(axis=0)).astype(int)
        high = np.maximum(np.ceil(uv.max(axis=0)).astype(int), low + 1)
        repeat = high - low
        if tile.shape[1] * repeat[0] > 8192 or tile.shape[0] * repeat[1] > 8192:
            raise ValueError('base colour UV repeats exceed the texture atlas budget')
        bounds[material.name] = low
        sizes[material.name] = np.array([tile.shape[1], tile.shape[0]])
        x = (np.arange(low[0] * tile.shape[1], high[0] * tile.shape[1]) + 0.5) / tile.shape[1]
        y = (np.arange(low[1] * tile.shape[0], high[1] * tile.shape[0]) + 0.5) / tile.shape[0]
        xx, yy = np.meshgrid(x, y)
        tile = sample_texture(tile, np.stack((xx, yy), axis=-1), texture_wrap_modes(node))
        tiles.append(np.pad(tile, ((1, 1), (1, 1), (0, 0)), mode='edge'))
    width = max(tile.shape[1] for tile in tiles)
    height = sum(tile.shape[0] for tile in tiles)
    pixels = np.zeros((height, width, 4), dtype=np.float32)
    offsets = {}
    offset = 0
    for material, tile in zip(materials, tiles):
        pixels[offset:offset + tile.shape[0], :tile.shape[1]] = tile
        offsets[material.name] = np.array([1, offset + 1])
        offset += tile.shape[0]
    atlas = bpy.data.images.new('base-color-atlas', width, height, alpha=True)
    atlas.file_format = 'JPEG' if images and all(image.file_format == 'JPEG' for image in images) else 'PNG'
    set_image_pixels(atlas, pixels)
    atlas_uv_name = 'BaseColorAtlas'
    while any(obj.data.uv_layers.get(atlas_uv_name) is not None for obj in mesh_objects()):
        atlas_uv_name += '_1'
    for obj in mesh_objects():
        layer = obj.data.uv_layers.new(name=atlas_uv_name)
        for polygon in obj.data.polygons:
            material = obj.data.materials[polygon.material_index]
            name = material.name
            for loop_index in polygon.loop_indices:
                uv = object_uvs[obj.name][name][loop_index]
                coordinate = (uv - bounds[name]) * sizes[name] + offsets[name]
                layer.data[loop_index].uv = coordinate / [width, height]
    for material in materials:
        nodes = material.node_tree.nodes
        texture = nodes.new('ShaderNodeTexImage')
        texture.image = atlas
        uv = nodes.new('ShaderNodeUVMap')
        uv.uv_map = atlas_uv_name
        material.node_tree.links.new(uv.outputs['UV'], texture.inputs['Vector'])
        original_node = base_color_node(material)
        alpha = base_alpha_socket(material)
        pending = list(alpha.links) if alpha is not None else []
        seen = set()
        while pending:
            link = pending.pop()
            source = link.from_node
            if source == original_node and link.from_socket.name == 'Alpha':
                material.node_tree.links.new(texture.outputs['Alpha'], link.to_socket)
            elif source.name not in seen:
                seen.add(source.name)
                pending.extend(link for socket in source.inputs for link in socket.links)
        material.node_tree.links.new(texture.outputs['Color'], base_color_socket(material))
    return atlas
