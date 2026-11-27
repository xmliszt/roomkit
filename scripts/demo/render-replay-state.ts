#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  constants,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { createDefaultConfig } from "@planner/shared/src/config/create-default-config.ts";
import { ProjectSchema } from "@planner/shared/src/project/project-schema.ts";
import { RenderViewSchema } from "@planner/shared/src/render/render-view-schema.ts";
import { checkBlender } from "../../packages/daemon/src/preflight/check-blender.ts";
import { resolveToolPaths } from "../../packages/daemon/src/preflight/resolve-tool-paths.ts";
import { exportRenderScene } from "../../packages/daemon/src/render/export-render-scene.ts";
import { runPhotoRender } from "../../packages/daemon/src/render/run-photo-render.ts";
import { assertReplayOutput } from "./assert-replay-output.ts";

const args = parseArgs({ allowPositionals: true });
assert.equal(
  args.positionals.length,
  3,
  "Usage: scripts/demo/render-replay-state.ts <replay-project-folder> <render-view.json> <out.png>",
);
const projectFolder = resolve(args.positionals.at(0) ?? "");
const output = resolve(args.positionals.at(2) ?? "");
assertReplayOutput({ source: projectFolder, output });
assertReplayOutput({ source: projectFolder, output: `${output}.json` });
const project = ProjectSchema.parse(
  JSON.parse(readFileSync(join(projectFolder, "project.json"), "utf8")),
);
const view = RenderViewSchema.parse(
  JSON.parse(readFileSync(resolve(args.positionals.at(1) ?? ""), "utf8")),
);
const folder = mkdtempSync(join(tmpdir(), "planner-replay-photo-"));
const controller = new AbortController();
function abort() {
  controller.abort();
}
const signals = ["SIGINT", "SIGTERM", "SIGHUP"] as const;
for (const signal of signals) process.once(signal, abort);
const heartbeat = setInterval(
  () => process.stdout.write("replay-photo: rendering\n"),
  5000,
);
try {
  const env = {
    ...process.env,
    PLANNER_HOME: join(folder, "home"),
    PLANNER_PROJECTS: join(folder, "projects"),
  };
  const paths = resolveToolPaths({
    env,
    config: createDefaultConfig(),
    plannerHome: env.PLANNER_HOME,
  });
  const blender = await checkBlender({ candidates: paths.blender, env });
  assert.ok(blender.state === "present", "Blender is missing or cannot start");
  exportRenderScene({ project, view, projectFolder, folder });
  await runPhotoRender({
    blender: blender.path,
    folder,
    env,
    signal: controller.signal,
    onLine(line) {
      process.stdout.write(`${line}\n`);
    },
    onAcquired() {},
    onSamples() {},
  });
  mkdirSync(dirname(output), { recursive: true });
  copyFileSync(join(folder, "render.png"), output, constants.COPYFILE_EXCL);
  copyFileSync(
    join(folder, "metrics.json"),
    `${output}.json`,
    constants.COPYFILE_EXCL,
  );
  process.stdout.write(`Rendered replay state: ${output}\n`);
} finally {
  clearInterval(heartbeat);
  for (const signal of signals) process.removeListener(signal, abort);
  rmSync(folder, { recursive: true, force: true });
}
