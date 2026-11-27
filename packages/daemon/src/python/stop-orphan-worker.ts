import { existsSync, readFileSync, rmSync } from "node:fs";
import { readProcessGroup } from "../jobs/read-process-group.ts";
import { readProcessIdentity } from "../jobs/read-process-identity.ts";
import { stopProcessGroup } from "../jobs/stop-process-group.ts";
import { WorkerProcessSchema } from "./worker-process-schema.ts";

export async function stopOrphanWorker(path: string) {
  if (!existsSync(path)) return;
  const record = WorkerProcessSchema.parse(
    JSON.parse(readFileSync(path, "utf8")),
  );
  const identity = readProcessIdentity(record.pid);
  if (
    identity?.bootId === record.identity.bootId &&
    identity.startedAt === record.identity.startedAt
  )
    await stopProcessGroup(record.pid);
  else if ((await readProcessGroup(record.pid)).length > 0)
    throw new Error(
      `Worker group ${record.pid} is still running but its identity cannot be verified. Stop that group before restarting reconstruction; the process record was retained.`,
    );
  rmSync(path, { force: true });
}
