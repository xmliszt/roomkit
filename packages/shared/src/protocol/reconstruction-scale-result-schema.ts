import { z } from "zod";
import { ScaleSourcesSchema } from "../reconstruction/scale-source-schema.ts";

export const ReconstructionScaleResultSchema = z
  .object({ sources: ScaleSourcesSchema })
  .strict();
