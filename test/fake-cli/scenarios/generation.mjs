import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";

export function steps(options) {
  const job = JSON.parse(readFileSync(join(process.cwd(), "job.json"), "utf8"));
  const hasFeedback = options.prompt.includes("Wrong proportions:");
  if (process.env.B10_CALLS)
    appendFileSync(
      process.env.B10_CALLS,
      `${JSON.stringify({ name: job.name, pid: process.pid, hasFeedback })}\n`,
    );
  if (job.name === "Fallback" && hasFeedback)
    return [{ kind: "text", text: "Gave up without a model." }];
  const pause =
    job.name === "Resume" &&
    process.env.B10_CONTROL &&
    JSON.parse(readFileSync(process.env.B10_CONTROL, "utf8")).pause;
  const script = `import bpy, json, sys
from pathlib import Path
args = sys.argv[sys.argv.index('--') + 1:]
job = json.loads(Path(args[args.index('--job') + 1]).read_text())
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
s = job['sizeM']
w, d, h = s['width'], s['depth'], s['height']
if job['name'] in ('Wrong', 'Fallback'): d = d * 0.1
bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, h/2))
obj = bpy.context.object
obj.scale = (w, d, h)
bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
mat = bpy.data.materials.new('fabric')
mat.use_nodes = True
image = bpy.data.images.new('texture', width=16, height=16)
image.pixels = [value for i in range(256) for value in (0.45 + (i % 4)*0.02, 0.45, 0.45, 1)]
image.pack()
tex = mat.node_tree.nodes.new('ShaderNodeTexImage')
tex.image = image
mat.node_tree.links.new(tex.outputs['Color'], mat.node_tree.nodes.get('Principled BSDF').inputs['Base Color'])
obj.data.materials.append(mat)
bpy.ops.export_scene.gltf(filepath=str(Path.cwd() / 'raw.glb'), export_format='GLB')
`;
  return [
    { kind: "tool", name: "modeler_read", arguments: { path: "job.json" } },
    ...(pause ? [{ kind: "sleep", durationMs: 60000 }] : []),
    {
      kind: "tool",
      name: "modeler_write",
      arguments: { path: "model.py", text: script },
    },
    {
      kind: "tool",
      name: "modeler_write",
      arguments: {
        path: "notes.md",
        text: "Fixture: textured box, one round.",
      },
    },
    { kind: "tool", name: "blender_run", arguments: { path: "model.py" } },
    { kind: "tool", name: "asset_submit" },
    { kind: "text", text: "Submitted fixture model." },
  ];
}
