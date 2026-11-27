import { z } from "zod";
import { InventoryObjectSchema } from "./inventory-object-schema.ts";

export const InventoryObjectsSchema = z
  .array(InventoryObjectSchema)
  .refine(
    (objects) =>
      new Set(objects.map((object) => object.objectId)).size === objects.length,
    "Inventory objects must have unique IDs",
  );
