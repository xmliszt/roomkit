import { IdSchema } from "@planner/shared/src/scene/id-schema.ts";
import { z } from "zod";
import type { Tool } from "../tool-context.ts";

export const jobStatus: Tool = {
  name: "job_status",
  description:
    "Read a generation, surface, reconstruction, inventory or render job of this project: stage, progress from 0 to 1, last log line and error.",
  inputSchema: {
    type: "object",
    properties: { jobId: { type: "string" } },
    required: ["jobId"],
    additionalProperties: false,
  },
  async call(input, context) {
    const { jobId } = z.object({ jobId: IdSchema }).strict().parse(input);
    const job = context.link.readJob(jobId);
    if (
      job === undefined ||
      job.kind === "install" ||
      job.projectId !== context.projectId
    )
      throw new Error(`Unknown job: ${jobId}`);
    return job;
  },
};
