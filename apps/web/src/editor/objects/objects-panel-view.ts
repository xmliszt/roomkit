import type { ObjectsLibraryResult } from "@planner/shared/src/protocol/objects-library-result-schema.ts";

export type ObjectsPanelView = {
  filter: "all" | "attention" | "hidden";
  search: string;
  expanded: string | undefined;
  removed: ObjectsLibraryResult["objects"][number] | undefined;
};
