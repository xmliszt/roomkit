import type { Placement } from "@planner/shared/src/scene/placement-schema.ts";
import type { Room } from "@planner/shared/src/scene/room-schema.ts";
import { getDraggedPlacement } from "../items/get-dragged-placement.ts";
import type { SurfaceHit } from "../items/surface-hit.ts";
import type { Vec3 } from "../items/vec3.ts";
import { getWallSegments } from "../room/get-wall-segments.ts";

export function getNudgedPlacement(options: {
  placement: Placement;
  widthM: number;
  room: Room;
  right: Vec3;
  horizontal: number;
  vertical: number;
  stepM: number;
  isSnapping: boolean;
}) {
  const { placement, right } = options;
  const length = Math.hypot(right.x, right.z);
  if (length < 0.0001) return placement;
  const x =
    (right.x * options.horizontal + right.z * options.vertical) / length;
  const z =
    (right.z * options.horizontal - right.x * options.vertical) / length;
  const hit: SurfaceHit | undefined = (() => {
    if (placement.kind !== "wall") {
      const alongX = Math.abs(x) >= Math.abs(z);
      return {
        kind: "horizontal",
        xM:
          placement.xM +
          options.stepM *
            (options.isSnapping ? (alongX ? Math.sign(x) : 0) : x),
        zM:
          placement.zM +
          options.stepM *
            (options.isSnapping ? (alongX ? 0 : Math.sign(z)) : z),
      };
    }
    const segment = getWallSegments(options.room).find(
      (entry) => entry.wall.id === placement.wallId,
    );
    if (!segment) return undefined;
    const direction = x * segment.direction.x + z * segment.direction.z;
    const halfWidthM = Math.min(options.widthM, segment.lengthM) / 2;
    const stepM =
      options.stepM * (options.isSnapping ? Math.sign(direction) : direction);
    return {
      kind: "wall",
      wallId: placement.wallId,
      alongM: Math.max(
        halfWidthM,
        Math.min(segment.lengthM - halfWidthM, placement.alongM + stepM),
      ),
      heightM: placement.heightM,
    };
  })();
  if (!hit) return placement;
  return (
    getDraggedPlacement({
      placement,
      hit,
      offset: { firstM: 0, secondM: 0 },
      isSnapping: false,
    }) ?? placement
  );
}
