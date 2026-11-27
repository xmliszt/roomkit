import { RegenerationSpecSchema } from "@planner/shared/src/generation/regeneration-spec-schema.ts";
import type { Tool } from "../tool-context.ts";
import { requestOrThrow } from "./request-or-throw.ts";

export const assetRegenerate: Tool = {
  name: "asset_regenerate",
  description:
    "Regenerate an existing item using its own saved sources and the user's corrections. Keep its current model until the replacement passes validation.",
  inputSchema: {
    type: "object",
    properties: {
      itemId: { type: "string" },
      notes: { type: "string", maxLength: 1000 },
      photoIds: {
        type: "array",
        items: { type: "string" },
        minItems: 1,
        maxItems: 12,
        uniqueItems: true,
        description:
          "IDs of newly attached photos of this object; they are added to its saved sources. Never put photo paths in notes. Objects made from a web image or a shape variant refuse photoIds.",
      },
      primaryPhotoId: {
        type: "string",
        description:
          "Set only to make a different photo the primary one (colour and material come from it). Room-inventory objects keep their best view and refuse a different primaryPhotoId.",
      },
    },
    required: ["itemId", "notes"],
    additionalProperties: false,
  },
  async call(input, context) {
    return requestOrThrow({
      context,
      command: {
        type: "agent.asset.regenerate",
        projectId: context.projectId,
        turnId: context.turnId,
        ...RegenerationSpecSchema.required({ notes: true }).parse(input),
      },
    });
  },
};
