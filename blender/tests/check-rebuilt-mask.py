import argparse
import json
import sys
from pathlib import Path

import bpy
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import glb_io

parser = argparse.ArgumentParser()
parser.add_argument('--case', required=True)
parser.add_argument('--rebuilt', required=True)
args = parser.parse_args(glb_io.script_args())
case, rebuilt = Path(args.case), Path(args.rebuilt)
result = json.loads((rebuilt / 'result.json').read_text())
assert 'error' not in result, result
expected = glb_io.image_pixels(bpy.data.images.load(str(case / 'colorMask.png')))[:, :, 0] > 0.5
actual = glb_io.image_pixels(bpy.data.images.load(str(rebuilt / 'colorMask.png')))[:, :, 0] > 0.5
assert np.array_equal(actual, expected), f'{case.name}: rebuilt mask differs in {np.sum(actual != expected)} texels'
normalized = json.loads((case / 'result.json').read_text())
assert abs(result['referenceLuma'] - normalized['referenceLuma']) < 1 / 255, (result, normalized)
