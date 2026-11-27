import argparse
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import glb_io

parser = argparse.ArgumentParser()
parser.add_argument('--input', required=True)
parser.add_argument('--output', required=True)
args = parser.parse_args(glb_io.script_args())
source_document, _ = glb_io.read_glb(args.input)
result_document, _ = glb_io.read_glb(args.output)
assert sorted(image['mimeType'] for image in source_document['images']) == ['image/jpeg', 'image/png']
assert sorted(image['mimeType'] for image in result_document['images']) == ['image/jpeg', 'image/png'], 'mixed recolor changed texture encoding'
glb_io.open_glb(args.input)
before = {obj.data.materials[0].name: glb_io.image_pixels(glb_io.base_color_node(obj.data.materials[0]).image)
          for obj in glb_io.mesh_objects()}
glb_io.open_glb(args.output)
for obj in glb_io.mesh_objects():
    material = obj.data.materials[0]
    node = glb_io.base_color_node(material)
    after = glb_io.image_pixels(node.image)
    original = before[material.name]
    shade = (original[:, :, :3] @ [0.3, 0.59, 0.11]) / 0.5
    expected = np.clip(shade[:, :, None] * (np.array([30, 80, 230]) / 255), 0, 1)
    error = np.abs(after[:, :, :3] - expected)
    assert (error.mean() < 0.02 if node.image.file_format == 'JPEG' else error.max() < 0.009)
