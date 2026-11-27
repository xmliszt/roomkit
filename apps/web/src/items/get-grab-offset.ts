import type { Placement } from "@planner/shared/src/scene/placement-schema.ts";
import type { GrabOffset } from "./grab-offset.ts";
import type { SurfaceHit } from "./surface-hit.ts";

/** Return how far the anchor of `placement` is from `hit`, or `undefined` when `hit` is on a different kind of surface. */
export function getGrabOffset(options: {
  placement: Placement;
  hit: SurfaceHit;
}): GrabOffset | undefined {
  const { placement, hit } = options;
  if (placement.kind === "wall" && hit.kind === "wall") {
    return {
      firstM: placement.alongM - hit.alongM,
      secondM: placement.heightM - hit.heightM,
    };
  }
  if (placement.kind !== "wall" && hit.kind === "horizontal") {
    return { firstM: placement.xM - hit.xM, secondM: placement.zM - hit.zM };
  }
  return undefined;
}
