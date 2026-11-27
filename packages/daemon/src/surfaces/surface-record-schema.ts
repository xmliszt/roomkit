import { ChatBlockSchema } from "@planner/shared/src/chat/chat-block-schema.ts";
import { CommandSchema } from "@planner/shared/src/commands/command-schema.ts";
import { SurfaceJobSchema } from "@planner/shared/src/jobs/job-schema.ts";
import { IdSchema } from "@planner/shared/src/scene/id-schema.ts";
import { RoomSchema } from "@planner/shared/src/scene/room-schema.ts";
import { z } from "zod";

export const SurfaceRecordSchema = z.object({
  job: SurfaceJobSchema,
  room: RoomSchema,
  photoIds: z.array(IdSchema),
  reconstructionJobId: IdSchema.optional(),
  prompt: z.string(),
  assetId: IdSchema,
  attempt: z.number().int().min(0).max(2),
  gateFailure: z.string().optional(),
  outcome: z
    .discriminatedUnion("kind", [
      z.object({
        kind: z.literal("prepared"),
        command: CommandSchema,
        block: ChatBlockSchema,
      }),
      z.object({
        kind: z.literal("applied"),
        command: CommandSchema,
        block: ChatBlockSchema,
        revision: z.number().int().nonnegative(),
      }),
    ])
    .optional(),
});
export type SurfaceRecord = z.infer<typeof SurfaceRecordSchema>;
