import { IdSchema } from "@planner/shared/src/scene/id-schema.ts";
import { Vec2Schema } from "@planner/shared/src/scene/vec2-schema.ts";
import { WallSchema } from "@planner/shared/src/scene/wall-schema.ts";
import { z } from "zod";

export const ReconstructedRoomSchema = z
  .object({
    walls: z.array(WallSchema).min(3),
    ceilingHeightM: z.number().finite().positive(),
    confidence: z.unknown(),
    scale: z
      .object({ weak: z.boolean(), disagreements: z.array(z.string()) })
      .passthrough(),
  })
  .passthrough();
export const CoverageSchema = z.object({
  surfaces: z.array(z.unknown()),
  captureRequests: z.array(
    z.object({
      surfaceId: IdSchema,
      reason: z.string(),
      standAtM: Vec2Schema,
      lookDirection: z.object({
        x: z.number().finite(),
        y: z.number().finite().optional(),
        z: z.number().finite(),
      }),
    }),
  ),
});
