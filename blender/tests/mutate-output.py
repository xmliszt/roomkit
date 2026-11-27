import argparse
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import glb_io

parser = argparse.ArgumentParser()
parser.add_argument('--case', required=True)
parser.add_argument('--kind', choices=['uv', 'lines'], required=True)
args = parser.parse_args(glb_io.script_args())
directory = Path(args.case)
if args.kind == 'lines':
    (directory / 'lines.bin').write_bytes(struct.pack('<II6f', 1, 2, *([0] * 6)))
else:
    glb_io.open_glb(str(directory / 'model.glb'))
    for obj in glb_io.mesh_objects():
        for layer in obj.data.uv_layers:
            for loop in layer.data:
                loop.uv = (0, 0)
    glb_io.export_glb(str(directory / 'model.glb'))
