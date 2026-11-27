import { z } from "zod";
import { CameraSchema } from "./camera-schema.ts";
import { findSceneProblems } from "./find-scene-problems.ts";
import { ItemSchema } from "./item-schema.ts";
import { RoomSchema } from "./room-schema.ts";

export const SceneShapeSchema = z
  .object({
    version: z.literal(1),
    room: RoomSchema,
    items: z.array(ItemSchema),
    camera: CameraSchema,
  })
  .strict();

export type Scene = z.infer<typeof SceneShapeSchema>;

export const SceneSchema = SceneShapeSchema.superRefine((scene, context) => {
  for (const message of findSceneProblems(scene))
    context.addIssue({ code: z.ZodIssueCode.custom, message });
});
