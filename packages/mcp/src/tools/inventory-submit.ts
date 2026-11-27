import { InventoryObjectsSchema } from "@planner/shared/src/inventory/inventory-objects-schema.ts";
import { InventorySubmitResultSchema } from "@planner/shared/src/protocol/inventory-submit-result-schema.ts";
import { z } from "zod";
import type { Tool } from "../tool-context.ts";
import { requestOrThrow } from "./request-or-throw.ts";

export const inventorySubmit: Tool = {
  name: "inventory_submit",
  description:
    "Submit the room's furniture inventory once. Give a box in vision-copy pixels for every photo that shows each object. Set cutsOpening to true for doors, windows, sliding doors and open doorways mounted on a wall. Never estimate sizes or placement.",
  inputSchema: {
    type: "object",
    properties: {
      objects: {
        type: "array",
        items: {
          type: "object",
          properties: {
            objectId: { type: "string" },
            name: { type: "string" },
            mount: { type: "string", enum: ["floor", "wall", "ceiling"] },
            cutsOpening: {
              type: "boolean",
              description:
                "True for a door, window, sliding door or open doorway on a wall. False is ignored on any mount.",
            },
            bestPhotoId: { type: "string" },
            views: {
              type: "array",
              minItems: 1,
              items: {
                type: "object",
                properties: {
                  photoId: { type: "string" },
                  box: {
                    type: "array",
                    items: { type: "integer", minimum: 0 },
                    minItems: 4,
                    maxItems: 4,
                    description:
                      "[left, top, right, bottom] in this vision copy's pixels; right and bottom are exclusive.",
                  },
                  visibility: {
                    type: "string",
                    enum: ["mostly-visible", "more-than-half-hidden"],
                  },
                },
                required: ["photoId", "box", "visibility"],
                additionalProperties: false,
              },
            },
          },
          required: ["objectId", "name", "mount", "bestPhotoId", "views"],
          additionalProperties: false,
        },
      },
    },
    required: ["objects"],
    additionalProperties: false,
  },
  async call(input, context) {
    const { objects } = z
      .object({ objects: InventoryObjectsSchema })
      .strict()
      .parse(input);
    return InventorySubmitResultSchema.parse(
      await requestOrThrow({
        context,
        command: {
          type: "agent.inventory.submit",
          projectId: context.projectId,
          turnId: context.turnId,
          objects,
        },
      }),
    );
  },
};
