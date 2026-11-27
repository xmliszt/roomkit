import { getDaemonUrl } from "../daemon-http/get-daemon-url.ts";

/** Return the daemon URL of one file of a project's asset. */
export function getAssetUrl(options: {
  projectId: string;
  assetId: string;
  fileName:
    | "model.glb"
    | "meta.json"
    | "thumb.png"
    | "colorMask.png"
    | "points.bin"
    | "lines.bin";
}) {
  return getDaemonUrl({
    path: `/projects/${options.projectId}/assets/${options.assetId}/${options.fileName}`,
  });
}
