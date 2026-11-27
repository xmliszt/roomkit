import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { stopOrphanWorker } from "../python/stop-orphan-worker.ts";

export async function stopAlternativeWorkers(plannerHome: string) {
  if (!existsSync(plannerHome)) return;
  for (const name of readdirSync(plannerHome)) {
    if (/^alternative-worker-[A-Za-z0-9_-]+\.json$/.test(name))
      await stopOrphanWorker(join(plannerHome, name));
  }
}
