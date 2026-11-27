import type { Camera } from "@planner/shared/src/scene/camera-schema.ts";

type Vec3 = { x: number; y: number; z: number };

const fovDeg = 32;

function subtract(a: Vec3, b: Vec3) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function dot(a: Vec3, b: Vec3) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function cross(a: Vec3, b: Vec3) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function normalize(a: Vec3) {
  const length = Math.sqrt(dot(a, a));
  return { x: a.x / length, y: a.y / length, z: a.z / length };
}

/** Return the page position of `pointM` as the editor's camera (32° vertical field of view, +Y up) draws it into a full-window canvas. */
export function projectToScreen(options: {
  camera: Camera;
  pointM: Vec3;
  viewport: { width: number; height: number };
}) {
  const { camera, pointM, viewport } = options;
  const forward = normalize(subtract(camera.targetM, camera.positionM));
  const right = normalize(cross(forward, { x: 0, y: 1, z: 0 }));
  const up = cross(right, forward);
  const offset = subtract(pointM, camera.positionM);
  const depth = dot(offset, forward);
  const halfHeight = Math.tan((fovDeg * Math.PI) / 360) * depth;
  const halfWidth = halfHeight * (viewport.width / viewport.height);
  return {
    x: ((dot(offset, right) / halfWidth + 1) / 2) * viewport.width,
    y: ((1 - dot(offset, up) / halfHeight) / 2) * viewport.height,
  };
}
