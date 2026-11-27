import { z } from "zod";
import { Vec3Schema } from "./vec3-schema.ts";

export const CameraSchema = z
  .object({ positionM: Vec3Schema, targetM: Vec3Schema })
  .strict();

export type Camera = z.infer<typeof CameraSchema>;
