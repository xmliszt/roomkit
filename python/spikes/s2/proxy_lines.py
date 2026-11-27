"""Write crease polylines from a simplified proxy of a GLB (DESIGN 6, option 1).

Usage: uv run --project python/spikes/s2 python python/spikes/s2/proxy_lines.py <model.glb> <lines.json> [--faces 2000] [--angle 30]
Output: {"proxyFaces", "segments", "polylines": [[[x, y, z], ...], ...]} sorted longest first.
"""

import argparse
import json
from collections import defaultdict

import fast_simplification
import numpy as np
import trimesh
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components

parser = argparse.ArgumentParser()
parser.add_argument("glb")
parser.add_argument("output")
parser.add_argument("--faces", type=int, default=2000)
parser.add_argument("--angle", type=float, default=30.0)
args = parser.parse_args()

mesh = trimesh.load(args.glb, force="mesh", process=True)
mesh.merge_vertices(merge_tex=True, merge_norm=True)
adjacency = mesh.face_adjacency
_, labels = connected_components(
    coo_matrix((np.ones(len(adjacency)), (adjacency[:, 0], adjacency[:, 1])), shape=(len(mesh.faces),) * 2), directed=False
)
# Generated meshes carry hundreds of tiny floaters that stop the decimator well above the target.
mesh.update_faces(np.bincount(labels)[labels] >= 0.01 * len(mesh.faces))
mesh.remove_unreferenced_vertices()
vertices, faces = fast_simplification.simplify(mesh.vertices.astype(np.float32), mesh.faces.astype(np.int32), target_count=args.faces)
proxy = trimesh.Trimesh(vertices, faces, process=True)

angles = proxy.face_adjacency_angles
crease_edges = proxy.face_adjacency_edges[angles > np.radians(args.angle)]
boundary = proxy.edges_sorted[trimesh.grouping.group_rows(proxy.edges_sorted, require_count=1)]
edges = np.vstack([crease_edges, boundary]) if len(boundary) else crease_edges

neighbours = defaultdict(list)
for a, b in edges:
    neighbours[a].append(b)
    neighbours[b].append(a)
used = set()


def walk(start, nxt):
    path = [start, nxt]
    used.add(frozenset((start, nxt)))
    while len(neighbours[path[-1]]) == 2:
        candidates = [v for v in neighbours[path[-1]] if frozenset((path[-1], v)) not in used]
        if not candidates:
            break
        used.add(frozenset((path[-1], candidates[0])))
        path.append(candidates[0])
    return path


polylines = []
for vertex in sorted(neighbours, key=lambda v: len(neighbours[v]) == 2):
    for other in neighbours[vertex]:
        if frozenset((vertex, other)) not in used:
            polylines.append(walk(vertex, other))

points = [proxy.vertices[line] for line in polylines]
points.sort(key=lambda line: -np.linalg.norm(np.diff(line, axis=0), axis=1).sum())
result = {"proxyFaces": len(proxy.faces), "segments": len(edges), "polylines": [line.round(5).tolist() for line in points]}
open(args.output, "w").write(json.dumps(result))
print(f"proxy {len(proxy.faces)} faces, {len(edges)} crease segments, {len(points)} polylines")
