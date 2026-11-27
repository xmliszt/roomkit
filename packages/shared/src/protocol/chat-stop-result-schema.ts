import { z } from "zod";

export const ChatStopResultSchema = z.object({ stopped: z.boolean() }).strict();

export type ChatStopResult = z.infer<typeof ChatStopResultSchema>;
