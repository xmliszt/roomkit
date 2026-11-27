import type { Item } from "@planner/shared/src/scene/item-schema.ts";
import type { GenerationEntry } from "./generation-entry.ts";

export function reconcileGenerationEntries(options: {
  entries: GenerationEntry[];
  items: Item[];
}) {
  const kept = options.entries.flatMap((entry) => {
    const item = options.items.find((item) => item.id === entry.itemId);
    if (!item) return [];
    if (item.model.kind === "asset") return [entry];
    return item.model.jobId === entry.jobId
      ? [{ ...entry, sizeM: item.sizeM }]
      : [];
  });
  const added = options.items.flatMap((item) =>
    item.model.kind === "pending" &&
    !kept.some((entry) => entry.itemId === item.id)
      ? [
          {
            itemId: item.id,
            jobId: item.model.jobId,
            sizeM: item.sizeM,
            isActive: false,
          },
        ]
      : [],
  );
  return [...kept, ...added];
}
