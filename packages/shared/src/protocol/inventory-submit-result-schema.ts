import { z } from "zod";

export const InventorySubmitResultSchema = z
  .object({ submitted: z.number().int().nonnegative() })
  .strict();
