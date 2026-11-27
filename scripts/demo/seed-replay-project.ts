import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { ProjectSchema } from "@planner/shared/src/project/project-schema.ts";
import { createRectangularScene } from "@planner/shared/src/scene/create-rectangular-scene.ts";
import { GenerationRecordSchema } from "../../packages/daemon/src/generation/generation-record-schema.ts";
import { PROJECT_FOLDERS } from "../../packages/daemon/src/project/create-project-store.ts";
import { writeJson } from "../../packages/daemon/src/util/write-json.ts";
import type { prepareReplay } from "./prepare-replay.ts";

export function seedReplayProject(options: {
  saved: ReturnType<typeof prepareReplay>;
  root: string;
  name: string;
}) {
  const project = ProjectSchema.parse({
    id: randomUUID(),
    name: options.name,
    revision: 0,
    scene: createRectangularScene({
      widthM: 4,
      depthM: 5,
      ceilingHeightM: 2.6,
    }),
  });
  const folder = join(options.root, "projects", project.id);
  for (const name of PROJECT_FOLDERS)
    mkdirSync(join(folder, name), { recursive: true });
  for (const name of ["photos", "assets"])
    if (existsSync(join(options.saved.snapshot, name)))
      cpSync(join(options.saved.snapshot, name), join(folder, name), {
        recursive: true,
      });
  if (existsSync(join(options.saved.snapshot, "inventory")))
    cpSync(
      join(options.saved.snapshot, "inventory"),
      join(folder, ".planner", "inventory", options.saved.inventory.job.id),
      { recursive: true },
    );
  const records = options.saved.entries
    .filter((entry) => !entry.sourceObjectId && !entry.catalog)
    .map((entry) => {
      const generation = entry.generation;
      assert.ok(generation);
      const time = new Date().toISOString();
      return GenerationRecordSchema.parse({
        job: {
          kind: "generation",
          id: entry.replayJobId,
          projectId: project.id,
          itemId: entry.item.id,
          stage: "held",
          progress: 0,
          createdAt: time,
          updatedAt: time,
        },
        item: {
          ...entry.item,
          model: { kind: "pending", jobId: entry.replayJobId },
        },
        source: generation.source,
        prompt: generation.prompt,
        notes: generation.notes,
        colorNotes: generation.colorNotes,
        held: true,
        attempt: 0,
        assetId: entry.replayJobId,
      });
    });
  writeJson({ path: join(folder, "project.json"), value: project });
  writeJson({ path: join(folder, ".planner", "jobs.json"), value: records });
  return project;
}
