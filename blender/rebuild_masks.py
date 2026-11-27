import argparse
import json
import sys
from pathlib import Path

import bpy
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import glb_io
from color_mask import write_color_mask

parser = argparse.ArgumentParser()
parser.add_argument('--manifest', required=True)
args = parser.parse_args(glb_io.script_args())


def rebuild(folder, output):
    glb_io.open_static_glb(str(folder / 'model.glb'))
    images = glb_io.base_color_images()
    if len(images) != 1:
        raise ValueError('expected one existing base colour atlas')
    old = bpy.data.images.load(str(folder / 'colorMask.png'), check_existing=False)
    old_mask = glb_io.image_pixels(old)[:, :, 0].ravel() > 0.5
    mask, reference_luma, surface = write_color_mask(images[0], output / 'colorMask.png')
    if len(old_mask) != len(mask):
        raise ValueError('the old mask does not match the atlas size')
    return {'oldCoverage': float(old_mask[surface].mean()), 'newCoverage': float(mask[surface].mean()),
            'referenceLuma': reference_luma}


for asset in json.loads(Path(args.manifest).read_text()):
    folder = Path(asset['folder'])
    output = Path(asset['output'])
    print(f"Rebuilding {folder.name}", flush=True)
    try:
        result = {'id': folder.name, **rebuild(folder, output)}
    except Exception as error:
        result = {'id': folder.name, 'error': str(error)}
    (output / 'result.json').write_text(json.dumps(result))
    glb_io.print_result(result)
