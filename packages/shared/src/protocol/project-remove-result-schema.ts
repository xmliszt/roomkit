import { z } from "zod";
import { ProjectIdSchema } from "../project/project-id-schema.ts";

export const ProjectRemoveResultSchema = z
  .object({ projectId: ProjectIdSchema })
  .strict();

export type ProjectRemoveResult = z.infer<typeof ProjectRemoveResultSchema>;
