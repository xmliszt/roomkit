import { realpathSync, statSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import type { ChatBlock } from "@planner/shared/src/chat/chat-block-schema.ts";
import { IdSchema } from "@planner/shared/src/scene/id-schema.ts";
import { readPhotos } from "./read-photos.ts";

export function getChatPhotos(options: {
  projectFolder: string;
  photoIds: string[];
}) {
  if (options.photoIds.length === 0) return [];
  const photos = readPhotos(options.projectFolder);
  const folder = realpathSync(join(options.projectFolder, "photos", "vision"));
  const project = realpathSync(options.projectFolder);
  const relativeFolder = relative(project, folder);
  if (relativeFolder.startsWith("..") || isAbsolute(relativeFolder))
    throw new Error("Photo copies must be inside the project");
  return options.photoIds.map((id) => {
    const photoId = IdSchema.parse(id);
    const photo = photos.find((entry) => entry.photoId === photoId);
    if (photo?.kind !== "accepted")
      throw new Error(`Photo is not available in this project: ${photoId}`);
    const path = realpathSync(join(folder, `${photoId}.jpg`));
    const inside = relative(folder, path);
    if (
      inside.startsWith("..") ||
      isAbsolute(inside) ||
      !statSync(path).isFile()
    )
      throw new Error("Photo is outside the copies folder");
    return {
      path,
      block: {
        kind: "image",
        photoId,
        fileName: photo.sourceFileName,
        sizeBytes: statSync(
          join(options.projectFolder, "photos", photo.sourceFileName),
        ).size,
      } satisfies ChatBlock,
    };
  });
}
