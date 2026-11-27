import { readdirSync } from "node:fs";
import { IdSchema } from "@planner/shared/src/scene/id-schema.ts";

export function listCatalogAssetIds(catalogRoot: string) {
  return new Set(
    readdirSync(catalogRoot, { withFileTypes: true })
      .filter(
        (entry) =>
          entry.isDirectory() && IdSchema.safeParse(entry.name).success,
      )
      .map((entry) => entry.name),
  );
}
