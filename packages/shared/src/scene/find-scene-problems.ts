import type { Scene } from "./scene-schema.ts";

/** Return one message for each rule the scene breaks that its field types cannot express; an empty list when it breaks none. */
export function findSceneProblems(scene: Scene) {
  const walls = scene.room.walls;
  const wallIds = walls.map((wall) => wall.id);
  const itemIds = scene.items.map((item) => item.id);
  const reservedIds = wallIds.filter(
    (id) => id === "floor" || id === "ceiling",
  );
  const duplicateWallIds = wallIds.filter(
    (id, index) => wallIds.indexOf(id) !== index,
  );
  const duplicateItemIds = itemIds.filter(
    (id, index) => itemIds.indexOf(id) !== index,
  );
  const jobIds = scene.items.flatMap((item) =>
    item.model.kind === "pending" ? [item.model.jobId] : [],
  );
  const sharedJobIds = jobIds.filter(
    (id, index) => jobIds.indexOf(id) !== index,
  );
  const zeroLengthWalls = walls.filter((wall, index) => {
    const next = walls.at((index + 1) % walls.length);
    return (
      next !== undefined &&
      next.startM.x === wall.startM.x &&
      next.startM.z === wall.startM.z
    );
  });
  const doubleAreaM2 = walls.reduce((sum, wall, index) => {
    const next = walls.at((index + 1) % walls.length) ?? wall;
    return sum + wall.startM.x * next.startM.z - next.startM.x * wall.startM.z;
  }, 0);
  const itemProblems = scene.items.flatMap((item) => {
    if (item.placement.kind !== "wall")
      return item.cutsOpening === undefined
        ? []
        : [`Item ${item.id} must be on a wall to set cutsOpening`];
    const wallId = item.placement.wallId;
    const wall = walls.find((candidate) => candidate.id === wallId);
    if (wall === undefined)
      return [`Item ${item.id} is on wall ${wallId}, which does not exist`];
    if (wall.kind === "open")
      return [`Item ${item.id} is on wall ${wallId}, which is open`];
    return [];
  });
  const surfaceProblems = Object.keys(scene.room.surfaces)
    .filter(
      (surfaceId) =>
        surfaceId !== "floor" &&
        surfaceId !== "ceiling" &&
        !wallIds.includes(surfaceId),
    )
    .map((surfaceId) => `Surface ${surfaceId} is not floor, ceiling or a wall`);
  return [
    ...(doubleAreaM2 < 0 ? [] : ["Walls do not run counter-clockwise"]),
    ...reservedIds.map((id) => `Wall id ${id} is reserved`),
    ...duplicateWallIds.map((id) => `Wall id ${id} is used more than once`),
    ...duplicateItemIds.map((id) => `Item id ${id} is used more than once`),
    ...sharedJobIds.map((id) => `Job ${id} fills more than one item`),
    ...zeroLengthWalls.map((wall) => `Wall ${wall.id} has no length`),
    ...itemProblems,
    ...surfaceProblems,
  ];
}
