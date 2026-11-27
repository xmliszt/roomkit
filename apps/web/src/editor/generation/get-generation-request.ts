import type { Item } from "@planner/shared/src/scene/item-schema.ts";
import type { GenerationAction } from "./generation-action.ts";

export function getGenerationRequest(options: {
  item: Item;
  action: Extract<
    GenerationAction,
    { kind: "color-variant" | "shape-variant" }
  >;
}) {
  const selected = `${options.item.name} (item ${options.item.id})`;
  const action = options.action;
  switch (action.kind) {
    case "color-variant":
      return `Make a colour variant of ${selected} using ${action.color}.`;
    case "shape-variant":
      return `Make a shape variant of ${selected}: ${action.prompt}`;
    default: {
      const unreachable: never = action;
      return unreachable;
    }
  }
}
