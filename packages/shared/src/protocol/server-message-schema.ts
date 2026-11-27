import { z } from "zod";
import { AppLocaleSchema } from "../i18n/app-locale.ts";
import {
  AuthErrorMessageSchema,
  AuthOkMessageSchema,
} from "./auth-message-schema.ts";
import { CommandAckSchema } from "./command-ack-schema.ts";
import { PlannerEventSchema } from "./planner-event-schema.ts";
import { SnapshotMessageSchema } from "./snapshot-message-schema.ts";

export const EventMessageSchema = z.object({
  type: z.literal("event"),
  event: PlannerEventSchema,
});

export const ServerMessageSchema = z.union([
  SnapshotMessageSchema,
  EventMessageSchema,
  z
    .object({ type: z.literal("language.changed"), locale: AppLocaleSchema })
    .strict(),
  CommandAckSchema,
  AuthOkMessageSchema,
  AuthErrorMessageSchema,
]);

export type ServerMessage = z.infer<typeof ServerMessageSchema>;
