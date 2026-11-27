import { ChatBlockSchema } from "@planner/shared/src/chat/chat-block-schema.ts";
import { CommandSchema } from "@planner/shared/src/commands/command-schema.ts";
import { InventoryObjectsSchema } from "@planner/shared/src/inventory/inventory-objects-schema.ts";
import {
  GenerationJobSchema,
  InventoryJobSchema,
} from "@planner/shared/src/jobs/job-schema.ts";
import { IdSchema } from "@planner/shared/src/scene/id-schema.ts";
import { ItemSchema } from "@planner/shared/src/scene/item-schema.ts";
import { RoomSchema } from "@planner/shared/src/scene/room-schema.ts";
import { z } from "zod";

export const InventoryRecordSchema = z.object({
  job: InventoryJobSchema,
  photoIds: z.array(IdSchema),
  scenePath: z.string(),
  camerasPath: z.string(),
  room: RoomSchema,
  submission: InventoryObjectsSchema.optional(),
  outcome: z
    .object({
      items: z.array(ItemSchema),
      objectIds: z.array(IdSchema).optional(),
      generationJobs: z.array(GenerationJobSchema),
      undo: z.array(CommandSchema),
      blocks: z.array(ChatBlockSchema),
      blockStartIndex: z.number().int().nonnegative().optional(),
    })
    .optional(),
});

export type InventoryRecord = z.infer<typeof InventoryRecordSchema>;
