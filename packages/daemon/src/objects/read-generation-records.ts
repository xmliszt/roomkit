import { z } from "zod";
import {
  type GenerationRecord,
  GenerationRecordSchema,
} from "../generation/generation-record-schema.ts";
import { readInventoryGenerations } from "../generation/read-inventory-generations.ts";
import { InventoryRecordSchema } from "../inventory/inventory-record-schema.ts";
import { readObjectJson } from "./read-object-json.ts";

export function readGenerationRecords(options: {
  folder: string;
  projectId: string;
}) {
  const saved = z
    .array(z.unknown())
    .safeParse(
      readObjectJson({ folder: options.folder, path: ".planner/jobs.json" }),
    );
  const entries = saved.success ? saved.data : [];
  const records = entries
    .flatMap((entry) => {
      const record = GenerationRecordSchema.safeParse(entry);
      return record.success ? [record.data] : [];
    })
    .filter((record) => record.job.projectId === options.projectId);
  const inventory: GenerationRecord[] = entries
    .flatMap((entry) => {
      const record = InventoryRecordSchema.safeParse(entry);
      if (!record.success || record.data.job.projectId !== options.projectId)
        return [];
      try {
        return readInventoryGenerations({ ...options, records: [record.data] });
      } catch {
        return [];
      }
    })
    .filter(
      (record) => !records.some((current) => current.job.id === record.job.id),
    );
  return [...inventory, ...records].toSorted(
    (a, b) => Date.parse(a.job.createdAt) - Date.parse(b.job.createdAt),
  );
}
