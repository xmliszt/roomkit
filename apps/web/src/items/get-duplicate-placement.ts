import type { Placement } from "@planner/shared/src/scene/placement-schema.ts";
import type { Room } from "@planner/shared/src/scene/room-schema.ts";
import type { Size } from "@planner/shared/src/scene/size-schema.ts";
import { getWallSegments } from "../room/get-wall-segments.ts";
import { isInsidePolygon } from "../room/is-inside-polygon.ts";

const gapM = 0.1;

/** Return `placement` moved sideways by the item's width plus 0.1 m, along the wall for a wall item and along the item's own width axis for a floor or ceiling item; the other way when only that side keeps the copy's width on the wall or inside the room. */
export function getDuplicatePlacement(options: {
  placement: Placement;
  sizeM: Size;
  room: Room;
}): Placement {
  const { placement } = options;
  const shiftM = options.sizeM.width + gapM;
  const halfWidthM = options.sizeM.width / 2;
  if (placement.kind === "wall") {
    const lengthM =
      getWallSegments(options.room).find(
        (segment) => segment.wall.id === placement.wallId,
      )?.lengthM ?? Number.POSITIVE_INFINITY;
    function fits(alongM: number) {
      return alongM - halfWidthM >= 0 && alongM + halfWidthM <= lengthM;
    }
    const forwardM = placement.alongM + shiftM;
    const backwardM = placement.alongM - shiftM;
    return {
      ...placement,
      alongM: !fits(forwardM) && fits(backwardM) ? backwardM : forwardM,
    };
  }
  const axis = {
    x: Math.cos(placement.rotationRad),
    z: -Math.sin(placement.rotationRad),
  };
  const anchorM = { x: placement.xM, z: placement.zM };
  const polygon = options.room.walls.map((wall) => wall.startM);
  function fits(byM: number) {
    return [byM - halfWidthM, byM + halfWidthM].every((edgeM) =>
      isInsidePolygon({
        point: {
          x: anchorM.x + axis.x * edgeM,
          z: anchorM.z + axis.z * edgeM,
        },
        polygon,
      }),
    );
  }
  const byM = !fits(shiftM) && fits(-shiftM) ? -shiftM : shiftM;
  return {
    ...placement,
    xM: placement.xM + axis.x * byM,
    zM: placement.zM + axis.z * byM,
  };
}
