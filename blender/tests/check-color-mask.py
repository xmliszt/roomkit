import sys
import json
import os
import shutil
import socket
import subprocess
import tempfile
from pathlib import Path

import bpy
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import glb_io
from color_mask import large_triangle_texels, triangle_texels, write_color_mask


def material(name, image):
    result = bpy.data.materials.new(name)
    texture = result.node_tree.nodes.new('ShaderNodeTexImage')
    texture.image = image
    result.node_tree.links.new(texture.outputs['Color'], glb_io.base_color_socket(result))
    return result


def build_chair(*, kind):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    width = height = 256
    pixels = np.ones((height, width, 4), dtype=np.float32)
    pixels[:, :, :3] = [0.1, 0.8, 0.2]
    rng = np.random.default_rng(17)
    if kind == 'shaded-grey-fabric':
        pixels[:, :128, :3] = (0.08 * 10 ** np.clip((np.arange(128) - 8) / 94, 0, 1))[None, :, None] * rng.uniform(0.97, 1, (256, 128, 1))
    else:
        shade = np.linspace(0.2, 1, 128)[None, :] * rng.uniform(0.75, 1, (256, 128))
        fabric_rgb = np.tile([0.95, 0.72, 0.28], (256, 128, 1))
        wash = np.linspace(0, 0.32, 128)[None, :, None]
        pixels[:, :128, :3] = shade[:, :, None] * (fabric_rgb + (1 - fabric_rgb) * wash)
    pixels[:, 160:240, :3] = {'shaded-fabric': [0.13, 0.06, 0.025], 'shaded-grey-fabric': [0.04, 0.04, 0.04],
                              'two-material': [0.4, 0.4, 0.42], 'chrome-legs': [0.75, 0.6, 0.3],
                              'glass-legs': [0.75, 0.6, 0.3], 'texture-glass-legs': [0.75, 0.6, 0.3]}[kind]
    if kind == 'texture-glass-legs':
        pixels[:, 160:240, 3] = 0.15
    image = bpy.data.images.new('baked-atlas', width, height, alpha=kind == 'texture-glass-legs')
    glb_io.set_image_pixels(image, pixels)
    fabric = material('fabric', image)
    legs = material('metal', image) if kind in ('two-material', 'chrome-legs', 'glass-legs', 'texture-glass-legs') else fabric
    if kind == 'chrome-legs':
        next(node for node in legs.node_tree.nodes if node.type == 'BSDF_PRINCIPLED').inputs['Metallic'].default_value = 1
    if kind == 'texture-glass-legs':
        shader = next(node for node in legs.node_tree.nodes if node.type == 'BSDF_PRINCIPLED')
        legs.node_tree.links.new(glb_io.base_color_node(legs).outputs['Alpha'], shader.inputs['Alpha'])
        legs.surface_render_method = 'BLENDED'
    if kind == 'glass-legs':
        next(node for node in legs.node_tree.nodes if node.type == 'BSDF_PRINCIPLED').inputs['Alpha'].default_value = 0.15
        legs.surface_render_method = 'BLENDED'
    expected = np.zeros((height, width), dtype=bool)
    excluded = expected.copy()
    parts = [('seat', (0, 0, 0.4), (0.8, 0.7, 0.2)),
             ('back', (0, 0.3, 0.75), (0.8, 0.15, 0.6)),
             *[(f'leg-{i}', (x, y, 0.15), (0.06, 0.06, 0.3))
               for i, (x, y) in enumerate([(-0.3, -0.25), (0.3, -0.25), (-0.3, 0.25), (0.3, 0.25)])]]
    for part_index, (name, location, scale) in enumerate(parts):
        is_fabric = part_index < 2
        bpy.ops.mesh.primitive_cube_add(size=1, location=location)
        obj = bpy.context.object
        obj.name = name
        obj.scale = scale
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        modifier = obj.modifiers.new('surface-regions', 'SUBSURF')
        modifier.subdivision_type = 'SIMPLE'
        modifier.levels = 2
        modifier.uv_smooth = 'NONE'
        bpy.ops.object.modifier_apply(modifier=modifier.name)
        obj.data.materials.append(fabric if is_fabric else legs)
        for face in obj.data.polygons:
            cell = face.index
            x = (cell % 12) * (8 if is_fabric else 6) + (8 if is_fabric else 164)
            y = (cell // 12) * 8 + 8 + (part_index if is_fabric else part_index - 2) * 60
            size = 6 if is_fabric else 4
            for loop, uv in zip(face.loop_indices, [(x, y), (x + size, y), (x + size, y + 6), (x, y + 6)]):
                obj.data.uv_layers.active.data[loop].uv = np.array(uv) / [width, height]
            (expected if is_fabric else excluded)[y:y + 6, x:x + size] = True
    return image, pixels, expected, excluded


def save_noise_mask(path, size):
    image = bpy.data.images.new('noise-mask', size, size)
    pixels = np.ones((size, size, 4), dtype=np.float32)
    pixels[:, :, :3] = np.random.default_rng(3).integers(0, 2, (size, size))[:, :, None]
    glb_io.set_image_pixels(image, pixels)
    image.filepath_raw = str(path)
    image.file_format = 'PNG'
    image.save()


def build_tiled_plane(*, repeats):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    image = bpy.data.images.new('tiled-fabric', 64, 64)
    pixels = np.ones((64, 64, 4), dtype=np.float32)
    pixels[:, :, :3] = [0.7, 0.3, 0.2]
    glb_io.set_image_pixels(image, pixels)
    bpy.ops.mesh.primitive_plane_add(size=1)
    obj = bpy.context.object
    obj.data.materials.append(material('tiled', image))
    for loop in obj.data.loops:
        obj.data.uv_layers.active.data[loop.index].uv *= repeats
    return image


def check_scanline_matches_meshgrid():
    rng = np.random.default_rng(5)
    modes = ['REPEAT', 'MIRROR', 'EXTEND']
    for index in range(600):
        coordinates = np.round(rng.uniform(-80, 110, (3, 2)) * 1024) / 1024
        if index % 4 == 0:
            coordinates = np.round(coordinates * 2) / 2
        if index % 5 == 0:
            coordinates[1, 1] = coordinates[0, 1] = np.floor(coordinates[0, 1]) + 0.3007
        mode = (modes[index % 3], modes[index // 3 % 3])
        expected = triangle_texels(coordinates / [64, 48], 64, 48, mode)
        actual = large_triangle_texels(coordinates, 64, 48, mode)
        if len(actual):
            assert np.array_equal(actual, expected), (index, mode, coordinates.tolist())


def check_textured_metal_legs(path):
    build_chair(kind='chrome-legs')
    metal = bpy.data.materials['metal']
    shader = next(node for node in metal.node_tree.nodes if node.type == 'BSDF_PRINCIPLED')
    shader.inputs['Metallic'].default_value = 0
    leg_colour = glb_io.base_color_node(metal).image.copy()
    glb_io.base_color_node(metal).image = leg_colour
    metallic = bpy.data.images.new('metallic', 256, 256)
    metallic.colorspace_settings.name = 'Non-Color'
    values = np.zeros((256, 256, 4), dtype=np.float32)
    values[:, :, 3] = 1
    values[:, :64, 2] = 1
    glb_io.set_image_pixels(metallic, values)
    texture = metal.node_tree.nodes.new('ShaderNodeTexImage')
    texture.image = metallic
    for obj in glb_io.mesh_objects():
        if obj.name.startswith('leg'):
            original = np.array([loop.uv for loop in obj.data.uv_layers.active.data])
            obj.data.uv_layers.new(name='metal-uv').data.foreach_set('uv', (original * [0.25, 1]).ravel())
    uv_map = metal.node_tree.nodes.new('ShaderNodeUVMap')
    uv_map.uv_map = 'metal-uv'
    metal.node_tree.links.new(uv_map.outputs['UV'], texture.inputs['Vector'])
    separate = metal.node_tree.nodes.new('ShaderNodeSeparateColor')
    metal.node_tree.links.new(texture.outputs['Color'], separate.inputs['Color'])
    metal.node_tree.links.new(separate.outputs['Blue'], shader.inputs['Metallic'])
    atlas = glb_io.base_color_atlas()
    mask, _, _ = write_color_mask(atlas, path)
    mask = mask.reshape(atlas.size[1], atlas.size[0]).astype(float)
    for obj in glb_io.mesh_objects():
        node = glb_io.base_color_node(obj.data.materials[0])
        uv = glb_io.base_color_uvs(obj, node)
        centres = np.array([uv[list(face.loop_indices)].mean(axis=0) for face in obj.data.polygons])
        sampled = glb_io.sample_texture(mask, centres, glb_io.texture_wrap_modes(node))
        expected = 0 if obj.name.startswith('leg') else 1
        assert np.all(sampled == expected), (obj.name, sampled.mean())


check_scanline_matches_meshgrid()


def run_repair(*, project, env, apply):
    completed = subprocess.run(['node', str(Path(__file__).resolve().parents[2] / 'scripts/f5-rebuild-masks.ts'),
                                str(project), *(['--apply'] if apply else [])],
                               env=env, capture_output=True, text=True, timeout=180)
    return completed.returncode, completed.stdout + completed.stderr


with tempfile.TemporaryDirectory(prefix='planner-color-mask-') as temporary:
    mask, _, _ = write_color_mask(build_tiled_plane(repeats=3), Path(temporary) / 'tiled.png')
    assert mask.all(), 'tiled texture not fully masked'
    mask, _, _ = write_color_mask(build_tiled_plane(repeats=2000), Path(temporary) / 'tiled.png')
    assert mask.all(), 'texture tiled past the repeat limit not fully masked'
    check_textured_metal_legs(Path(temporary) / 'metal.png')
    assert triangle_texels(np.array([[0, 0], [20, 0], [0, 1]]), 64, 64, ('REPEAT', 'REPEAT')) is None, \
        'a triangle spanning 20 repeats was rasterised'
    project = Path(temporary) / 'project'
    expected_masks = {}
    for kind in ('shaded-fabric', 'shaded-grey-fabric', 'two-material', 'chrome-legs', 'glass-legs', 'texture-glass-legs'):
        image, pixels, fabric, legs = build_chair(kind=kind)
        asset = project / 'assets' / kind
        asset.mkdir(parents=True)
        mask, luma, surface = write_color_mask(image, asset / 'direct.png')
        mask = mask.reshape(fabric.shape)
        assert np.array_equal(surface.reshape(fabric.shape), fabric | legs), f'{kind}: surface texels'
        assert mask[fabric].mean() >= 0.95, (kind, 'fabric coverage', mask[fabric].mean())
        assert mask[legs].mean() < 0.05, (kind, 'legs coverage', mask[legs].mean())
        if kind in ('two-material', 'chrome-legs', 'glass-legs', 'texture-glass-legs'):
            grown = np.pad(fabric, 2)
            grown = np.logical_or.reduce([grown[y:y + 256, x:x + 256] for y in range(5) for x in range(5)])
            assert mask[fabric].all() and not mask[legs].any() and not mask[~grown].any(), \
                f'{kind}: mask is not the fabric UV area grown 2 px'
        expected_luma = np.median(pixels[fabric, :3] @ [0.3, 0.59, 0.11])
        assert abs(luma - expected_luma) < 1 / 255, (kind, luma, expected_luma)
        padded = np.pad(mask, 1, mode='edge')
        same = np.zeros_like(mask)
        for y, x in [(y, x) for y in range(3) for x in range(3) if (y, x) != (1, 1)]:
            same |= padded[y:y + mask.shape[0], x:x + mask.shape[1]] == mask
        assert (~same).mean() < 0.01, (kind, 'isolated mask pixels')
        assert not mask[:, 140:].any(), (kind, 'unused texels nearer the legs selected')
        if kind in ('shaded-fabric', 'shaded-grey-fabric'):
            assert mask[10:128, 104:128].all(), (kind, 'unused texels nearer the fabric not filled')
        print(f"{kind}: fabric={mask[fabric].mean():.3%}, legs={mask[legs].mean():.3%}, isolated={(~same).mean():.3%}", flush=True)
        (asset / 'direct.png').unlink()
        glb_io.export_glb(str(asset / 'model.glb'))
        save_noise_mask(asset / 'colorMask.png', mask.shape[0])
        metadata = {'id': kind, 'kind': 'generated', 'nativeSizeM': {'width': 0.8, 'height': 1.05, 'depth': 0.7},
                    'mount': 'floor', 'triangleCount': glb_io.triangle_count(), 'hasColorMask': True,
                    'referenceLuma': 0.1, 'provenance': {'method': 'fixture', 'sourcePhotoIds': []}}
        (asset / 'meta.json').write_text(json.dumps(metadata))
        (asset / 'points.bin').write_bytes(b'unchanged appearance data')
        expected_masks[kind] = (mask, luma, metadata, {file.name: file.read_bytes() for file in asset.iterdir()})

    def unchanged(*, skip):
        for name, (_, _, _, before) in expected_masks.items():
            for file, original in before.items():
                if file not in skip:
                    assert (project / 'assets' / name / file).read_bytes() == original, f'{name}/{file} changed'

    home = Path(temporary) / 'home'
    home.mkdir()
    env = {**os.environ, 'BLENDER': bpy.app.binary_path, 'PLANNER_HOME': str(home),
           'PLANNER_PROJECTS': str(Path(temporary) / 'projects'),
           'PLANNER_MACHINE_LOCK': str(Path(temporary) / 'machine.lock')}
    with socket.create_server(('127.0.0.1', 0)) as server:
        (home / 'daemon.json').write_text(json.dumps({'pid': os.getpid(), 'port': server.getsockname()[1], 'token': 'x'}))
        code, output = run_repair(project=project, env=env, apply=True)
        assert code != 0 and 'Refusing --apply: the daemon is running' in output, output
    (home / 'daemon.json').unlink()
    (project / '.planner').mkdir()
    (project / '.planner' / 'jobs.json').write_text(json.dumps([{'job': {'kind': 'generation', 'id': 'job-1', 'stage': 'generating'}}]))
    code, output = run_repair(project=project, env=env, apply=True)
    assert code != 0 and 'Refusing --apply: 1 job(s) in the project are unfinished' in output, output
    unchanged(skip=())
    (project / '.planner' / 'jobs.json').write_text(json.dumps([{'job': {'kind': 'generation', 'id': 'job-1', 'stage': 'ready'}},
                                                                {'job': {'kind': 'generation', 'id': 'job-2', 'stage': 'held'}}]))
    broken = project / 'assets' / 'broken'
    shutil.copytree(project / 'assets' / 'two-material', broken)
    save_noise_mask(broken / 'colorMask.png', 16)
    (broken / 'meta.json').write_text(json.dumps({**json.loads((broken / 'meta.json').read_text()), 'id': 'broken'}))
    broken_files = {file.name: file.read_bytes() for file in broken.iterdir()}
    code, output = run_repair(project=project, env=env, apply=False)
    assert code == 1 and 'surface coverage' in output and 'broken: failed' in output, output
    previews = next(line.removeprefix('Mask previews: ') for line in output.splitlines() if line.startswith('Mask previews: '))
    shutil.rmtree(previews)
    unchanged(skip=())
    code, output = run_repair(project=project, env=env, apply=True)
    assert code == 1 and 'broken: failed: the old mask does not match the atlas size' in output, output
    assert {file.name: file.read_bytes() for file in broken.iterdir()} == broken_files, 'a failed asset was changed'
    previews = next(line.removeprefix('Mask previews: ') for line in output.splitlines() if line.startswith('Mask previews: '))
    assert not Path(previews).exists(), 'apply left the preview folder'
    unchanged(skip=('colorMask.png', 'meta.json'))
    for name, (mask, luma, metadata, _) in expected_masks.items():
        asset = project / 'assets' / name
        rebuilt = glb_io.image_pixels(bpy.data.images.load(str(asset / 'colorMask.png')))[:, :, 0] > 0.5
        assert np.array_equal(rebuilt, mask), f'{name}: rebuilt mask differs from the normalize mask'
        repaired = json.loads((asset / 'meta.json').read_text())
        assert abs(repaired.pop('referenceLuma') - luma) < 1 / 255
        assert repaired == {key: value for key, value in metadata.items() if key != 'referenceLuma'}, 'repair changed unrelated metadata'
        assert not list(asset.glob('*.tmp')), 'repair left staged files'
    print('repair: refused while the daemon runs or a job is unfinished; masks match normalize; other files unchanged', flush=True)
