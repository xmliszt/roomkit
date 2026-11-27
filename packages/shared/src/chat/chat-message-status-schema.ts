import { z } from "zod";

export const ChatMessageStatusSchema = z.enum([
  "streaming",
  "done",
  "failed",
  "stopped",
]);
