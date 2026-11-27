import colorsys
from collections import defaultdict

import bpy
import numpy as np

import glb_io


def wrap(values, size, mode):
    if mode == 'REPEAT':
        return values % size
    if mode == 'MIRROR':
        values = values % (2 * size)
        return np.minimum(values, 2 * size - 1 - values)
    return np.clip(values, 0, size - 1)


def column_intervals(first, last, width, mode):
    if mode not in ('REPEAT', 'MIRROR'):
        return [(np.clip(first, 0, width - 1), np.clip(last, 0, width - 1), np.ones(len(first), dtype=bool))]
    period = width if mode == 'REPEAT' else 2 * width
    full = last - first + 1 >= period
    start = np.where(full, 0, first % period)
    end = np.where(full, width - 1, start + last - first)
    intervals = []
    for segment in range(4 if mode == 'MIRROR' else 2):
        low = np.maximum(start, segment * width)
        high = np.minimum(end, (segment + 1) * width - 1)
        present = low <= high
        if segment % 2 == 0 or mode == 'REPEAT':
            intervals.append((low - segment * width, high - segment * width, present))
        else:
            intervals.append(((segment + 1) * width - 1 - high, (segment + 1) * width - 1 - low, present))
    return intervals


def large_triangle_texels(coordinates, width, height, modes):
    (abx, aby), (acx, acy) = coordinates[1] - coordinates[0], coordinates[2] - coordinates[0]
    if abx * acy - aby * acx < 0:
        coordinates = coordinates[[0, 2, 1]]
    rows = np.arange(np.floor(coordinates[:, 1].min()), np.ceil(coordinates[:, 1].max())).astype(np.int64)
    y = rows + 0.5
    low = np.full(len(rows), -np.inf)
    high = np.full(len(rows), np.inf)
    for start, end in zip(coordinates, np.roll(coordinates, -1, axis=0)):
        dx, dy = end - start
        if dy == 0:
            low[dx * (y - start[1]) < 0] = np.inf
            continue
        bound = start[0] + dx * (y - start[1]) / dy
        if dy > 0:
            high = np.minimum(high, bound)
        else:
            low = np.maximum(low, bound)
    kept = np.isfinite(low) & np.isfinite(high)
    first = np.ceil(low[kept] - 0.5).astype(np.int64)
    last = np.floor(high[kept] - 0.5).astype(np.int64)
    nonempty = first <= last
    texel_rows = wrap(rows[kept][nonempty], height, modes[1])
    first, last = first[nonempty], last[nonempty]
    changes = np.zeros((height, width + 1), dtype=np.int64)
    for low_column, high_column, present in column_intervals(first, last, width, modes[0]):
        np.add.at(changes, (texel_rows[present], low_column[present]), 1)
        np.add.at(changes, (texel_rows[present], high_column[present] + 1), -1)
    return np.flatnonzero(np.cumsum(changes, axis=1)[:, :width] > 0)


def triangle_texels(uv, width, height, modes):
    coordinates = np.round(uv * [width, height] * 1024) / 1024
    low = np.floor(coordinates.min(axis=0)).astype(int)
    high = np.ceil(coordinates.max(axis=0)).astype(int)
    if np.any(high - low > 4 * np.array([width, height])):
        return None
    a, b, c = coordinates
    ab, ac = b - a, c - a
    determinant = ab[0] * ac[1] - ab[1] * ac[0]
    is_large = np.prod(high - low) > 4 * 1024 * 1024
    if abs(determinant) > 1e-10 and is_large:
        texels = large_triangle_texels(coordinates, width, height, modes)
        if len(texels):
            return texels
    indices = []
    if abs(determinant) > 1e-10 and not is_large:
        for start in range(low[1], high[1], 64):
            x, y = np.meshgrid(np.arange(low[0], high[0]), np.arange(start, min(start + 64, high[1])))
            dx, dy = x + 0.5 - a[0], y + 0.5 - a[1]
            u = (dx * ac[1] - dy * ac[0]) / determinant
            v = (ab[0] * dy - ab[1] * dx) / determinant
            inside = (u >= -1e-7) & (v >= -1e-7) & (u + v <= 1 + 1e-7)
            indices.append(np.column_stack((x[inside], y[inside])))
    points = np.concatenate(indices) if indices else np.empty((0, 2), dtype=int)
    if not len(points):
        points = np.floor(coordinates.mean(axis=0)).astype(int)[None, :]
    return np.unique(wrap(points[:, 1], height, modes[1]) * width + wrap(points[:, 0], width, modes[0]))


def color_features(rgb):
    hsv = np.array([colorsys.rgb_to_hsv(*color) for color in rgb])
    angle = hsv[:, 0] * 2 * np.pi
    luma = rgb @ [0.3, 0.59, 0.11]
    luma_weight = np.interp(hsv[:, 1], [0, 0.25], [0.15, 0.055])
    return np.column_stack((np.cos(angle) * hsv[:, 1], np.sin(angle) * hsv[:, 1],
                            np.log2(np.maximum(luma, 1 / 255)) * luma_weight))


def cluster_features(features, areas):
    centres = [np.average(features, axis=0, weights=areas)]
    for _ in range(3):
        distances = np.min(np.sum((features[:, None, :] - centres) ** 2, axis=2), axis=1)
        farthest = int(np.argmax(distances))
        if distances[farthest] < 0.22 ** 2:
            break
        centres.append(features[farthest])
    centres = np.array(centres)
    for _ in range(20):
        labels = np.argmin(np.sum((features[:, None, :] - centres) ** 2, axis=2), axis=1)
        updated = np.array([np.average(features[labels == i], axis=0, weights=areas[labels == i])
                            if np.any(labels == i) else centre for i, centre in enumerate(centres)])
        if np.max(np.abs(updated - centres)) < 0.001:
            break
        centres = updated
    return labels


def split_at_luma_gaps(rgb):
    stops = np.log2(np.maximum(rgb @ [0.3, 0.59, 0.11], 1 / 255))
    order = np.argsort(stops)
    labels = np.empty(len(rgb), dtype=int)
    labels[order] = np.concatenate(([0], np.cumsum(np.diff(stops[order]) >= 0.5)))
    return labels


def cluster_colors(rgb, areas, *, split_neutral_at_gaps):
    features = color_features(rgb)
    is_neutral = (np.array([colorsys.rgb_to_hsv(*color)[1] for color in rgb]) < 0.1) & split_neutral_at_gaps
    labels = np.empty(len(rgb), dtype=int)
    if np.any(~is_neutral):
        labels[~is_neutral] = cluster_features(features[~is_neutral], areas[~is_neutral])
    if np.any(is_neutral):
        labels[is_neutral] = split_at_luma_gaps(rgb[is_neutral]) + (labels[~is_neutral].max() + 1 if np.any(~is_neutral) else 0)
    while len(np.unique(labels)) > 1:
        groups = np.unique(labels)
        means = np.array([np.average(features[labels == group], axis=0, weights=areas[labels == group])
                          for group in groups])
        neutral_groups = np.array([is_neutral[labels == group].all() for group in groups])
        distances = np.sum((means[:, None, :] - means) ** 2, axis=2)
        distances[neutral_groups[:, None] & neutral_groups[None, :]] = np.inf
        np.fill_diagonal(distances, np.inf)
        left, right = np.unravel_index(np.argmin(distances), distances.shape)
        if distances[left, right] >= 0.22 ** 2:
            break
        labels[labels == groups[right]] = groups[left]
    return labels


def metallic_factor(material, faces):
    shader = next((node for node in material.node_tree.nodes if node.type == 'BSDF_PRINCIPLED'), None)
    if shader is None:
        return 0.0
    socket = shader.inputs['Metallic']
    factor = 1.0
    while socket.is_linked:
        node = socket.links[0].from_node
        if node.type == 'TEX_IMAGE':
            objects = {obj.name: obj for _, obj, _ in faces}
            uvs = {name: glb_io.base_color_uvs(obj, node) for name, obj in objects.items()}
            centres = np.array([uvs[obj.name][loops].mean(axis=0) for _, obj, loops in faces])
            samples = glb_io.sample_texture(glb_io.image_pixels(node.image), centres, glb_io.texture_wrap_modes(node))
            return factor * float(np.average(samples[:, 2], weights=[area for area, _, _ in faces]))
        if node.type == 'MATH' and node.operation == 'MULTIPLY':
            factor *= np.prod([value.default_value for value in node.inputs[:2] if not value.is_linked])
            socket = next((value for value in node.inputs[:2] if value.is_linked), None)
            if socket is None:
                return factor
        elif node.type in ('SEPARATE_COLOR', 'SEPRGB'):
            socket = node.inputs[0]
        else:
            return 0.0
    return factor * socket.default_value


def smooth_labels(labels, edges):
    if len(np.unique(labels)) == 1:
        return labels
    neighbours = [set() for _ in labels]
    for faces in edges.values():
        for face in faces:
            neighbours[face].update(other for other in faces if other != face)
    cluster_count = int(labels.max()) + 1
    for _ in range(3):
        updated = labels.copy()
        for face, adjacent in enumerate(neighbours):
            if not adjacent:
                continue
            votes = np.bincount(labels[list(adjacent)], minlength=cluster_count)
            winner = int(votes.argmax())
            if votes[winner] > len(adjacent) / 2:
                updated[face] = winner
        if np.array_equal(updated, labels):
            break
        labels = updated
    return labels


def dilate(mask):
    padded = np.pad(mask, 1)
    rows = padded[:, :-2] | padded[:, 1:-1] | padded[:, 2:]
    return rows[:-2] | rows[1:-1] | rows[2:]


def fill_unused_texels(mask, excluded, steps=64):
    """Return a copy of `mask` grown by up to `steps` px into texels outside `mask` and `excluded`, each joining `mask` when it is nearer to `mask` than to `excluded`, without changing `mask` or `excluded` texels."""
    mask = mask.copy()
    claimed = mask | excluded
    for _ in range(steps):
        if claimed.all():
            break
        grown = dilate(mask) & ~claimed
        blocked = dilate(claimed & ~mask) & ~claimed
        mask |= grown & ~blocked
        claimed |= grown | blocked
    return mask


def save_mask(mask, path):
    height, width = mask.shape
    output = np.ones((height, width, 4), dtype=np.float32)
    output[:, :, :3] = mask[:, :, None]
    mask_image = bpy.data.images.new('color-mask', width, height)
    glb_io.set_image_pixels(mask_image, output)
    mask_image.filepath_raw = str(path)
    mask_image.file_format = 'PNG'
    mask_image.save()
    bpy.data.images.remove(mask_image)


def alpha_estimate(socket, texture_alpha):
    if not socket.is_linked:
        return socket.default_value
    node = socket.links[0].from_node
    if node.type == 'MATH' and node.operation == 'MULTIPLY':
        return alpha_estimate(node.inputs[0], texture_alpha) * alpha_estimate(node.inputs[1], texture_alpha)
    if node.type == 'TEX_IMAGE':
        return texture_alpha
    return 1.0


def is_transparent(material, texture_alpha):
    socket = glb_io.base_alpha_socket(material)
    return socket is not None and alpha_estimate(socket, texture_alpha) < 0.5


def write_color_mask(image, path):
    """Write the recolour mask of `image` to `path` and return the flat mask, `referenceLuma`, and the flat texels under any face."""
    pixels = glb_io.image_pixels(image)
    height, width = pixels.shape[:2]
    rgba = pixels.reshape(-1, 4)
    faces = []
    edges = defaultdict(list)
    materials = {}
    material_faces = defaultdict(list)
    skipped = 0
    for obj in glb_io.mesh_objects():
        mesh = obj.data
        mesh.calc_loop_triangles()
        world = np.array(obj.matrix_world)
        vertices = np.array([vertex.co for vertex in mesh.vertices]) @ world[:3, :3].T + world[:3, 3]
        _, welded = np.unique(np.round(vertices, 6), axis=0, return_inverse=True)
        uvs = {}
        for triangle in mesh.loop_triangles:
            if triangle.index % 20000 == 0:
                print(f"Mask {obj.name}: {triangle.index}/{len(mesh.loop_triangles)} faces", flush=True)
            positions = vertices[list(triangle.vertices)]
            area = np.linalg.norm(np.cross(positions[1] - positions[0], positions[2] - positions[0])) / 2
            if area <= 0:
                continue
            material = mesh.materials[triangle.material_index]
            if material.name not in materials:
                node = glb_io.base_color_node(material)
                if node is None or node.image != image:
                    raise ValueError('colour mask requires one base colour atlas')
                materials[material.name] = (material, node, glb_io.texture_wrap_modes(node))
            _, node, modes = materials[material.name]
            if material.name not in uvs:
                uvs[material.name] = glb_io.base_color_uvs(obj, node)
            uv = uvs[material.name][list(triangle.loops)]
            texels = triangle_texels(uv, width, height, modes)
            if texels is None:
                skipped += 1
                continue
            texels = texels[rgba[texels, 3] > 0]
            if not len(texels):
                continue
            face = len(faces)
            faces.append((material.name, area, rgba[texels, :3].mean(axis=0), texels))
            material_faces[material.name].append((area, obj, list(triangle.loops)))
            ids = welded[list(triangle.vertices)]
            for a, b in zip(ids, np.roll(ids, -1)):
                edges[(obj.name, min(a, b), max(a, b))].append(face)
    if skipped:
        print(f"Mask: skipped {skipped} faces whose UVs span more than 4 texture repeats", flush=True)
    if not faces and skipped:
        visible = rgba[:, 3] > 0
        save_mask(np.ones((height, width), dtype=bool), path)
        return np.ones(width * height, dtype=bool), max(float(np.median(rgba[visible, :3] @ [0.3, 0.59, 0.11])), 1 / 255), visible
    if not faces:
        raise ValueError('the base colour atlas has no visible surface texels')
    areas = np.array([face[1] for face in faces])
    colors = np.array([face[2] for face in faces])
    names = sorted({face[0] for face in faces})
    if len(names) > 1:
        groups = np.array([names.index(face[0]) for face in faces])
        group_areas = np.bincount(groups, weights=areas)
        group_colors = np.array([np.average(colors[groups == i], axis=0, weights=areas[groups == i])
                                 for i in range(len(names))])
        face_alphas = np.array([rgba[face[3], 3].mean() for face in faces])
        group_alphas = [np.average(face_alphas[groups == i], weights=areas[groups == i]) for i in range(len(names))]
        candidates = [index for index, name in enumerate(names)
                      if metallic_factor(materials[name][0], material_faces[name]) < 0.5
                      and not is_transparent(materials[name][0], group_alphas[index])] or list(range(len(names)))
        group_labels = np.full(len(names), -1)
        group_labels[candidates] = cluster_colors(group_colors[candidates], group_areas[candidates],
                                                  split_neutral_at_gaps=False)
        labels = group_labels[groups]
    else:
        labels = smooth_labels(cluster_colors(colors, areas, split_neutral_at_gaps=True), edges)
    largest = int(np.bincount(labels[labels >= 0], weights=areas[labels >= 0]).argmax())
    selected = np.zeros(width * height, dtype=bool)
    excluded = selected.copy()
    for label, face in zip(labels, faces):
        (selected if label == largest else excluded)[face[3]] = True
    reference_luma = max(float(np.median(rgba[selected, :3] @ [0.3, 0.59, 0.11])), 1 / 255)
    mask = fill_unused_texels(selected.reshape(height, width), (excluded & ~selected).reshape(height, width),
                              steps=64 if len(names) == 1 else 2)
    save_mask(mask, path)
    return mask.ravel(), reference_luma, selected | excluded
