import { ProjectSchema } from "@planner/shared/src/project/project-schema.ts";
import { sendDaemonCommand } from "./send-daemon-command.ts";

/** Create a project in the e2e daemon and return it. */
export async function createProject(options: {
  name: string;
  widthM: number;
  depthM: number;
  ceilingHeightM: number;
}) {
  return ProjectSchema.parse(
    await sendDaemonCommand({
      type: "project.create",
      name: options.name,
      room: {
        widthM: options.widthM,
        depthM: options.depthM,
        ceilingHeightM: options.ceilingHeightM,
      },
    }),
  );
}
