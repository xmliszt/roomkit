import type { Camera } from "@planner/shared/src/scene/camera-schema.ts";

export type CameraReport =
  | { kind: "walk"; camera: Camera }
  | { kind: "loaded"; camera: Camera }
  | { kind: "moved"; camera: Camera };
