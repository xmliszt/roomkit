import type { Size } from "@planner/shared/src/scene/size-schema.ts";

/** Return `sizeM` as "width × height × depth m" with two decimals. */
export function formatSize(sizeM: Size) {
  return `${sizeM.width.toFixed(2)} × ${sizeM.height.toFixed(2)} × ${sizeM.depth.toFixed(2)} m`;
}
