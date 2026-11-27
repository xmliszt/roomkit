#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { readReplayMeasurements } from "./read-replay-measurements.ts";
import { sampleReconstructionPoints } from "./sample-reconstruction-points.ts";

const source = process.env.DEMO_SOURCE;
const worker = basename(process.argv.at(2) ?? "", ".py");
let input = "";
for await (const chunk of process.stdin) input += chunk;
const request = JSON.parse(input);
appendFileSync(
  process.env.DEMO_CALLS,
  `${JSON.stringify({ kind: "worker", worker, pid: process.pid })}\n`,
);
function read(path) {
  return JSON.parse(readFileSync(join(source, path), "utf8"));
}
function save(options) {
  mkdirSync(dirname(options.path), { recursive: true });
  writeFileSync(options.path, JSON.stringify(options.value));
}
function emit(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}
function result(value) {
  emit({ kind: "result", result: value });
}
switch (worker) {
  case "intake": {
    const photos = read("photos/photos.json").photos.filter((photo) =>
      request.photos.some((input) => input.photoId === photo.photoId),
    );
    for (const photo of photos) {
      if (photo.kind !== "accepted") continue;
      for (const path of [photo.uprightPath, photo.visionPath]) {
        mkdirSync(dirname(join(request.outputDir, path)), { recursive: true });
        cpSync(join(source, "photos", path), join(request.outputDir, path));
      }
    }
    save({
      path: join(request.outputDir, "photos.json"),
      value: { version: 1, photos },
    });
    result({ photos });
    break;
  }
  case "reconstruct": {
    const durationMs = Number(process.env.DEMO_RECON_SECONDS) * 1000;
    const started = Date.now();
    while (Date.now() - started < durationMs) {
      const progress = (Date.now() - started) / durationMs;
      emit({
        kind: "progress",
        stage: progress < 0.75 ? "geometry" : "layout",
        progress,
      });
      await delay(Math.min(250, durationMs));
    }
    cpSync(join(source, "recon"), request.outputDir, { recursive: true });
    const room = read("recon/room.json");
    const pointsPath =
      room.pointsPath ?? join(dirname(room.scenePath), "points.bin");
    const preview = join(request.outputDir, pointsPath);
    if (!existsSync(preview))
      await sampleReconstructionPoints({
        scenePath: join(request.outputDir, room.scenePath),
        photosPath: join(source, "photos/photos.json"),
        outputPath: preview,
      });
    if (existsSync(preview)) room.pointsPath = pointsPath;
    save({ path: join(request.outputDir, "room.json"), value: room });
    result(room);
    break;
  }
  case "coverage":
    result(read("recon/coverage.json"));
    break;
  case "segment": {
    const masks = read("inventory/masks/masks.json");
    const data = read("replay.json");
    const objects = request.objects.map((input) => {
      const entry = data.entries.find(
        (entry) => entry.objectId === input.objectId,
      );
      const object = masks.objects.find(
        (object) => object.objectId === entry?.sourceObjectId,
      );
      assert.ok(object, `No saved masks for ${input.objectId}`);
      for (const view of object.views) {
        mkdirSync(dirname(join(request.outputDir, view.maskPath)), {
          recursive: true,
        });
        cpSync(
          join(source, "inventory", "masks", view.maskPath),
          join(request.outputDir, view.maskPath),
        );
      }
      return { ...object, objectId: input.objectId };
    });
    result({ objects });
    break;
  }
  case "measure": {
    const measurement = readReplayMeasurements(source);
    save({
      path: join(request.outputDir, "measurement.json"),
      value: measurement,
    });
    result(measurement);
    break;
  }
  default:
    throw new Error(`Unexpected replay worker: ${worker}`);
}
