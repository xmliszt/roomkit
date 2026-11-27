import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PlannerEvent } from "@planner/shared/src/protocol/planner-event-schema.ts";
import { expect, test } from "vitest";
import { EventBus } from "../ws/event-bus.ts";
import { createJobOutputLog } from "./create-job-output-log.ts";

test("worker output is saved and streamed with stable line indexes across restarts", () => {
  const root = mkdtempSync(join(tmpdir(), "planner-job-log-"));
  try {
    const bus = new EventBus();
    const events: PlannerEvent[] = [];
    bus.subscribe((event) => events.push(event));
    const env = {
      PLANNER_HOME: root,
      PLANNER_PROJECTS: root,
      SERVICE_TOKEN: "secret-token",
    };
    const path = join(root, "worker.log");
    const log = createJobOutputLog({ bus, env });
    log({
      jobId: "job",
      path,
      line: '\u001b[31mRESULT {"ok":true}\u001b[0m\nsecret-token\n',
    });
    const resumed = createJobOutputLog({ bus, env });
    resumed({ jobId: "job", path, line: "mesh exported" });
    expect(readFileSync(path, "utf8")).toBe(
      'RESULT {"ok":true}\n[redacted]\nmesh exported\n',
    );
    expect(events).toEqual([
      {
        kind: "job.log",
        jobId: "job",
        firstLineIndex: 0,
        lines: ['RESULT {"ok":true}', "[redacted]"],
      },
      {
        kind: "job.log",
        jobId: "job",
        firstLineIndex: 2,
        lines: ["mesh exported"],
      },
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
