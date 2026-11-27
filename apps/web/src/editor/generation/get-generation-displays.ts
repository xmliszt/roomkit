import type { Job } from "@planner/shared/src/jobs/job-schema.ts";
import type { Item } from "@planner/shared/src/scene/item-schema.ts";
import type { GenerationEntry } from "./generation-entry.ts";
import { getMaxAnimating } from "./get-max-animating.ts";

export function getGenerationDisplays(options: {
  entries: GenerationEntry[];
  items: Item[];
  jobs: { [id: string]: Job };
}) {
  const entries = options.entries.flatMap((entry) => {
    const job = Object.hasOwn(options.jobs, entry.jobId)
      ? options.jobs[entry.jobId]
      : undefined;
    const item = options.items.find((item) => item.id === entry.itemId);
    const stage = job?.kind === "generation" ? job.stage : "queued";
    if (item?.model.kind === "asset" && stage === "failed") return [];
    return [
      {
        ...entry,
        stage,
        progress: job?.progress ?? 0,
        hasAsset: item?.model.kind === "asset",
      },
    ];
  });
  const activeIds = entries
    .filter((entry) => entry.stage === "generating" || entry.stage === "ready")
    .toSorted((a, b) => Number(b.isActive) - Number(a.isActive))
    .slice(0, getMaxAnimating())
    .map((entry) => entry.itemId);
  return entries.map((entry) => ({
    ...entry,
    isActive: activeIds.includes(entry.itemId),
    kind:
      entry.stage === "held"
        ? ("held" as const)
        : entry.stage === "failed"
          ? ("failed" as const)
          : !activeIds.includes(entry.itemId)
            ? ("queued" as const)
            : entry.stage === "ready" && entry.hasAsset
              ? ("ready" as const)
              : ("generating" as const),
  }));
}
