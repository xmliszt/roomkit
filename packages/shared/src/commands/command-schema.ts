import { z } from "zod";
import { CameraSchema } from "../scene/camera-schema.ts";
import { ColorAdjustSchema } from "../scene/color-adjust-schema.ts";
import { ColorSchema } from "../scene/color-schema.ts";
import { IdSchema } from "../scene/id-schema.ts";
import { ItemModelSchema, ItemSchema } from "../scene/item-schema.ts";
import { LightSchema } from "../scene/light-schema.ts";
import { PlacementSchema } from "../scene/placement-schema.ts";
import { SizeSchema } from "../scene/size-schema.ts";
import { SurfaceMaterialSchema } from "../scene/surface-material-schema.ts";
import { WallSchema } from "../scene/wall-schema.ts";

function hasDefinedValue(value: { [key: string]: unknown }) {
  return Object.values(value).some((entry) => entry !== undefined);
}

export const ItemPatchSchema = z
  .object({
    name: z.string(),
    model: ItemModelSchema,
    placement: PlacementSchema,
    sizeM: SizeSchema,
    colorAdjust: ColorAdjustSchema.nullable(),
    mirrored: z.boolean().nullable(),
    cutsOpening: z.boolean().nullable(),
    light: LightSchema.nullable(),
    locked: z.boolean(),
  })
  .partial()
  .strict()
  .refine(hasDefinedValue, "The patch changes nothing");

export type ItemPatch = z.infer<typeof ItemPatchSchema>;

export const CommandSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("item.add"),
      item: ItemSchema,
      index: z.number().int().nonnegative().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("item.update"),
      itemId: IdSchema,
      patch: ItemPatchSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("item.duplicate"),
      itemId: IdSchema,
      newItemId: IdSchema,
      placement: PlacementSchema,
      mirrored: z.boolean().optional(),
    })
    .strict(),
  z.object({ type: z.literal("item.remove"), itemId: IdSchema }).strict(),
  z
    .object({
      type: z.literal("room.update"),
      walls: z.array(WallSchema).min(3).optional(),
      ceilingHeightM: z.number().finite().positive().optional(),
      placements: z.record(IdSchema, PlacementSchema).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("surface.update"),
      surfaceId: IdSchema,
      color: ColorSchema.nullable(),
      material: SurfaceMaterialSchema.nullable().optional(),
    })
    .strict(),
  z.object({ type: z.literal("camera.set"), camera: CameraSchema }).strict(),
]);

export type Command = z.infer<typeof CommandSchema>;
