import { VariantSpecSchema } from "@planner/shared/src/generation/variant-spec-schema.ts";
import type { Tool } from "../tool-context.ts";
import { requestOrThrow } from "./request-or-throw.ts";

export const assetVariant: Tool = {
  name: "asset_variant",
  description:
    "Create a new pending item from a finished item. Colour changes use Blender without an agent; shape changes use a modeler with the parent render.",
  inputSchema: {
    type: "object",
    properties: {
      itemId: { type: "string" },
      name: { type: "string" },
      change: {
        type: "object",
        description:
          "{kind:'color',color:'#rrggbb',strength:0..1} or {kind:'shape',prompt,sizeM:{width,height,depth}}.",
      },
    },
    required: ["itemId", "name", "change"],
    additionalProperties: false,
  },
  async call(input, context) {
    return requestOrThrow({
      context,
      command: {
        type: "agent.asset.variant",
        projectId: context.projectId,
        turnId: context.turnId,
        spec: VariantSpecSchema.parse(input),
      },
    });
  },
};
