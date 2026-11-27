import { z } from "zod";
import { IdSchema } from "../scene/id-schema.ts";

export const ObjectsArchiveResultSchema = z
  .object({ assetId: IdSchema })
  .strict();
