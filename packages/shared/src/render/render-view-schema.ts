import { z } from "zod";
import { IdSchema } from "../scene/id-schema.ts";
import { Vec3Schema } from "../scene/vec3-schema.ts";

export const RenderViewSchema = z
  .object({
    positionM: Vec3Schema,
    targetM: Vec3Schema,
    fovDeg: z.number().finite().gt(0).lt(180),
    aspect: z.number().finite().positive(),
    mode: z.enum(["orbit", "walk"]),
    hiddenSurfaceIds: z.array(IdSchema),
  })
  .strict()
  .refine(
    (view) =>
      Math.hypot(
        view.positionM.x - view.targetM.x,
        view.positionM.y - view.targetM.y,
        view.positionM.z - view.targetM.z,
      ) > 1e-8,
    "Camera position and target must differ",
  );

export type RenderView = z.infer<typeof RenderViewSchema>;
