import { AssetMetaSchema } from "@planner/shared/src/scene/asset-meta-schema.ts";
import { getAssetUrl } from "../../items/get-asset-url.ts";
import { readSurfacePoints } from "./read-surface-points.ts";
import { readTraceLines } from "./read-trace-lines.ts";

export async function loadAppearanceData(options: {
  projectId: string;
  assetId: string;
  signal: AbortSignal;
}) {
  async function get(fileName: "points.bin" | "lines.bin" | "meta.json") {
    const response = await fetch(getAssetUrl({ ...options, fileName }), {
      signal: options.signal,
    });
    if (!response.ok) throw new Error(`Could not load ${fileName}`);
    return response;
  }
  const [meta, points, lines] = await Promise.all([
    get("meta.json")
      .then((response) => response.json())
      .then((json) => AssetMetaSchema.parse(json)),
    get("points.bin")
      .then((response) => response.arrayBuffer())
      .then(readSurfacePoints),
    get("lines.bin")
      .then((response) => response.arrayBuffer())
      .then(readTraceLines),
  ]);
  return { meta, points, lines };
}
