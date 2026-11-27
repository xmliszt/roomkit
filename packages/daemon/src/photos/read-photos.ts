import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PhotosSchema } from "@planner/shared/src/photos/photo-schema.ts";

export function readPhotos(projectFolder: string) {
  const path = join(projectFolder, "photos", "photos.json");
  return existsSync(path)
    ? PhotosSchema.parse(JSON.parse(readFileSync(path, "utf8"))).photos
    : [];
}
