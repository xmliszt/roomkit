import { z } from "zod";

export const CommandAckSchema = z.discriminatedUnion("ok", [
  z.object({
    type: z.literal("command.ack"),
    requestId: z.string().min(1),
    ok: z.literal(true),
    result: z.unknown().optional(),
  }),
  z.object({
    type: z.literal("command.ack"),
    requestId: z.string().min(1),
    ok: z.literal(false),
    error: z.string().min(1),
    issues: z
      .array(
        z.object({
          path: z.array(z.union([z.string(), z.number()])),
          message: z.string(),
          code: z.string(),
        }),
      )
      .optional(),
  }),
]);

export type CommandAck = z.infer<typeof CommandAckSchema>;
