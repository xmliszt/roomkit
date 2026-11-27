import { CHARGING_PORT_TYPES } from "@planner/shared/src/catalog/charging-port-types.ts";
import type { Camera } from "@planner/shared/src/scene/camera-schema.ts";
import type { Placement } from "@planner/shared/src/scene/placement-schema.ts";
import type { Room } from "@planner/shared/src/scene/room-schema.ts";
import type { Size } from "@planner/shared/src/scene/size-schema.ts";
import { getCatalogWallPlacement } from "../../items/get-catalog-wall-placement.ts";
import { getRayPlaneHit } from "../../items/get-ray-plane-hit.ts";
import { getWallSegments } from "../../room/get-wall-segments.ts";
import { isInsidePolygon } from "../../room/is-inside-polygon.ts";
import { isWallHidden } from "../../room/is-wall-hidden.ts";

const wallModelCentreHeightM = 1.5;

/** Return the placement for a new item of `model` at the centre of the view, or the room centre when the view centre is outside the room: on the floor, the ceiling, or the nearest wall, preferring walls the camera can see, or `undefined` when the room has no wall for a wall mount. */
export function getLibraryPlacement(options: {
  model: { assetId: string; mount: "floor" | "wall" | "ceiling"; sizeM: Size };
  camera: Camera;
  room: Room;
}): Placement | undefined {
  const { positionM, targetM } = options.camera;
  const polygon = options.room.walls.map((wall) => wall.startM);
  const roomCentre = {
    x: polygon.reduce((sum, point) => sum + point.x, 0) / polygon.length,
    y: 0,
    z: polygon.reduce((sum, point) => sum + point.z, 0) / polygon.length,
  };
  const floorHit = getRayPlaneHit({
    ray: {
      originM: positionM,
      direction: {
        x: targetM.x - positionM.x,
        y: targetM.y - positionM.y,
        z: targetM.z - positionM.z,
      },
    },
    pointM: { x: 0, y: 0, z: 0 },
    normal: { x: 0, y: 1, z: 0 },
  });
  const focus =
    [floorHit, targetM].find(
      (point) => point !== undefined && isInsidePolygon({ point, polygon }),
    ) ?? roomCentre;
  switch (options.model.mount) {
    case "floor":
      return {
        kind: "floor",
        xM: focus.x,
        zM: focus.z,
        elevationM: 0,
        rotationRad: 0,
      };
    case "ceiling":
      return { kind: "ceiling", xM: focus.x, zM: focus.z, rotationRad: 0 };
    case "wall": {
      const mountable = getWallSegments(options.room).filter(
        (segment) => segment.wall.kind !== "open",
      );
      const visible = mountable.filter(
        (segment) => !isWallHidden({ segment, cameraM: positionM }),
      );
      return getCatalogWallPlacement({
        segments: visible.length > 0 ? visible : mountable,
        focusM: focus,
        widthM: options.model.sizeM.width,
        heightM:
          CHARGING_PORT_TYPES.find(
            (entry) => entry.assetId === options.model.assetId,
          )?.defaultHeightM ??
          Math.max(
            options.model.sizeM.height / 2,
            Math.min(
              wallModelCentreHeightM,
              options.room.ceilingHeightM - options.model.sizeM.height / 2,
            ),
          ),
      });
    }
    default: {
      const unreachable: never = options.model.mount;
      return unreachable;
    }
  }
}
