import { MAX_REFERENCE_PHOTOS } from "@planner/shared/src/generation/max-reference-photos.ts";
import {
  type GenerationRecord,
  GenerationRecordSchema,
} from "./generation-record-schema.ts";

/**
 * Return a copy of `source` with `photoIds` added, deduplicated, and `primaryPhotoId` as its primary when given.
 * Throw for a web, shape or colour source, a `primaryPhotoId` outside the object's photos and `photoIds`,
 * a room-inventory `primaryPhotoId` other than its best view, or more than `MAX_REFERENCE_PHOTOS` photos.
 */
export function mergeSourcePhotos(options: {
  source: GenerationRecord["source"];
  photoIds: string[];
  primaryPhotoId: string | undefined;
}): GenerationRecord["source"] {
  const source = options.source;
  switch (source.kind) {
    case "photo": {
      const all = [
        ...new Set([
          source.photoId,
          ...(source.extraPhotoIds ?? []),
          ...options.photoIds,
        ]),
      ];
      const primary = options.primaryPhotoId ?? source.photoId;
      if (!all.includes(primary))
        throw new Error(
          "primaryPhotoId must be one of the object's photos or the new photoIds",
        );
      if (all.length > MAX_REFERENCE_PHOTOS)
        throw new Error(
          `An object can have at most ${MAX_REFERENCE_PHOTOS} reference photos`,
        );
      const extras = all.filter((photoId) => photoId !== primary);
      return GenerationRecordSchema.shape.source.parse({
        kind: "photo",
        photoId: primary,
        ...(extras.length > 0 ? { extraPhotoIds: extras } : {}),
      });
    }
    case "inventory": {
      if (
        options.primaryPhotoId !== undefined &&
        options.primaryPhotoId !== source.object.bestPhotoId
      )
        throw new Error(
          "A room-inventory object keeps its best view as the primary photo",
        );
      const views = new Set(source.object.views.map((view) => view.photoId));
      const extras = [
        ...new Set([...(source.extraPhotoIds ?? []), ...options.photoIds]),
      ].filter((photoId) => !views.has(photoId));
      if (extras.length >= MAX_REFERENCE_PHOTOS)
        throw new Error(
          `A room-inventory object can have at most ${MAX_REFERENCE_PHOTOS - 1} added photos`,
        );
      return GenerationRecordSchema.shape.source.parse({
        ...source,
        ...(extras.length > 0 ? { extraPhotoIds: extras } : {}),
      });
    }
    case "web":
    case "shape":
    case "color":
      throw new Error(
        "Photos can be added only to an object made from photos or the room inventory",
      );
    default: {
      const unreachable: never = source;
      return unreachable;
    }
  }
}
