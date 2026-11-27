import { z } from "zod";
import { IdSchema } from "../scene/id-schema.ts";

export const PhotoOriginSchema = z.enum(["capture", "chat"]);
const fields = {
  photoId: IdSchema,
  origin: PhotoOriginSchema,
  sourceFileName: z
    .string()
    .regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}\.(jpg|jpeg|png|webp|heic|heif)$/),
  widthPx: z.number().int().positive(),
  heightPx: z.number().int().positive(),
  orientation: z.number().int().min(1).max(8),
  blurScore: z.number().finite().nonnegative(),
  lens: z.string().optional(),
  focalLengthMm: z.number().finite().positive().optional(),
  focalLength35Mm: z.number().finite().positive().optional(),
  focalLengthPx: z.number().finite().positive().optional(),
};
export const PhotoSchema = z
  .discriminatedUnion("kind", [
    z
      .object({
        ...fields,
        kind: z.literal("accepted"),
        uprightPath: z.string(),
        visionPath: z.string(),
        visionWidthPx: z.number().int().positive(),
        visionHeightPx: z.number().int().positive(),
      })
      .strict(),
    z
      .object({
        ...fields,
        kind: z.literal("rejected"),
        reason: z.literal("blur"),
      })
      .strict(),
  ])
  .refine(
    (photo) =>
      photo.kind === "rejected" ||
      (photo.uprightPath === `upright/${photo.photoId}.jpg` &&
        photo.visionPath === `vision/${photo.photoId}.jpg`),
    "Photo paths must match photoId",
  );
export const PhotosSchema = z
  .object({ version: z.literal(1), photos: z.array(PhotoSchema) })
  .strict();
export type Photo = z.infer<typeof PhotoSchema>;
