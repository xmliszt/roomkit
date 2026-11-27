import {
  type ModelerOperation,
  ModelerOperationSchema,
} from "@planner/shared/src/generation/modeler-operation-schema.ts";
import type { Tool } from "../tool-context.ts";
import { requestOrThrow } from "./request-or-throw.ts";

export function createModelerTool(options: {
  name: string;
  kind: ModelerOperation["kind"];
  description: string;
  properties: { [key: string]: unknown };
  required: string[];
}) {
  return {
    name: options.name,
    description: options.description,
    inputSchema: {
      type: "object",
      properties: options.properties,
      required: options.required,
      additionalProperties: false,
    },
    async call(input, context) {
      if (typeof input !== "object" || input === null || Array.isArray(input))
        throw new Error("Expected arguments");
      const operation = ModelerOperationSchema.parse({
        ...input,
        kind: options.kind,
      });
      return requestOrThrow({
        context,
        command: {
          type: "agent.modeler",
          projectId: context.projectId,
          turnId: context.turnId,
          operation,
        },
      });
    },
  } satisfies Tool;
}
