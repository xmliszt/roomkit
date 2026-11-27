import type { Room } from "@planner/shared/src/scene/room-schema.ts";
import { ShapeUtils, Vector2 } from "three";
import { getRoomBounds } from "../../room/get-room-bounds.ts";
import { isInsidePolygon } from "../../room/is-inside-polygon.ts";

type Point = { x: number; z: number };
const clearanceM = 0.12;
const pushMarginM = 0.001;
const maxPushAttempts = 4;

export function createWalkBoundary(room: Room) {
  const polygon = room.walls.map((wall) => wall.startM);
  function getNearestEdgePoint(point: Point) {
    return polygon
      .map((a, index) => {
        const b = polygon.at((index + 1) % polygon.length) ?? a;
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const t = Math.max(
          0,
          Math.min(
            1,
            ((point.x - a.x) * dx + (point.z - a.z) * dz) / (dx * dx + dz * dz),
          ),
        );
        const edgePoint = { x: a.x + t * dx, z: a.z + t * dz };
        return {
          edgePoint,
          distanceM: Math.hypot(point.x - edgePoint.x, point.z - edgePoint.z),
        };
      })
      .reduce((nearest, next) =>
        next.distanceM < nearest.distanceM ? next : nearest,
      );
  }
  function contains(point: Point) {
    return (
      isInsidePolygon({ point, polygon }) &&
      getNearestEdgePoint(point).distanceM >= clearanceM
    );
  }
  function pushInward(point: Point) {
    let pushed = point;
    for (let attempt = 0; attempt < maxPushAttempts; attempt++) {
      if (contains(pushed)) return pushed;
      const { edgePoint, distanceM } = getNearestEdgePoint(pushed);
      if (distanceM === 0) return undefined;
      const scale = (clearanceM + pushMarginM) / distanceM;
      pushed = {
        x: edgePoint.x + (pushed.x - edgePoint.x) * scale,
        z: edgePoint.z + (pushed.z - edgePoint.z) * scale,
      };
    }
    return contains(pushed) ? pushed : undefined;
  }
  function start(target: Point) {
    if (contains(target)) return target;
    const pushed = isInsidePolygon({ point: target, polygon })
      ? pushInward(target)
      : undefined;
    if (pushed) return pushed;
    const bounds = getRoomBounds(room);
    const center = {
      x: (bounds.minX + bounds.maxX) / 2,
      z: (bounds.minZ + bounds.maxZ) / 2,
    };
    if (contains(center)) return center;
    const triangles = ShapeUtils.triangulateShape(
      polygon.map((p) => new Vector2(p.x, p.z)),
      [],
    );
    const centers = triangles.map((indices) => {
      const points = indices.flatMap((index) => polygon.at(index) ?? []);
      return {
        x: points.reduce((sum, p) => sum + p.x, 0) / 3,
        z: points.reduce((sum, p) => sum + p.z, 0) / 3,
      };
    });
    return (
      centers.find(contains) ??
      centers.find((point) => isInsidePolygon({ point, polygon })) ??
      center
    );
  }
  function move(options: { from: Point; xM: number; zM: number }) {
    const steps = Math.max(
      1,
      Math.ceil(Math.hypot(options.xM, options.zM) / 0.02),
    );
    const dx = options.xM / steps;
    const dz = options.zM / steps;
    let point = options.from;
    for (let step = 0; step < steps; step++) {
      const next = { x: point.x + dx, z: point.z + dz };
      if (contains(next)) point = next;
      else {
        const alongX = { x: next.x, z: point.z };
        if (contains(alongX)) point = alongX;
        const alongZ = { x: point.x, z: next.z };
        if (contains(alongZ)) point = alongZ;
      }
    }
    return point;
  }
  return { start, move };
}
