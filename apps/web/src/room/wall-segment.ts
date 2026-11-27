import type { Wall } from "@planner/shared/src/scene/wall-schema.ts";

type Vec2 = { x: number; z: number };

export type WallSegment = {
  wall: Wall;
  startM: Vec2;
  endM: Vec2;
  lengthM: number;
  direction: Vec2;
  outward: Vec2;
};
