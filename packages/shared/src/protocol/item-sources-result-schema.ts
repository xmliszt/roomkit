import { z } from "zod";
import { SourceOriginSchema } from "../objects/source-origin-schema.ts";
import { PhotoBoxSchema } from "../photos/photo-box-schema.ts";
import { IdSchema } from "../scene/id-schema.ts";

export const ItemSourcesResultSchema = z
  .object({
    items: z.array(
      z
        .object({
          itemId: IdSchema,
          origin: SourceOriginSchema,
          photos: z.array(
            z.discriminatedUnion("kind", [
              z
                .object({
                  kind: z.literal("photo"),
                  photoId: IdSchema,
                  box: PhotoBoxSchema.optional(),
                  isBest: z.boolean(),
                  cropUrl: z.string().startsWith("/projects/").optional(),
                })
                .strict(),
              z
                .object({
                  kind: z.literal("web"),
                  imageUrl: z.string().startsWith("/projects/"),
                  sourceUrl: z
                    .string()
                    .url()
                    .refine(
                      (value) =>
                        URL.canParse(value) &&
                        /^https?:$/.test(new URL(value).protocol),
                      "Use an HTTP or HTTPS source page",
                    ),
                  isBest: z.boolean(),
                })
                .strict(),
            ]),
          ),
        })
        .strict(),
    ),
  })
  .strict();

export type ItemSourcesResult = z.infer<typeof ItemSourcesResultSchema>;
