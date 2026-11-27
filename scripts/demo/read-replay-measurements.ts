import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AssetMetaSchema } from "@planner/shared/src/scene/asset-meta-schema.ts";
import { ItemSchema } from "@planner/shared/src/scene/item-schema.ts";
import { PlacementSchema } from "@planner/shared/src/scene/placement-schema.ts";
import { SizeSchema } from "@planner/shared/src/scene/size-schema.ts";
import { z } from "zod";

export function readReplayMeasurements(snapshot: string) {
  const saved = z
    .object({
      objects: z.array(
        z.object({
          objectId: z.string(),
          sizeM: SizeSchema,
          placement: PlacementSchema,
        }),
      ),
    })
    .parse(
      JSON.parse(
        readFileSync(join(snapshot, "inventory", "measurement.json"), "utf8"),
      ),
    );
  const replay = z
    .object({
      entries: z.array(
        z.object({
          objectId: z.string(),
          sourceObjectId: z.string().optional(),
          item: ItemSchema,
        }),
      ),
    })
    .parse(JSON.parse(readFileSync(join(snapshot, "replay.json"), "utf8")));
  return {
    objects: replay.entries
      .filter((entry) => entry.sourceObjectId)
      .map((entry) => {
        const original = saved.objects.find(
          (object) => object.objectId === entry.sourceObjectId,
        );
        assert.ok(original, `No saved measurement for ${entry.sourceObjectId}`);
        const sizeM =
          entry.item.model.kind === "asset"
            ? AssetMetaSchema.parse(
                JSON.parse(
                  readFileSync(
                    join(
                      snapshot,
                      "assets",
                      entry.item.model.assetId,
                      "meta.json",
                    ),
                    "utf8",
                  ),
                ),
              ).nativeSizeM
            : original.sizeM;
        return {
          ...original,
          objectId: entry.objectId,
          sizeM,
          placement: entry.item.placement,
        };
      }),
    failures: [],
  };
}
