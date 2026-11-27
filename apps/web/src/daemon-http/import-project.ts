import { ProjectSummarySchema } from "@planner/shared/src/project/project-schema.ts";
import { getDaemonUrl } from "./get-daemon-url.ts";
import { readErrorText } from "./read-error-text.ts";

/** Send an `.iplan` archive to the daemon and return the id and name of the new project it made. */
export async function importProject(archive: File) {
  const response = await fetch(getDaemonUrl({ path: "/projects/import" }), {
    method: "POST",
    body: archive,
  });
  if (!response.ok) throw new Error(await readErrorText(response));
  return ProjectSummarySchema.parse(await response.json());
}
