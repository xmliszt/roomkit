import { copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { jobFilePath } from "../generation/job-file-path.ts";
import { readPhotos } from "../photos/read-photos.ts";
import { writeJson } from "../util/write-json.ts";
import type { SurfaceRecord } from "./surface-record-schema.ts";

export function prepareSurfaceFolder(options: {
  record: SurfaceRecord;
  projectFolder: string;
  folder: string;
}) {
  for (const dir of ["lib", "photos"])
    mkdirSync(join(options.folder, dir), { recursive: true });
  const blender = fileURLToPath(
    new URL("../../../../blender", import.meta.url),
  );
  for (const file of ["modeler_lib.py", "surfacer_lib.py"])
    copyFileSync(
      join(blender, "procedural", file),
      join(options.folder, "lib", file),
    );
  copyFileSync(
    join(blender, "glb_io.py"),
    join(options.folder, "lib", "glb_io.py"),
  );
  const records = readPhotos(options.projectFolder);
  const photos = options.record.photoIds.map((photoId) => {
    const photo = records.find(
      (photo) =>
        photo.photoId === photoId &&
        photo.kind === "accepted" &&
        photo.origin === "capture",
    );
    if (photo?.kind !== "accepted")
      throw new Error(`Capture photo ${photoId} is unavailable`);
    const path = `photos/${photoId}.jpg`;
    copyFileSync(
      jobFilePath({
        folder: options.projectFolder,
        path: join("photos", photo.visionPath),
      }),
      join(options.folder, path),
    );
    return {
      photoId,
      path,
      widthPx: photo.visionWidthPx,
      heightPx: photo.visionHeightPx,
    };
  });
  writeJson({
    path: join(options.folder, "job.json"),
    value: {
      surfaceId: options.record.job.surfaceId,
      room: options.record.room,
      prompt: options.record.prompt,
      photos,
      helperLibrary: "lib/modeler_lib.py",
      surfaceHelperLibrary: "lib/surfacer_lib.py",
      output: "surface.json",
    },
  });
}
