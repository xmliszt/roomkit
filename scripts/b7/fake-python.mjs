#!/usr/bin/env node
import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";

const worker = basename(process.argv.at(2) ?? "", ".py");
if (worker !== "measure" && worker !== "segment") {
  await import("../b6/fake-python.mjs");
} else {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  const request = JSON.parse(input);
  appendFileSync(
    process.env.B6_CALLS,
    `${JSON.stringify({ worker, request, pid: process.pid })}\n`,
  );
  function emit(value) {
    process.stdout.write(`${JSON.stringify(value)}\n`);
  }
  if (worker === "segment") {
    const objects = request.objects.map((object) => ({
      objectId: object.objectId,
      name: object.name,
      views: object.views.map((view) => {
        const maskPath = `${object.objectId}/${view.photoId}.png`;
        mkdirSync(dirname(join(request.outputDir, maskPath)), {
          recursive: true,
        });
        writeFileSync(join(request.outputDir, maskPath), "fake mask");
        return {
          photoId: view.photoId,
          maskPath,
          widthPx: 80,
          heightPx: 120,
          model: "sam3",
          score: 1,
          durationSeconds: 0.01,
          shareInBox: 0.9,
        };
      }),
    }));
    writeFileSync(
      join(request.outputDir, "masks.json"),
      JSON.stringify({ objects }),
    );
    emit({ kind: "result", result: { objects } });
  } else {
    emit({ kind: "progress", stage: "measuring", progress: 0.2 });
    if (
      JSON.parse(readFileSync(process.env.B6_CONTROL, "utf8")).mode ===
      "pause-measure"
    ) {
      process.on("SIGTERM", () => undefined);
      setInterval(
        () => emit({ kind: "progress", stage: "measuring", progress: 0.2 }),
        1000,
      );
      await new Promise(() => undefined);
    }
    const measurements = {
      sofa: {
        sizeM: { width: 1.6, height: 0.7, depth: 0.8 },
        placement: {
          kind: "floor",
          xM: 1.15,
          zM: 0,
          elevationM: 0,
          rotationRad: -Math.PI / 2,
        },
      },
      tv: {
        sizeM: { width: 1.18, height: 0.68, depth: 0.08 },
        placement: {
          kind: "wall",
          wallId: request.room.walls.at(0).id,
          alongM: 1.2,
          heightM: 1.1,
          rotationRad: 0,
        },
      },
      lamp: {
        sizeM: { width: 0.3, height: 1.6, depth: 0.3 },
        placement: {
          kind: "floor",
          xM: 1.35,
          zM: 2.3,
          elevationM: 0,
          rotationRad: 0,
        },
      },
    };
    const objects = request.objects.map((object) => ({
      objectId: object.objectId,
      ...measurements[object.objectId],
    }));
    mkdirSync(request.outputDir, { recursive: true });
    writeFileSync(
      join(request.outputDir, "measurements.json"),
      JSON.stringify({ objects, failures: [] }),
    );
    emit({ kind: "result", result: { objects, failures: [] } });
  }
}
