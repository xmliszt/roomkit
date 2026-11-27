import { z } from "zod";
import { IdSchema } from "../scene/id-schema.ts";

const InventoryViewSchema = z
  .object({
    photoId: IdSchema,
    box: z.tuple([
      z.number().int().nonnegative(),
      z.number().int().nonnegative(),
      z.number().int().positive(),
      z.number().int().positive(),
    ]),
    visibility: z.enum(["mostly-visible", "more-than-half-hidden"]),
  })
  .strict()
  .refine(
    (view) => view.box[2] > view.box[0] && view.box[3] > view.box[1],
    "Inventory box must have positive width and height",
  );

export const InventoryObjectSchema = z
  .object({
    objectId: IdSchema,
    name: z.string().trim().min(1),
    mount: z.enum(["floor", "wall", "ceiling"]),
    cutsOpening: z.boolean().optional(),
    bestPhotoId: IdSchema,
    views: z.array(InventoryViewSchema).min(1),
  })
  .strict()
  .refine(
    (object) => !object.cutsOpening || object.mount === "wall",
    "Only wall objects may set cutsOpening",
  )
  .refine(
    (object) =>
      new Set(object.views.map((view) => view.photoId)).size ===
      object.views.length,
    "Inventory views must have unique photo IDs",
  )
  .refine(
    (object) =>
      object.views.some((view) => view.photoId === object.bestPhotoId),
    "The best photo must be among the inventory views",
  )
  .transform(({ cutsOpening, ...object }) => ({
    ...object,
    ...(cutsOpening ? { cutsOpening } : {}),
  }));

export type InventoryObject = z.infer<typeof InventoryObjectSchema>;
