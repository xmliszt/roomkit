import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readProcessIdentity } from "../jobs/read-process-identity.ts";
import { stopProcessGroup } from "../jobs/stop-process-group.ts";
import type { ProjectStore } from "../project/create-project-store.ts";
import { writeJson } from "../util/write-json.ts";
import { SessionRecordSchema } from "./session-record.ts";

/** Stop agent processes a previous daemon left running and mark their sessions `interrupted`. */
export async function stopOrphanAgents(options: { store: ProjectStore }) {
  const orphans = options.store
    .listProjects()
    .map((project) =>
      join(options.store.projectPath(project.id), ".planner", "sessions"),
    )
    .filter((directory) => existsSync(directory))
    .flatMap((directory) =>
      readdirSync(directory)
        .filter((file) => file.endsWith(".json"))
        .flatMap((file) => {
          const path = join(directory, file);
          const record = (() => {
            try {
              return SessionRecordSchema.safeParse(
                JSON.parse(readFileSync(path, "utf8")),
              );
            } catch {
              return undefined;
            }
          })();
          return record?.success ? [{ path, record: record.data }] : [];
        }),
    )
    .filter(({ record }) => record.status === "running");
  for (const { path, record } of orphans) {
    const identity =
      record.pid === undefined ? undefined : readProcessIdentity(record.pid);
    if (
      record.pid !== undefined &&
      identity !== undefined &&
      identity.bootId === record.processIdentity?.bootId &&
      identity.startedAt === record.processIdentity?.startedAt
    )
      await stopProcessGroup(record.pid);
    writeJson({
      path,
      value: {
        ...record,
        status: "interrupted",
        note: "Daemon restarted during the turn",
        pid: undefined,
        processIdentity: undefined,
      },
    });
  }
}
