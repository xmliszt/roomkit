import { ProjectSchema } from "@planner/shared/src/project/project-schema.ts";
import type { Tool } from "../tool-context.ts";
import { requestOrThrow } from "./request-or-throw.ts";

export const sceneGet: Tool = {
  name: "scene_get",
  description:
    "Read the current scene of this project: room walls, ceiling height, surfaces, items with their placement and size in meters, and the camera. Returns {revision, scene}.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  async call(_input, context) {
    const project = ProjectSchema.parse(
      await requestOrThrow({
        context,
        command: { type: "project.open", projectId: context.projectId },
      }),
    );
    return { revision: project.revision, scene: project.scene };
  },
};
