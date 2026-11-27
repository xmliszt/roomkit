import { GenerationSpecSchema } from "@planner/shared/src/generation/generation-spec-schema.ts";
import type { Tool } from "../tool-context.ts";
import { requestOrThrow } from "./request-or-throw.ts";

export const assetGenerate: Tool = {
  name: "asset_generate",
  description:
    "Generate an object from an attached photo or a product photo you found on the web. Find and cite a reference first for text requests.",
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string" },
      prompt: { type: "string" },
      sizeM: {
        type: "object",
        properties: {
          width: { type: "number" },
          height: { type: "number" },
          depth: { type: "number" },
        },
        required: ["width", "height", "depth"],
      },
      placement: {
        type: "object",
        description:
          "A scene Placement: floor {kind,xM,zM,elevationM,rotationRad}, wall {kind,wallId,alongM,heightM,rotationRad}, ceiling {kind,xM,zM,rotationRad}.",
      },
      reference: {
        type: "object",
        description:
          "{kind:'photo',photoId,extraPhotoIds?} or {kind:'web',imageUrl,sourceUrl}. photoId is the clearest, highest-resolution photo of the object itself; extraPhotoIds lists every other photo of the same object, at most 11. imageUrl must directly return an image.",
      },
      cutsOpening: {
        type: "boolean",
        description:
          "true for a wall-mounted door, window or open doorway that cuts a hole through its wall. Top-level field, not inside placement.",
      },
    },
    required: ["name", "prompt", "sizeM", "placement", "reference"],
    additionalProperties: false,
  },
  async call(input, context) {
    return requestOrThrow({
      context,
      command: {
        type: "agent.asset.generate",
        projectId: context.projectId,
        turnId: context.turnId,
        spec: GenerationSpecSchema.parse(input),
      },
    });
  },
};
