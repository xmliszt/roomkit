import type { Job } from "@planner/shared/src/jobs/job-schema.ts";
import type { Item } from "@planner/shared/src/scene/item-schema.ts";
import { useState } from "react";
import type { GenerationEntry } from "./generation-entry.ts";
import { getGenerationDisplays } from "./get-generation-displays.ts";
import { reconcileGenerationEntries } from "./reconcile-generation-entries.ts";

export function useGenerationDisplays(options: {
  items: Item[];
  jobs: { [id: string]: Job };
}) {
  function nextState(entries: GenerationEntry[]) {
    return {
      items: options.items,
      jobs: options.jobs,
      displays: getGenerationDisplays({
        entries: reconcileGenerationEntries({ entries, items: options.items }),
        items: options.items,
        jobs: options.jobs,
      }),
    };
  }
  const [tracked, setTracked] = useState(() => nextState([]));
  if (tracked.items !== options.items || tracked.jobs !== options.jobs) {
    setTracked(nextState(tracked.displays));
  }
  function complete(itemId: string) {
    setTracked((current) =>
      nextState(current.displays.filter((entry) => entry.itemId !== itemId)),
    );
  }
  return {
    displays: tracked.displays,
    complete,
  };
}
