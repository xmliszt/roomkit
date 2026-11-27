import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export function steps() {
  const photos = JSON.parse(
    readFileSync(join(process.cwd(), "photos", "photos.json"), "utf8"),
  ).photos.filter(
    (photo) => photo.origin === "capture" && photo.kind === "accepted",
  );
  const bestPhoto = photos.at(0);
  assert.ok(bestPhoto);
  const objects = [
    { objectId: "sofa", name: "Sofa", mount: "floor" },
    { objectId: "tv", name: "TV", mount: "wall" },
    { objectId: "lamp", name: "Floor lamp", mount: "floor" },
  ].map((object) => ({
    ...object,
    bestPhotoId: bestPhoto.photoId,
    views: photos.map((photo) => ({
      photoId: photo.photoId,
      box: [
        0,
        0,
        Math.floor(photo.visionWidthPx / 2),
        Math.floor(photo.visionHeightPx / 2),
      ],
      visibility:
        object.objectId === "lamp" ? "more-than-half-hidden" : "mostly-visible",
    })),
  }));
  return [
    { kind: "tool", name: "scene_get" },
    { kind: "tool", name: "inventory_submit", arguments: { objects } },
    { kind: "tool", name: "inventory_submit", arguments: { objects } },
    { kind: "text", text: "Found a sofa, TV and floor lamp." },
  ];
}
