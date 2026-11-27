import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AlternativeJobSchema } from "@planner/shared/src/jobs/job-schema.ts";
import { expect, test } from "vitest";
import { readProjectWorkerLog } from "./read-project-worker-log.ts";

test.each([
  { count: 0, firstLineIndex: 0 },
  { count: 1, firstLineIndex: 0 },
  { count: 1999, firstLineIndex: 0 },
  { count: 2000, firstLineIndex: 0 },
  { count: 2001, firstLineIndex: 1 },
  { count: 4000, firstLineIndex: 2000 },
  { count: 4501, firstLineIndex: 2501 },
])(
  "saved worker logs restore the indexed tail for $count lines",
  async (input) => {
    const projectFolder = mkdtempSync(join(tmpdir(), "planner-log-tail-"));
    const job = AlternativeJobSchema.parse({
      id: "alternative",
      kind: "generation-alternative",
      projectId: crypto.randomUUID(),
      itemId: "item",
      method: "trellis2",
      stage: "failed",
      progress: 0.5,
      createdAt: "2026-11-23T00:00:00Z",
      updatedAt: "2026-11-23T00:00:00Z",
    });
    try {
      await expect(
        readProjectWorkerLog({ projectFolder, job }),
      ).resolves.toEqual({
        firstLineIndex: 0,
        lines: [],
      });
      const directory = join(projectFolder, ".planner/generation", job.id);
      mkdirSync(directory, { recursive: true });
      writeFileSync(
        join(directory, "worker.log"),
        Array.from({ length: input.count }, (_, index) => `line ${index}`).join(
          "\r\n",
        ),
      );
      const result = await readProjectWorkerLog({ projectFolder, job });
      expect(result.firstLineIndex).toBe(input.firstLineIndex);
      expect(result.lines).toHaveLength(Math.min(2000, input.count));
      expect(result.lines.at(0)).toBe(
        input.count ? `line ${input.firstLineIndex}` : undefined,
      );
      expect(result.lines.at(-1)).toBe(
        input.count ? `line ${input.count - 1}` : undefined,
      );
      expect(
        result.lines.every(
          (line, index) => line === `line ${input.firstLineIndex + index}`,
        ),
      ).toBe(true);
    } finally {
      rmSync(projectFolder, { recursive: true, force: true });
    }
  },
);
