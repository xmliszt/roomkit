import { z } from "zod";
import type { Tool } from "../tool-context.ts";
import { requestOrThrow } from "./request-or-throw.ts";

export const renderPhoto: Tool = {
  name: "render_photo",
  description:
    "Render a realistic photo of the current editor view with local Blender. Returns {jobId}; progress is available through job_status and the image appears in chat when done. The project must be open in the editor.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  async call(input, context) {
    z.object({}).strict().parse(input);
    return requestOrThrow({
      context,
      command: {
        type: "agent.render.start",
        projectId: context.projectId,
        turnId: context.turnId,
      },
    });
  },
};
