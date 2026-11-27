import type { Item } from "../scene/item-schema.ts";
import type { Placement } from "../scene/placement-schema.ts";

export function buildItem(options: {
  id: string;
  placement: Placement;
  colorAdjust?: Item["colorAdjust"];
}): Item {
  return {
    id: options.id,
    name: options.id,
    model: { kind: "asset", assetId: `asset-${options.id}` },
    placement: options.placement,
    sizeM: { width: 0.7, height: 0.4, depth: 0.3 },
    ...(options.colorAdjust === undefined
      ? {}
      : { colorAdjust: options.colorAdjust }),
    locked: false,
  };
}
