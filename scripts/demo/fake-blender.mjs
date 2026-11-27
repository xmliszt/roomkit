#!/usr/bin/env node
import assert from "node:assert/strict";
import { appendFileSync, cpSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { findReplayEntry } from "./find-replay-entry.ts";

if (process.argv.includes("--version")) {
  process.stdout.write("Blender 5.2.0 replay\n");
} else {
  const args = process.argv.slice(2);
  function value(flag) {
    return args.at(args.indexOf(flag) + 1);
  }
  const script = basename(value("--python"));
  assert.ok(
    ["normalize.py", "recolor.py", "thumbnail.py", "render_photo.py"].includes(
      script,
    ),
  );
  if (script === "render_photo.py") {
    const source = process.env.DEMO_SOURCE;
    const data = JSON.parse(readFileSync(join(source, "replay.json"), "utf8"));
    const render = process.env.DEMO_RENDER_IMAGE ?? data.renders?.at(0);
    assert.ok(render, "Source needs a saved PNG render for photo replay");
    const seconds = Number(process.env.DEMO_RENDER_SECONDS ?? "3");
    assert.ok(
      Number.isFinite(seconds) && seconds >= 0,
      "render-seconds must be non-negative seconds",
    );
    for (let sample = 1; sample <= 4; sample++) {
      process.stdout.write(`Sample ${sample} / 4\n`);
      await delay((seconds * 1000) / 4);
    }
    cpSync(
      process.env.DEMO_RENDER_IMAGE ?? join(source, "renders", render),
      join(dirname(value("--")), "render.png"),
    );
    appendFileSync(
      process.env.DEMO_CALLS,
      `${JSON.stringify({ kind: "render", source: render, pid: process.pid })}\n`,
    );
    process.exit(0);
  }
  if (script === "thumbnail.py") {
    cpSync(join(dirname(value("--input")), "thumb.png"), value("--output"));
    appendFileSync(
      process.env.DEMO_CALLS,
      `${JSON.stringify({ kind: "thumbnail", view: value("--view"), pid: process.pid })}\n`,
    );
    process.exit(0);
  }
  const source = process.env.DEMO_SOURCE;
  const data = JSON.parse(readFileSync(join(source, "replay.json"), "utf8"));
  const job = JSON.parse(readFileSync("job.json", "utf8"));
  const entry = findReplayEntry({
    entries: data.entries,
    jobId: basename(process.cwd()),
    job,
  });
  assert.equal(entry?.item.model.kind, "asset");
  const folder = join(source, "assets", entry.item.model.assetId);
  if (script === "recolor.py") {
    cpSync(join(folder, "model.glb"), value("--output"));
    process.exit(0);
  }
  for (const name of [
    "model.glb",
    "points.bin",
    "lines.bin",
    "thumb.png",
    "colorMask.png",
  ])
    cpSync(join(folder, name), join(dirname(value("--output")), name));
  const meta = JSON.parse(readFileSync(join(folder, "meta.json"), "utf8"));
  appendFileSync(
    process.env.DEMO_CALLS,
    `${JSON.stringify({ kind: "normalize", objectId: entry.objectId, pid: process.pid })}\n`,
  );
  process.stdout.write(`RESULT ${JSON.stringify(meta)}\n`);
}
