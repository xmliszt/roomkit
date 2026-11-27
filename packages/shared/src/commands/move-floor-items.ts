import type { Item } from "../scene/item-schema.ts";
import type { Placement } from "../scene/placement-schema.ts";
import type { Wall } from "../scene/wall-schema.ts";

function distanceToWallM(options: {
  point: { x: number; z: number };
  start: { x: number; z: number };
  end: { x: number; z: number };
}) {
  const alongX = options.end.x - options.start.x;
  const alongZ = options.end.z - options.start.z;
  const ratio = Math.min(
    1,
    Math.max(
      0,
      ((options.point.x - options.start.x) * alongX +
        (options.point.z - options.start.z) * alongZ) /
        (alongX * alongX + alongZ * alongZ),
    ),
  );
  const offX = options.point.x - (options.start.x + ratio * alongX);
  const offZ = options.point.z - (options.start.z + ratio * alongZ);
  return Math.sqrt(offX * offX + offZ * offZ);
}

/** Return `items` with each placement in `placements` applied as given and, when both wall lists have the same ids in the same order, every other floor item moved by the same distance its nearest wall in `oldWalls` moved along that wall's normal. */
export function moveFloorItems(options: {
  items: Item[];
  oldWalls: Wall[];
  newWalls: Wall[];
  placements: { [itemId: string]: Placement };
}) {
  const hasSameWalls =
    options.oldWalls.length === options.newWalls.length &&
    options.oldWalls.every(
      (wall, index) => wall.id === options.newWalls.at(index)?.id,
    );
  return options.items.map((item) => {
    const given = Object.hasOwn(options.placements, item.id)
      ? options.placements[item.id]
      : undefined;
    if (given !== undefined) return { ...item, placement: given };
    const placement = item.placement;
    if (!hasSameWalls || placement.kind !== "floor") return item;
    const point = { x: placement.xM, z: placement.zM };
    const nearest = options.oldWalls
      .map((wall, index) => {
        const end =
          options.oldWalls.at((index + 1) % options.oldWalls.length) ?? wall;
        return {
          wall,
          end,
          index,
          distanceM: distanceToWallM({
            point,
            start: wall.startM,
            end: end.startM,
          }),
        };
      })
      .reduce((best, candidate) =>
        candidate.distanceM < best.distanceM ? candidate : best,
      );
    const moved = options.newWalls.at(nearest.index);
    if (moved === undefined) return item;
    const alongX = nearest.end.startM.x - nearest.wall.startM.x;
    const alongZ = nearest.end.startM.z - nearest.wall.startM.z;
    const lengthM = Math.sqrt(alongX * alongX + alongZ * alongZ);
    const normalX = -alongZ / lengthM;
    const normalZ = alongX / lengthM;
    const shiftM =
      (moved.startM.x - nearest.wall.startM.x) * normalX +
      (moved.startM.z - nearest.wall.startM.z) * normalZ;
    if (shiftM === 0) return item;
    return {
      ...item,
      placement: {
        ...placement,
        xM: placement.xM + normalX * shiftM,
        zM: placement.zM + normalZ * shiftM,
      },
    };
  });
}
