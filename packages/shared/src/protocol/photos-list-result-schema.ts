import { z } from "zod";
import { PhotoSchema } from "../photos/photo-schema.ts";

export const PhotosListResultSchema = z
  .object({ photos: z.array(PhotoSchema) })
  .strict();
