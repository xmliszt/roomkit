import type { Room } from "@planner/shared/src/scene/room-schema.ts";
import { getRoomBounds } from "./get-room-bounds.ts";
import { getWallSegments } from "./get-wall-segments.ts";
import { isInsidePolygon } from "./is-inside-polygon.ts";

function getStepRange(options: {
  fromM: number;
  toM: number;
  spacingM: number;
}) {
  const first = Math.ceil(options.fromM / options.spacingM);
  const last = Math.floor(options.toM / options.spacingM);
  return { first, count: Math.max(0, last - first + 1) };
}

function toSteps(options: {
  range: { first: number; count: number };
  spacingM: number;
}) {
  return Array.from(
    { length: options.range.count },
    (_, index) => (options.range.first + index) * options.spacingM,
  );
}

/** Return the points of a grid with `spacingM` spacing, aligned to the origin, that lie inside the floor polygon and at least `marginM` from every wall; return none when the grid's bounding box would hold more than `maxDots`. */
export function getFloorDots(options: {
  room: Pick<Room, "walls">;
  spacingM: number;
  marginM: number;
  maxDots: number;
}) {
  const polygon = options.room.walls.map((wall) => wall.startM);
  const segments = getWallSegments(options.room);
  const bounds = getRoomBounds(options.room);
  const columnRange = getStepRange({
    fromM: bounds.minX,
    toM: bounds.maxX,
    spacingM: options.spacingM,
  });
  const rowRange = getStepRange({
    fromM: bounds.minZ,
    toM: bounds.maxZ,
    spacingM: options.spacingM,
  });
  if (columnRange.count * rowRange.count > options.maxDots) return [];
  const columns = toSteps({ range: columnRange, spacingM: options.spacingM });
  const rows = toSteps({ range: rowRange, spacingM: options.spacingM });
  return columns
    .flatMap((x) => rows.map((z) => ({ x, z })))
    .filter(
      (point) =>
        isInsidePolygon({ point, polygon }) &&
        segments.every((segment) => {
          const along =
            (point.x - segment.startM.x) * segment.direction.x +
            (point.z - segment.startM.z) * segment.direction.z;
          const clamped = Math.min(Math.max(along, 0), segment.lengthM);
          const dx =
            point.x - (segment.startM.x + segment.direction.x * clamped);
          const dz =
            point.z - (segment.startM.z + segment.direction.z * clamped);
          return Math.sqrt(dx * dx + dz * dz) >= options.marginM;
        }),
    );
}
