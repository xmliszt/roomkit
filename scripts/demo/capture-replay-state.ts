#!/usr/bin/env node
import assert from "node:assert/strict";
import { cpSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { ProjectSchema } from "@planner/shared/src/project/project-schema.ts";
import { RenderViewSchema } from "@planner/shared/src/render/render-view-schema.ts";
import { z } from "zod";
import { writeJson } from "../../packages/daemon/src/util/write-json.ts";
import { assertReplayOutput } from "./assert-replay-output.ts";

const args = parseArgs({ allowPositionals: true });
assert.equal(
  args.positionals.length,
  3,
  "Usage: scripts/demo/capture-replay-state.ts <replay-project-folder> <render-job-id> <out-folder>",
);
const source = resolve(args.positionals.at(0) ?? "");
const jobId = z.guid().parse(args.positionals.at(1));
const output = resolve(args.positionals.at(2) ?? "");
assertReplayOutput({ source, output });
const project = ProjectSchema.parse(
  JSON.parse(readFileSync(join(source, "project.json"), "utf8")),
);
const manifest = z
  .object({
    projectId: z.string(),
    revision: z.number(),
    scene: ProjectSchema.shape.scene,
    view: RenderViewSchema,
  })
  .parse(
    JSON.parse(
      readFileSync(
        join(source, ".planner/render", jobId, "scene.json"),
        "utf8",
      ),
    ),
  );
assert.equal(manifest.projectId, project.id);
assert.equal(
  manifest.revision,
  project.revision,
  "Scene changed since snapshot render",
);
assert.deepEqual(manifest.scene, project.scene);
mkdirSync(output, { recursive: true });
cpSync(source, join(output, "project"), { recursive: true, dereference: true });
assert.deepEqual(
  JSON.parse(readFileSync(join(output, "project/project.json"), "utf8")),
  project,
  "Project changed during capture; capture again while idle",
);
writeJson({ path: join(output, "render-view.json"), value: manifest.view });
process.stdout.write(`Captured replay state: ${output}\n`);
