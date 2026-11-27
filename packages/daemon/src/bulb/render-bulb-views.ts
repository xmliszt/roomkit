import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runGenerationProcess } from "../generation/run-generation-process.ts";
import { drawBulbGrid } from "./draw-bulb-grid.ts";

const thumbnailScript = fileURLToPath(
  new URL("../../../../blender/thumbnail.py", import.meta.url),
);
const viewSizePx = 768;

/** Render the front and side orthographic views of `modelPath` into `folder` and return the paths of the gridded PNGs. */
export async function renderBulbViews(options: {
  blender: string;
  modelPath: string;
  folder: string;
  env: NodeJS.ProcessEnv;
  processPath: string;
  signal: AbortSignal;
  onLine: (line: string) => void;
}) {
  async function renderView(entry: {
    view: "front" | "side";
    acrossAxis: "x" | "z";
  }) {
    const render = join(options.folder, `${entry.view}-render.png`);
    const result = await runGenerationProcess({
      command: options.blender,
      args: [
        "--background",
        "--factory-startup",
        "--python-exit-code",
        "1",
        "--python-expr",
        "import sys; sys.dont_write_bytecode = True",
        "--python",
        thumbnailScript,
        "--",
        "--input",
        options.modelPath,
        "--output",
        render,
        "--size",
        String(viewSizePx),
        "--view",
        entry.view,
      ],
      cwd: options.folder,
      env: options.env,
      signal: options.signal,
      processPath: options.processPath,
      timeoutMs: 120_000,
      onLine: options.onLine,
    });
    if (result.code !== 0)
      throw new Error(`Blender could not render the ${entry.view} view`);
    const gridded = join(options.folder, `${entry.view}.png`);
    await drawBulbGrid({
      input: render,
      output: gridded,
      acrossAxis: entry.acrossAxis,
    });
    return gridded;
  }
  const frontPath = await renderView({ view: "front", acrossAxis: "x" });
  const sidePath = await renderView({ view: "side", acrossAxis: "z" });
  return { frontPath, sidePath };
}
