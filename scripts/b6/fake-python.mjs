#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createRectangularScene } from "../../packages/shared/src/scene/create-rectangular-scene.ts";

function emit(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}
function save(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value));
}
let input = "";
for await (const chunk of process.stdin) input += chunk;
const request = JSON.parse(input);
const worker = basename(process.argv.at(2) ?? "", ".py");
const control = JSON.parse(readFileSync(process.env.B6_CONTROL, "utf8"));
appendFileSync(
  process.env.B6_CALLS,
  `${JSON.stringify({ worker, request, pid: process.pid })}\n`,
);
if (control.mode === "malformed") {
  process.stdout.write("invalid\n");
  await delay(60_000);
}
if (control.mode === "no-result") process.exit(0);
if (control.mode === "pause-intake" && worker === "intake") {
  emit({ kind: "progress", stage: "intake", progress: 0.1 });
  while (
    JSON.parse(readFileSync(process.env.B6_CONTROL, "utf8")).mode ===
    "pause-intake"
  )
    await delay(25);
}
if (worker === "intake") {
  const photos = request.photos.map((source, index) => {
    const original = JSON.parse(
      readFileSync(join(dirname(source.path), "photos.json"), "utf8"),
    ).photos.find((photo) => photo.photoId === source.photoId);
    const { origin: _origin, reason: _reason, ...fields } = original;
    const photo = {
      ...fields,
      kind: "accepted",
      uprightPath: `upright/${source.photoId}.jpg`,
      visionPath: `vision/${source.photoId}.jpg`,
      visionWidthPx: fields.visionWidthPx ?? fields.widthPx,
      visionHeightPx: fields.visionHeightPx ?? fields.heightPx,
    };
    if (control.rejectFirst && index === 0) {
      const {
        uprightPath: _upright,
        visionPath: _vision,
        visionWidthPx: _width,
        visionHeightPx: _height,
        ...fields
      } = photo;
      return { ...fields, kind: "rejected", reason: "blur", blurScore: 0 };
    }
    for (const relative of [photo.uprightPath, photo.visionPath]) {
      mkdirSync(dirname(join(request.outputDir, relative)), {
        recursive: true,
      });
      copyFileSync(
        join(dirname(source.path), relative),
        join(request.outputDir, relative),
      );
    }
    return photo;
  });
  save(join(request.outputDir, "photos.json"), { version: 1, photos });
  emit({ kind: "progress", stage: "intake", progress: 1 });
  emit({ kind: "result", result: { photos } });
} else if (worker === "segment") {
  const objects = request.objects.map((object) => ({
    ...object,
    views: object.views.map((view) => {
      const maskPath = `${object.objectId}/${view.photoId}.png`;
      mkdirSync(dirname(join(request.outputDir, maskPath)), {
        recursive: true,
      });
      writeFileSync(join(request.outputDir, maskPath), "fake mask");
      return { photoId: view.photoId, maskPath };
    }),
  }));
  emit({ kind: "result", result: { objects } });
} else if (worker === "reconstruct") {
  emit({ kind: "progress", stage: "geometry", progress: 0.1 });
  if (control.mode === "pause") {
    process.on("SIGTERM", () => undefined);
    setInterval(() => emit({ kind: "progress", stage: "running" }), 1000);
    await new Promise(() => undefined);
  }
  if (control.mode === "fail") {
    emit({ kind: "error", message: "synthetic geometry failure" });
    process.exit(1);
  }
  const room = createRectangularScene({
    widthM: 3.0,
    depthM: 5.2,
    ceilingHeightM: 2.7,
  }).room;
  const previousPath = join(request.outputDir, "room.json");
  const previous = existsSync(previousPath)
    ? JSON.parse(readFileSync(previousPath, "utf8"))
    : undefined;
  room.walls = room.walls.map((wall, index) => ({
    ...wall,
    id: previous?.walls.at(index)?.id ?? `physical-${index}`,
    kind: index === 0 ? "inferred" : "solid",
  }));
  const generation = `run-${randomUUID()}`;
  mkdirSync(join(request.outputDir, generation));
  const result = {
    walls: room.walls,
    ceilingHeightM: room.ceilingHeightM,
    confidence: {},
    scale: {
      weak: request.scaleSources.length === 0,
      disagreements: control.disagreement ? ["fridge"] : [],
    },
    scenePath: `${generation}/scene.npz`,
    camerasPath: `${generation}/cameras.json`,
  };
  writeFileSync(join(request.outputDir, result.scenePath), "fake point cloud");
  save(join(request.outputDir, result.camerasPath), { cameras: [] });
  emit({ kind: "progress", stage: "layout", progress: 0.75 });
  save(previousPath, result);
  emit({ kind: "result", result });
} else if (worker === "coverage") {
  if (control.mode === "fail-coverage") {
    emit({ kind: "error", message: "synthetic coverage failure" });
    process.exit(1);
  }
  const room = JSON.parse(
    readFileSync(join(request.reconDir, "room.json"), "utf8"),
  );
  const result = {
    surfaces: [],
    captureRequests: [
      {
        surfaceId: room.walls.at(0).id,
        reason: "inferred",
        standAtM: { x: 0, z: 0 },
        lookDirection: { x: -1, z: 0 },
      },
      {
        surfaceId: "floor",
        reason: "low-coverage",
        standAtM: { x: 0, z: 0 },
        lookDirection: { x: 0, y: -1, z: 0 },
      },
    ],
  };
  save(join(request.reconDir, "coverage.json"), result);
  emit({ kind: "result", result });
} else throw new Error(`Unknown worker ${worker}`);
