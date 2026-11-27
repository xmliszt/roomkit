import { readFileSync } from "node:fs";
import { join } from "node:path";

export function steps() {
  const job = JSON.parse(readFileSync(join(process.cwd(), "job.json"), "utf8"));
  const script = `import sys, os
sys.path.insert(0, 'lib')
from modeler_lib import start, surface, tileable, _write_image
from surfacer_lib import bake_surface, finish_surface
import numpy as np
job = start()
mat = surface('finish', '#ede9df', roughness=0.22, color_noise=0.05, noise_scale=8)
repeat = {'u': 0.8, 'v': 0.8}
bake_surface(job, mat, repeat, size=32)
if job['surfaceId'] == 'floor':
    material = {'kind': 'tiles', 'tileSizeM': repeat, 'groutWidthM': 0.003, 'groutColor': '#a9a6a0', 'baseColor': '#ede9df', 'roughness': 0.22}
else:
    material = {'kind': 'texture', 'repeatSizeM': {'u': 0.5, 'v': 0.6}, 'roughness': 0.8, 'textureAssetId': 'output'}
if 'non-tileable' in job['prompt']:
    pixels = np.ones((32, 32, 4), dtype=np.float32)
    pixels[:, -1, :3] = 0
    _write_image(pixels, os.path.join(job['dir'], 'baseColor.png'))
if 'Sage' in job['prompt']:
    material = {'kind': 'paint', 'color': '#9cae92', 'finish': 'matte'}
finish_surface(job, material.get('color', '#ede9df'), material)
`;
  return [
    { kind: "tool", name: "modeler_read", arguments: { path: "job.json" } },
    ...(job.prompt.includes("pause")
      ? [{ kind: "sleep", durationMs: 60000 }]
      : []),
    {
      kind: "tool",
      name: "modeler_write",
      arguments: { path: "surface.py", text: script },
    },
    {
      kind: "tool",
      name: "modeler_write",
      arguments: {
        path: "notes.md",
        text: "Fixture: 0.8 m tiles; one comparison round.",
      },
    },
    { kind: "tool", name: "blender_run", arguments: { path: "surface.py" } },
    { kind: "tool", name: "asset_submit" },
    { kind: "text", text: "Surface submitted." },
  ];
}
