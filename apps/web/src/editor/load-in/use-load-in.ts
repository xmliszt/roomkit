import type { Project } from "@planner/shared/src/project/project-schema.ts";
import { useState } from "react";
import { createLoadIn } from "./create-load-in.ts";

export function useLoadIn(project: Project | undefined) {
  const [projects, setProjects] = useState<{
    [projectId: string]: ReturnType<typeof createLoadIn>;
  }>({});
  if (!project) return undefined;
  const existing = projects[project.id];
  if (existing) return existing;
  const loadIn = createLoadIn(project.scene.items);
  setProjects({ ...projects, [project.id]: loadIn });
  return loadIn;
}
