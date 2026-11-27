import { SurfaceTargetSchema } from "@planner/shared/src/scene/surface-target-schema.ts";
import { z } from "zod";
import type { Tool } from "../tool-context.ts";
import { requestOrThrow } from "./request-or-throw.ts";

const InputSchema = z
  .object({
    target: SurfaceTargetSchema,
    prompt: z.string().trim().min(1).max(8000),
  })
  .strict();
export const surfaceSet: Tool = {
  name: "surface_set",
  description:
    "Build and apply a room surface material from a request, such as light oak planks on the floor. Returns jobIds. Name the wall by nearby furniture after reading scene_get.",
  inputSchema: {
    type: "object",
    properties: {
      target: {
        oneOf: [
          {
            type: "object",
            properties: {
              kind: { const: "surface" },
              surfaceId: {
                type: "string",
                description: "floor, ceiling, or a wall id from scene_get",
              },
            },
            required: ["kind", "surfaceId"],
            additionalProperties: false,
          },
          {
            type: "object",
            properties: { kind: { const: "walls" } },
            required: ["kind"],
            additionalProperties: false,
          },
        ],
      },
      prompt: { type: "string" },
    },
    required: ["target", "prompt"],
    additionalProperties: false,
  },
  async call(input, context) {
    return requestOrThrow({
      context,
      command: {
        type: "agent.surface.set",
        projectId: context.projectId,
        turnId: context.turnId,
        ...InputSchema.parse(input),
      },
    });
  },
};
