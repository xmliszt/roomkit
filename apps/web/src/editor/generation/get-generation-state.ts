import { CHARGING_PORT_TYPES } from "@planner/shared/src/catalog/charging-port-types.ts";
import type { Job } from "@planner/shared/src/jobs/job-schema.ts";
import type { Item } from "@planner/shared/src/scene/item-schema.ts";

export function getGenerationState(options: {
  item: Item;
  job: Job | undefined;
}): "held" | "running" | "failed" | "ready" | undefined {
  const { item, job } = options;
  if (item.model.kind === "asset") {
    const assetId = item.model.assetId;
    if (CHARGING_PORT_TYPES.some((entry) => entry.assetId === assetId))
      return undefined;
    return job?.stage === "queued" || job?.stage === "generating"
      ? "running"
      : "ready";
  }
  if (job?.stage === "failed") return "failed";
  if (
    job?.stage === "queued" ||
    job?.stage === "generating" ||
    job?.stage === "ready"
  )
    return "running";
  return "held";
}
