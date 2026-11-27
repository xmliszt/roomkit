import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { InventoryRecordSchema } from "../inventory/inventory-record-schema.ts";
import { readProjectJobRecords } from "../jobs/read-project-job-records.ts";
import type { GenerationRecord } from "./generation-record-schema.ts";

export function readInventoryGenerations(options: {
  folder: string;
  projectId: string;
  records?: { job: { kind: string } }[];
}) {
  return (options.records ?? readProjectJobRecords(options.folder))
    .filter((record) => record.job.kind === "inventory")
    .map((record) => InventoryRecordSchema.parse(record))
    .filter((record) => record.job.stage === "done")
    .flatMap((record) => {
      const outcome = record.outcome;
      if (!outcome) return [];
      const measurementPath = join(
        options.folder,
        ".planner",
        "inventory",
        record.job.id,
        "measurement.json",
      );
      const ids =
        outcome.objectIds ??
        (existsSync(measurementPath)
          ? z
              .object({ objects: z.array(z.object({ objectId: z.string() })) })
              .parse(JSON.parse(readFileSync(measurementPath, "utf8")))
              .objects.map((object) => object.objectId)
          : []);
      return outcome.generationJobs.flatMap((job, index) => {
        const item = outcome.items.find((item) => item.id === job.itemId);
        const object = record.submission?.find(
          (object) => object.objectId === ids.at(index),
        );
        if (!item || !object || ids.length !== outcome.items.length)
          throw new Error(
            `Inventory ${record.job.id} has no reliable generation source mapping`,
          );
        const large =
          Math.max(item.sizeM.width, item.sizeM.height, item.sizeM.depth) > 0.4;
        const appliance =
          /\b(tv|television|air conditioner|air conditioning|heater|fan)\b/i.test(
            object.name,
          );
        const visible = object.views.some(
          (view) => view.visibility === "mostly-visible",
        );
        return [
          {
            job,
            item,
            source: {
              kind: "inventory",
              inventoryJobId: record.job.id,
              object,
            },
            prompt: `Build ${item.name} from its inventory photos.`,
            held: !(
              large &&
              visible &&
              (item.placement.kind === "floor" ||
                (item.placement.kind === "wall" && appliance))
            ),
            attempt: 0,
            assetId: `asset-${job.id}`,
          } satisfies GenerationRecord,
        ];
      });
    });
}
