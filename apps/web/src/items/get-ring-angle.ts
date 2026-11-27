import type { Placement } from "@planner/shared/src/scene/placement-schema.ts";
import type { Vec3 } from "./vec3.ts";

/** Return the angle of `pointM` around `anchorM`, measured the way `rotationRad` turns: about world +Y for floor and ceiling items, and about the wall's inward normal (the wall frame turned by `yawRad`) for wall items. */
export function getRingAngle(options: {
  placementKind: Placement["kind"];
  anchorM: Vec3;
  yawRad: number;
  pointM: Vec3;
}) {
  const dx = options.pointM.x - options.anchorM.x;
  const dy = options.pointM.y - options.anchorM.y;
  const dz = options.pointM.z - options.anchorM.z;
  if (options.placementKind !== "wall") return Math.atan2(-dz, dx);
  const along = dx * Math.cos(options.yawRad) - dz * Math.sin(options.yawRad);
  return Math.atan2(dy, along);
}
