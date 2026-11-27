import { z } from "zod";
export const WorkerProcessSchema = z.object({
  pid: z.number().int().positive(),
  identity: z.object({ bootId: z.string(), startedAt: z.string() }),
});
