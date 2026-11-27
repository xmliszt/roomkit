import { CHARGING_PORT_TYPES } from "@planner/shared/src/catalog/charging-port-types.ts";
import { PhotoBoxSchema } from "@planner/shared/src/photos/photo-box-schema.ts";
import { PhotoSchema } from "@planner/shared/src/photos/photo-schema.ts";
import type { Project } from "@planner/shared/src/project/project-schema.ts";
import {
  type ItemSourcesResult,
  ItemSourcesResultSchema,
} from "@planner/shared/src/protocol/item-sources-result-schema.ts";
import { z } from "zod";
import { getSourceOrigin } from "./get-source-origin.ts";
import { readGenerationRecords } from "./read-generation-records.ts";
import { readItemSource } from "./read-item-source.ts";
import { readObjectJson } from "./read-object-json.ts";
import { readSavedGenerationReference } from "./read-saved-generation-reference.ts";

export function readItemSources(options: {
  folder: string;
  project: Project;
  itemId?: string;
}) {
  const items = options.project.scene.items.filter(
    (item) => options.itemId === undefined || item.id === options.itemId,
  );
  if (options.itemId && items.length === 0) throw new Error("Unknown item");
  const records = readGenerationRecords({
    folder: options.folder,
    projectId: options.project.id,
  });
  const manifest = z
    .object({ photos: z.array(z.unknown()) })
    .safeParse(
      readObjectJson({ folder: options.folder, path: "photos/photos.json" }),
    );
  const photos = (manifest.success ? manifest.data.photos : []).flatMap(
    (entry) => {
      const photo = PhotoSchema.safeParse(entry);
      return photo.success ? [photo.data] : [];
    },
  );
  return ItemSourcesResultSchema.parse({
    items: items.map((item) => {
      const model = item.model;
      const isCatalog =
        model.kind === "asset" &&
        CHARGING_PORT_TYPES.some((entry) => entry.assetId === model.assetId);
      const saved = isCatalog
        ? undefined
        : readItemSource({ folder: options.folder, item, records });
      const source = (() => {
        const regenerated = records.findLast(
          (record) =>
            record.job.kind === "generation" &&
            record.job.itemId === item.id &&
            record.regeneration !== undefined,
        )?.source;
        return regenerated?.kind === saved?.source.kind &&
          (regenerated?.kind === "photo" || regenerated?.kind === "inventory")
          ? regenerated
          : saved?.source;
      })();
      const original = records.findLast((record) =>
        model.kind === "asset"
          ? record.assetId === model.assetId
          : record.job.id === model.jobId,
      );
      const reference =
        item.model.kind === "asset"
          ? readSavedGenerationReference({
              folder: options.folder,
              assetId: item.model.assetId,
            })
          : original?.source;
      const origin = getSourceOrigin({
        source,
        isCatalog,
        isVariant:
          reference?.kind === "color" ||
          reference?.kind === "shape" ||
          original?.source.kind === "color" ||
          original?.source.kind === "shape",
      });
      const sources: ItemSourcesResult["items"][number]["photos"] = (() => {
        switch (source?.kind) {
          case "inventory":
            return [
              ...source.object.views
                .toSorted(
                  (a, b) =>
                    Number(b.photoId === source.object.bestPhotoId) -
                    Number(a.photoId === source.object.bestPhotoId),
                )
                .flatMap((view) => {
                  const photo = photos.find(
                    (photo) => photo.photoId === view.photoId,
                  );
                  if (photo?.kind !== "accepted") return [];
                  const box = PhotoBoxSchema.safeParse([
                    view.box[0] / photo.visionWidthPx,
                    view.box[1] / photo.visionHeightPx,
                    view.box[2] / photo.visionWidthPx,
                    view.box[3] / photo.visionHeightPx,
                  ]);
                  if (!box.success) return [];
                  return [
                    {
                      kind: "photo",
                      photoId: view.photoId,
                      box: box.data,
                      isBest: view.photoId === source.object.bestPhotoId,
                      cropUrl: `/projects/${options.project.id}/photos/${view.photoId}/crop?box=${box.data.join(",")}&size=256`,
                    } satisfies ItemSourcesResult["items"][number]["photos"][number],
                  ];
                }),
              ...(source.extraPhotoIds ?? [])
                .filter(
                  (photoId) =>
                    photos.find((photo) => photo.photoId === photoId)?.kind ===
                    "accepted",
                )
                .map(
                  (photoId) =>
                    ({
                      kind: "photo",
                      photoId,
                      isBest: false,
                    }) satisfies ItemSourcesResult["items"][number]["photos"][number],
                ),
            ];
          case "photo":
            return [
              ...new Set([
                source.photoId,
                ...(source.extraPhotoIds ?? []).filter(
                  (photoId) =>
                    photos.find((photo) => photo.photoId === photoId)?.kind ===
                    "accepted",
                ),
              ]),
            ].map(
              (photoId) =>
                ({
                  kind: "photo",
                  photoId,
                  isBest: photoId === source.photoId,
                }) satisfies ItemSourcesResult["items"][number]["photos"][number],
            );
          case "web":
            return [
              {
                kind: "web",
                imageUrl: `/projects/${options.project.id}/items/${item.id}/sources/0`,
                sourceUrl: source.sourceUrl,
                isBest: true,
              },
            ];
          case "shape":
          case undefined:
            return [];
          default: {
            const unreachable: never = source;
            return unreachable;
          }
        }
      })();
      return { itemId: item.id, origin, photos: sources };
    }),
  });
}
