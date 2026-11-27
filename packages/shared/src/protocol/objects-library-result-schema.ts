import { z } from "zod";
import { SourceOriginSchema } from "../objects/source-origin-schema.ts";
import { IdSchema } from "../scene/id-schema.ts";
import { SizeSchema } from "../scene/size-schema.ts";
import { UtcDateTimeSchema } from "./date-time-schema.ts";

export const ObjectsLibraryResultSchema = z
  .object({
    objects: z.array(
      z
        .object({
          assetId: IdSchema,
          name: z.string().min(1),
          nativeSizeM: SizeSchema,
          mount: z.enum(["floor", "wall", "ceiling"]),
          thumbUrl: z.string().startsWith("/"),
          origin: SourceOriginSchema,
          createdAt: UtcDateTimeSchema,
          itemIds: z.array(IdSchema),
          builtIn: z.boolean(),
        })
        .strict(),
    ),
  })
  .strict();

export type ObjectsLibraryResult = z.infer<typeof ObjectsLibraryResultSchema>;
