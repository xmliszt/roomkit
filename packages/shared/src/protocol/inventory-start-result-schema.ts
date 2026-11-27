import { z } from "zod";
import { IdSchema } from "../scene/id-schema.ts";

export const InventoryStartResultSchema = z
  .object({ jobId: IdSchema })
  .strict();
