import type { Placement } from "@planner/shared/src/scene/placement-schema.ts";
import type { GrabOffset } from "./grab-offset.ts";
import { snapToGrid } from "./snap-to-grid.ts";
import type { SurfaceHit } from "./surface-hit.ts";

/** Return `placement` with its anchor moved to `hit` plus `offset`, snapped to 0.05 m when `isSnapping`, keeping its rotation and elevation; a wall item may change wall and never goes below the floor. Return `undefined` when `hit` is on a surface the placement cannot use. */
export function getDraggedPlacement(options: {
  placement: Placement;
  hit: SurfaceHit;
  offset: GrabOffset;
  isSnapping: boolean;
}): Placement | undefined {
  const { placement, hit, offset } = options;
  function round(valueM: number) {
    return options.isSnapping ? snapToGrid(valueM) : valueM;
  }
  if (placement.kind === "wall" && hit.kind === "wall") {
    return {
      ...placement,
      wallId: hit.wallId,
      alongM: round(hit.alongM + offset.firstM),
      heightM: Math.max(0, round(hit.heightM + offset.secondM)),
    };
  }
  if (placement.kind !== "wall" && hit.kind === "horizontal") {
    return {
      ...placement,
      xM: round(hit.xM + offset.firstM),
      zM: round(hit.zM + offset.secondM),
    };
  }
  return undefined;
}
