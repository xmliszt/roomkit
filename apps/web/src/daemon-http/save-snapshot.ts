import { SnapshotSaveResultSchema } from "@planner/shared/src/protocol/snapshot-save-result-schema.ts";
import { getDaemonUrl } from "./get-daemon-url.ts";
import { readErrorText } from "./read-error-text.ts";

/** Save `png` in the project's `snapshots/` through the daemon and return the file name it chose. */
export async function saveSnapshot(options: { projectId: string; png: Blob }) {
  const response = await fetch(
    getDaemonUrl({ path: `/projects/${options.projectId}/snapshots` }),
    { method: "POST", body: options.png },
  );
  if (!response.ok) throw new Error(await readErrorText(response));
  return SnapshotSaveResultSchema.parse(await response.json()).fileName;
}
