import type { GenerationRecord } from "./generation-record-schema.ts";

/** Return the photo IDs a generation source uses, primary or best view first. */
export function getSourcePhotoIds(source: GenerationRecord["source"]) {
  switch (source.kind) {
    case "photo":
      return [...new Set([source.photoId, ...(source.extraPhotoIds ?? [])])];
    case "inventory":
      return [
        ...new Set([
          ...source.object.views
            .map((view) => view.photoId)
            .toSorted(
              (a, b) =>
                Number(b === source.object.bestPhotoId) -
                Number(a === source.object.bestPhotoId),
            ),
          ...(source.extraPhotoIds ?? []),
        ]),
      ];
    case "web":
    case "shape":
    case "color":
      return [];
    default: {
      const unreachable: never = source;
      return unreachable;
    }
  }
}
