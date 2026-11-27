import argparse
import json
import struct
import itertools
import sys
from pathlib import Path

import bpy
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import glb_io
from recolor import colorize

rgb = np.array([[0, 0, 0], [0.5, 0.5, 0.5], [1, 1, 1]], dtype=np.float32)
blue = np.array([30, 80, 230]) / 255
assert np.allclose(colorize(rgb, blue, 0, 0.5), rgb)
assert np.allclose(colorize(rgb, blue, 1, 0.5), np.clip(blue * [[0], [1], [2]], 0, 1))
assert np.allclose(colorize(rgb, blue, 0.5, 0.5), (rgb + colorize(rgb, blue, 1, 0.5)) / 2)
assert np.allclose(colorize(rgb, blue, 1, 0.001), np.clip((rgb @ [0.3, 0.59, 0.11])[:, None] / 0.02 * blue, 0, 1))

parser = argparse.ArgumentParser()
parser.add_argument('--case', required=True)
args = parser.parse_args(glb_io.script_args())
directory = Path(args.case)
result = json.loads((directory / 'result.json').read_text())
assert result['triangleCount'] <= 150000, result
assert result['referenceLuma'] > 0, result
assert result['proportionCheck']['passed'] == (directory.name != 'wrong'), result
assert result['proxyTriangleCount'] <= 2100, result
for filename in ['model.glb', 'points.bin', 'lines.bin', 'colorMask.png', 'thumb.png']:
    assert (directory / filename).stat().st_size > 0, filename
points = np.frombuffer((directory / 'points.bin').read_bytes(), dtype='<f4').reshape(-1, 6)
assert points.shape == (8000, 6), points.shape
assert np.isfinite(points).all()
assert ((points[:, 3:] >= 0) & (points[:, 3:] <= 1)).all()
line_data = (directory / 'lines.bin').read_bytes()
line_count, = struct.unpack_from('<I', line_data)
offset = 4
lengths = []
segments = []
for _ in range(line_count):
    count, = struct.unpack_from('<I', line_data, offset)
    offset += 4
    assert count >= 2
    line = np.frombuffer(line_data, dtype='<f4', count=count * 3, offset=offset).reshape(-1, 3)
    offset += count * 12
    assert np.isfinite(line).all()
    distances = np.linalg.norm(np.diff(line, axis=0), axis=1)
    assert (distances > 0).all(), 'line contains a zero-length segment'
    segments.extend(zip(line[:-1], line[1:]))
    lengths.append(float(distances.sum()))
assert offset == len(line_data)
assert all(a >= b - 1e-6 for a, b in zip(lengths, lengths[1:])), lengths
assert line_count > 0

glb_io.open_glb(str(directory / 'model.glb'))
assert glb_io.triangle_count() <= 150000
assert all(obj.data.uv_layers for obj in glb_io.mesh_objects()), 'decimation lost UVs'
low, high = glb_io.mesh_bounds()
file_low = np.array([low.x, low.z, -high.y])
file_high = np.array([high.x, high.z, -low.y])
assert (points[:, :3] >= file_low - 1e-5).all()
assert (points[:, :3] <= file_high + 1e-5).all()
if directory.name in ['white', 'black', 'grey']:
    surface_axis = np.column_stack([np.isclose(points[:, axis], file_low[axis], atol=1e-5) |
                                    np.isclose(points[:, axis], file_high[axis], atol=1e-5) for axis in range(3)])
    assert surface_axis.any(axis=1).all(), 'sample is not on the cube surface'
    areas = np.array([0.9 * 0.5, 0.6 * 0.5, 0.6 * 0.9])
    assert np.max(np.abs(surface_axis.mean(axis=0) - areas / areas.sum())) < 0.025, 'samples are not area weighted'
if directory.name == 'grey':
    corners = list(itertools.product(*zip(file_low, file_high)))
    expected_edges = [(a, b) for i, a in enumerate(corners) for b in corners[i + 1:]
                      if np.count_nonzero(np.array(a) != b) == 1]
    assert len(segments) == len(expected_edges) == 12, 'cube crease edge count changed'
    for a, b in expected_edges:
        assert any((np.allclose(a, c, atol=1e-5) and np.allclose(b, d, atol=1e-5)) or
                   (np.allclose(a, d, atol=1e-5) and np.allclose(b, c, atol=1e-5)) for c, d in segments), 'cube crease coordinates changed'
if directory.name == 'dense-uv':
    for obj in glb_io.mesh_objects():
        mesh = obj.data
        coordinates = np.empty(len(mesh.vertices) * 3, dtype=np.float32)
        mesh.vertices.foreach_get('co', coordinates)
        coordinates = coordinates.reshape(-1, 3)
        indices = np.empty(len(mesh.loops), dtype=np.int32)
        mesh.loops.foreach_get('vertex_index', indices)
        actual_uv = np.empty(len(mesh.loops) * 2, dtype=np.float32)
        mesh.uv_layers.active.data.foreach_get('uv', actual_uv)
        expected_uv = np.column_stack((coordinates[indices, 0] / 0.6 + 0.5, coordinates[indices, 2] / 0.9))
        assert np.allclose(actual_uv.reshape(-1, 2), expected_uv, atol=1 / 64), 'decimation corrupted UV mapping'
if directory.name in ['dense-uv', 'mirror', 'mirror-atlas', 'mixed-wrap']:
    uv = np.column_stack((points[:, 0] / 0.6 + 0.5, points[:, 1] / 0.9))
    if directory.name != 'dense-uv':
        uv = uv * 2.5 - 0.25
        uv[:, 0] = 1 - np.abs(uv[:, 0] % 2 - 1)
        uv[:, 1] = np.clip(uv[:, 1], 0, 1) if directory.name == 'mixed-wrap' else 1 - np.abs(uv[:, 1] % 2 - 1)
    interior = ((uv > 0.02) & (uv < 0.98)).all(axis=1)
    assert interior.sum() > 100
    coordinates = np.floor(uv[interior] * 64).clip(0, 63)
    expected_rgb = np.column_stack((0.1 + 0.8 * coordinates[:, 0] / 63,
                                    0.2 + 0.6 * coordinates[:, 1] / 63,
                                    np.full(len(coordinates), 0.25)))
    assert np.max(np.abs(points[interior, 3:] - expected_rgb)) < 0.015, 'surface colours disagree with known positions'
if directory.name in ['vertex', 'vertex-normal']:
    linear = np.column_stack(((0.2 + 0.6 * points[:, 1] / 0.9) * 0.4,
                              np.full(8000, 0.1 * 0.6), np.full(8000, 0.05 * 0.8)))
    expected_rgb = np.where(linear <= 0.0031308, linear * 12.92, 1.055 * linear ** (1 / 2.4) - 0.055)
    assert np.max(np.abs(points[:, 3:] - expected_rgb)) < 0.035, 'vertex colours or material factors were lost'
    document, _ = glb_io.read_glb(directory / 'model.glb')
    assert all('COLOR_0' not in primitive['attributes'] for mesh in document['meshes'] for primitive in mesh['primitives'])
if directory.name == 'vertex-normal':
    for obj in glb_io.mesh_objects():
        material = obj.data.materials[0]
        normal = next(node for node in material.node_tree.nodes if node.type == 'NORMAL_MAP')
        node = normal.inputs['Color'].links[0].from_node
        uv = glb_io.base_color_uvs(obj, node)
        positions = np.array([obj.data.vertices[loop.vertex_index].co for loop in obj.data.loops])
        expected_uv = np.column_stack((positions[:, 0] / 0.6 + 0.5, positions[:, 2] / 0.9))
        assert np.allclose(uv, expected_uv, atol=1e-5), 'vertex bake changed normal-map UVs'
if directory.name == 'multi-alpha':
    document, _ = glb_io.read_glb(directory / 'model.glb')
    factors = {material['name']: material['pbrMetallicRoughness']['baseColorFactor'][3] for material in document['materials']}
    for obj in glb_io.mesh_objects():
        material = obj.data.materials[0]
        node = glb_io.base_color_node(material)
        uv = glb_io.base_color_uvs(obj, node)
        pixels = glb_io.image_pixels(node.image)
        for polygon in obj.data.polygons:
            position = np.array([obj.data.vertices[obj.data.loops[loop].vertex_index].co for loop in polygon.loop_indices]).mean(axis=0)
            source_v = (position[1] / 0.5 + 0.5) * 2 if abs(polygon.normal.z) > 0.9 else position[2] / 0.9 * 2
            row = int((source_v % 1) * 64) % 64
            expected_alpha = (0.1 + 0.8 * row / 63) * (0.6 if material.name == 'fixture' else 0.8)
            coordinate = uv[list(polygon.loop_indices)].mean(axis=0)
            x = int(coordinate[0] * pixels.shape[1]) % pixels.shape[1]
            y = int(coordinate[1] * pixels.shape[0]) % pixels.shape[0]
            actual_alpha = pixels[y, x, 3] * factors[material.name]
            assert abs(actual_alpha - expected_alpha) < 0.02, 'atlas changed material alpha coordinates or factor'
if directory.name == 'oversized-normal':
    document, _ = glb_io.read_glb(directory / 'model.glb')
    assert all('normalTexture' in material for material in document['materials'])
    normal_images = [node.image for obj in glb_io.mesh_objects() for material in obj.data.materials
                     for node in material.node_tree.nodes if node.type == 'TEX_IMAGE' and node.image
                     and node.image.colorspace_settings.name == 'Non-Color']
    assert normal_images, 'normal map was lost during export'
    for image in normal_images:
        assert tuple(image.size) == (2048, 512), tuple(image.size)
        pixels = glb_io.image_pixels(image)
        assert np.max(np.abs(pixels[:, :, 0] - np.linspace(0.3, 0.7, 2048)[None, :])) < 0.01
        assert np.max(np.abs(pixels[:, :, 1] - 0.5)) < 0.01
        assert np.max(np.abs(pixels[:, :, 2] - 0.9)) < 0.01

images = glb_io.base_color_images()
for image in bpy.data.images:
    assert max(image.size) <= 2048, (image.name, tuple(image.size))
if directory.name.startswith('oversized') and directory.name != 'oversized-normal':
    expected_size = (512, 2048) if directory.name == 'oversized-alpha' else (2048, 512)
    if directory.name != 'oversized-atlas':
        assert tuple(images[0].size) == expected_size, tuple(images[0].size)
    pixels = glb_io.image_pixels(images[0])
    assert np.ptp(pixels[:, :, 0]) > 0.4, 'downscaling lost the texture gradient'
    if directory.name == 'oversized-alpha':
        assert np.ptp(pixels[:, :, 3]) > 0.4, 'downscaling lost alpha'
assert len(images) == 1
before = glb_io.image_pixels(images[0])
if directory.name in ['jpeg-alpha', 'png-alpha']:
    document, _ = glb_io.read_glb(directory / 'model.glb')
    expected_mime = 'image/jpeg' if directory.name == 'jpeg-alpha' else 'image/png'
    assert all(image['mimeType'] == expected_mime for image in document['images'])
    assert abs(document['materials'][0]['pbrMetallicRoughness']['baseColorFactor'][3] - 0.4) < 1e-6
mask_image = bpy.data.images.load(str(directory / 'colorMask.png'))
assert tuple(mask_image.size) == tuple(images[0].size)
mask = glb_io.image_pixels(mask_image)[:, :, 0] > 0.5
assert mask.any()
thumb = bpy.data.images.load(str(directory / 'thumb.png'))
assert tuple(thumb.size) == (512, 512)
assert 0.05 < np.mean(glb_io.image_pixels(thumb)[:, :, 3] > 0.01) < 0.95
if directory.name == 'factor':
    source_factor = [0.4, 0.6, 0.8]
    original = np.linspace(0.72, 1, 64)
    encoded = np.round(original * 255) / 255
    linear = np.where(encoded <= 0.04045, encoded / 12.92, ((encoded + 0.055) / 1.055) ** 2.4)
    expected = 1.055 * (linear[:, None] * source_factor) ** (1 / 2.4) - 0.055
    assert np.max(np.abs(before[:, 0, :3] - expected)) < 0.01
    document, _ = glb_io.read_glb(directory / 'model.glb')
    assert all(material.get('pbrMetallicRoughness', {}).get('baseColorFactor', [1, 1, 1, 1]) == [1, 1, 1, 1]
               for material in document['materials'])
if directory.name in ['external', 'external-buffer']:
    assert np.max(np.abs(before[:, :, :3].mean(axis=(0, 1)) - 0.5)) < 0.01, 'relative texture URI was not loaded'
    assert np.ptp(before[:, :, 0]) > 0.18
if directory.name == 'neutral':
    assert not mask[:16].any() and mask[16:].all(), 'dark region was included in the mask'
if directory.name == 'unlit':
    linear = np.array([0.2, 0.4, 0.6])
    expected = 1.055 * linear ** (1 / 2.4) - 0.055
    assert np.max(np.abs(before[:, :, :3][mask].mean(axis=0) - expected)) < 0.01
if directory.name in ['unlit', 'unlit-textured']:
    document, _ = glb_io.read_glb(directory / 'model.glb')
    assert all('KHR_materials_unlit' in material.get('extensions', {}) for material in document['materials'])
if directory.name in ['multi', 'default']:
    for obj in glb_io.mesh_objects():
        node = glb_io.base_color_node(obj.data.materials[0])
        uv = glb_io.base_color_uvs(obj, node)
        assert (np.ptp(uv, axis=0) > 0.1).all(), 'atlas collapsed UV endpoints'
    assert len(np.unique(np.round(points[:, 3:], 3), axis=0)) > 16, 'surface samples lost texture variation'
if directory.name == 'multi':
    assert np.ptp(points[points[:, 0] > 0.01, 3]) > 0.4, 'repeated red texture lost its gradient'
if (directory / 'recolored.glb').exists():
    glb_io.open_glb(str(directory / 'recolored.glb'))
    after = glb_io.image_pixels(glb_io.base_color_images()[0])
    if directory.name == 'rgba-alpha':
        assert before[:, :, 3].min() > 0.3 and before[:, :, 3].max() < 0.5
        assert np.ptp(before[:, :, 3]) > 0.1
        assert np.allclose(after[:, :, 3], before[:, :, 3], atol=1 / 255)
    target = np.array([30, 80, 230]) / 255
    shade = (before[:, :, :3] @ [0.3, 0.59, 0.11]) / max(result['referenceLuma'], 0.02)
    expected = before[:, :, :3].copy()
    expected[mask] = np.clip(shade[mask, None] * target, 0, 1)
    jpeg = directory.name in ['chair-jpeg', 'jpeg-alpha', 'multi-jpeg', 'oversized-jpeg']
    error = np.abs(after[:, :, :3] - expected)
    assert (error.mean() < 0.02 if jpeg else error.max() < 0.009), (directory.name, error.max(), error.mean())
    if directory.name == 'neutral':
        assert np.array_equal(after[:16], before[:16]), 'dark region changed during recolor'
    if directory.name in ['white', 'black']:
        mean = after[:, :, :3][mask].mean(axis=0)
        assert np.max(np.abs(mean - target)) < 0.05, mean
        assert np.ptp(after[:, :, :3][mask] @ [0.3, 0.59, 0.11]) > 0.01
    if directory.name in ['chair', 'chair-jpeg']:
        assert not mask[16, 16] and mask[48, 16], 'legs were included in mask'
        assert np.max(np.abs(after[8:24] - before[8:24])) < (0.03 if jpeg else 1 / 255)
        assert (points[:, 1] < 0.39).any() and (points[:, 1] > 0.5).any()
        assert np.any(np.max(np.abs(points[:, 3:] - before[16, 16, :3]), axis=1) < 0.01)
    if directory.name in ['jpeg-alpha', 'png-alpha']:
        document, _ = glb_io.read_glb(directory / 'recolored.glb')
        assert abs(document['materials'][0]['pbrMetallicRoughness']['baseColorFactor'][3] - 0.4) < 1e-6
    if jpeg:
        document, _ = glb_io.read_glb(directory / 'recolored.glb')
        assert all(image['mimeType'] == 'image/jpeg' for image in document['images'])
