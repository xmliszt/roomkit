import type { ChatBlock } from "@planner/shared/src/chat/chat-block-schema.ts";
import type { Room } from "@planner/shared/src/scene/room-schema.ts";

export function getCaptureRequestMap(options: {
  room: Room;
  block: Extract<ChatBlock, { kind: "capture-request" }>;
}) {
  const points = [
    ...options.room.walls.map((wall) => wall.startM),
    options.block.standM,
    options.block.lookAtM,
  ];
  const minX = Math.min(...points.map((point) => point.x));
  const maxX = Math.max(...points.map((point) => point.x));
  const minZ = Math.min(...points.map((point) => point.z));
  const maxZ = Math.max(...points.map((point) => point.z));
  const spanM = Math.max(maxX - minX, maxZ - minZ);
  const paddingM = spanM * 0.12;
  const dx = options.block.lookAtM.x - options.block.standM.x;
  const dz = options.block.lookAtM.z - options.block.standM.z;
  const lengthM = Math.hypot(dx, dz);
  const arrowM = spanM * 0.045;
  const direction =
    lengthM > 0 ? { x: dx / lengthM, z: dz / lengthM } : undefined;
  const tip = options.block.lookAtM;
  return {
    viewBox: `${minX - paddingM} ${minZ - paddingM} ${maxX - minX + paddingM * 2} ${maxZ - minZ + paddingM * 2}`,
    floorPoints: options.room.walls
      .map((wall) => `${wall.startM.x},${wall.startM.z}`)
      .join(" "),
    dotRadiusM: spanM * 0.022,
    arrowPoints: direction
      ? `${tip.x},${tip.z} ${tip.x - direction.x * arrowM + (direction.z * arrowM) / 2},${tip.z - direction.z * arrowM - (direction.x * arrowM) / 2} ${tip.x - direction.x * arrowM - (direction.z * arrowM) / 2},${tip.z - direction.z * arrowM + (direction.x * arrowM) / 2}`
      : undefined,
  };
}
