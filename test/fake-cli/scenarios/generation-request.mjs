import { readFileSync } from "node:fs";
import { join } from "node:path";

export function steps() {
  const photo = JSON.parse(
    readFileSync(join(process.cwd(), "photos", "photos.json"), "utf8"),
  ).photos.at(0);
  return [
    {
      kind: "tool",
      name: "asset_generate",
      arguments: {
        name: "Photo chair",
        prompt: "A chair from the attached photo",
        sizeM: { width: 0.6, height: 0.8, depth: 0.6 },
        placement: {
          kind: "floor",
          xM: 0,
          zM: 0,
          elevationM: 0,
          rotationRad: 0,
        },
        reference: { kind: "photo", photoId: photo.photoId },
      },
    },
    { kind: "text", text: "Queued the chair from your photo." },
  ];
}
