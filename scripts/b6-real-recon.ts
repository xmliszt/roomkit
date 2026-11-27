import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { ProjectSchema } from "@planner/shared/src/project/project-schema.ts";
import { PhotoUploadResultSchema } from "@planner/shared/src/protocol/photo-upload-result-schema.ts";
import { ServerMessageSchema } from "@planner/shared/src/protocol/server-message-schema.ts";
import { z } from "zod";
import { createReconFixture } from "./b6/create-recon-fixture.ts";

const photosDir = process.env.PLANNER_B6_PHOTOS;
if (!photosDir)
  throw new Error("Set PLANNER_B6_PHOTOS to the room photos directory.");

if (process.env.PLANNER_B6_LOCKED !== "1") {
  const child = spawn(
    "scripts/machine-lock.sh",
    ["b6", process.execPath, resolve(import.meta.filename)],
    {
      stdio: "inherit",
      env: { ...process.env, PLANNER_B6_LOCKED: "1" },
    },
  );
  const [code] = await once(child, "exit");
  process.exitCode = typeof code === "number" ? code : 1;
} else {
  const [widthM, lengthM, ceilingHeightM, scaleHeightM] = z
    .tuple([
      z.number().positive(),
      z.number().positive(),
      z.number().positive(),
      z.number().positive(),
    ])
    .parse(JSON.parse(process.env.PLANNER_B6_DIMENSIONS_M ?? "null"));
  const fixture = await createReconFixture({
    real: true,
    keep: true,
    env: {
      PLANNER_PYTHON_BIN:
        process.env.PLANNER_PYTHON_BIN ?? resolve("python/.venv/bin/python"),
      PLANNER_WEIGHTS_DIR:
        process.env.PLANNER_WEIGHTS_DIR ??
        join(homedir(), ".interior-planner", "python", "weights"),
    },
  });
  try {
    const daemon = await fixture.start();
    daemon.socket.on("message", (data) => {
      const frame = ServerMessageSchema.parse(JSON.parse(data.toString()));
      if (frame.type === "event" && frame.event.kind === "job.updated")
        process.stdout.write(
          `${frame.event.job.stage} ${Math.round(frame.event.job.progress * 100)}%\n`,
        );
    });
    const project = ProjectSchema.parse(
      await daemon.command({
        type: "project.create",
        name: "B6 real room",
        room: { widthM: 4, depthM: 5, ceilingHeightM: 2.6 },
      }),
    );
    const boxes = z
      .array(
        z.object({
          object: z.string(),
          photo: z.string(),
          box: z.tuple([z.number(), z.number(), z.number(), z.number()]),
        }),
      )
      .parse(JSON.parse(readFileSync("python/spikes/s3/boxes.json", "utf8")));
    const fridge = boxes.find((entry) => entry.object === "fridge");
    assert.ok(fridge);
    let fridgePhotoId: string | undefined;
    for (const name of readdirSync(photosDir)
      .filter((name) => /\.heic$/i.test(name))
      .toSorted()) {
      const response: Response = await fetch(
        `http://127.0.0.1:${fixture.env.PLANNER_PORT}/projects/${project.id}/photos?fileName=${encodeURIComponent(name)}&origin=capture`,
        {
          method: "POST",
          headers: { origin: fixture.origin },
          body: readFileSync(join(photosDir, name)),
        },
      );
      assert.equal(response.status, 201, await response.clone().text());
      const photo = PhotoUploadResultSchema.parse(await response.json());
      if (name === fridge.photo) fridgePhotoId = photo.photoId;
      process.stdout.write(`uploaded ${name}\n`);
    }
    assert.ok(fridgePhotoId);
    await daemon.command({
      type: "reconstruction.scale.set",
      projectId: project.id,
      sources: [
        {
          kind: "furniture",
          photoId: fridgePhotoId,
          box: fridge.box,
          axis: "height",
          lengthM: scaleHeightM,
          floorStanding: true,
          label: "fridge",
        },
      ],
    });
    const { jobId } = z.object({ jobId: z.string() }).parse(
      await daemon.command({
        type: "reconstruction.start",
        projectId: project.id,
      }),
    );
    const result = await daemon.waitFor({
      label: "real reconstruction",
      timeoutMs: 600_000,
      read: () =>
        daemon.frames
          .flatMap((frame) =>
            frame.type === "event" &&
            frame.event.kind === "job.updated" &&
            frame.event.job.id === jobId &&
            (frame.event.job.stage === "done" ||
              frame.event.job.stage === "failed")
              ? [frame.event.job]
              : [],
          )
          .at(-1),
    });
    assert.equal(result.stage, "done", result.error);
    const finished = ProjectSchema.parse(
      await daemon.command({ type: "project.open", projectId: project.id }),
    );
    const room = finished.scene.room;
    const lengths = room.walls
      .map((wall, index) => {
        const next = room.walls.at((index + 1) % room.walls.length);
        assert.ok(next);
        return Math.hypot(
          next.startM.x - wall.startM.x,
          next.startM.z - wall.startM.z,
        );
      })
      .toSorted((a, b) => a - b);
    const [shortM, longM] =
      widthM <= lengthM ? [widthM, lengthM] : [lengthM, widthM];
    for (const [index, measured] of lengths.entries()) {
      const expected = index < 2 ? shortM : longM;
      assert.ok(
        Math.abs(measured / expected - 1) <= 0.1,
        `Side ${index}: ${measured} m vs ${expected} m`,
      );
    }
    assert.ok(Math.abs(room.ceilingHeightM / ceilingHeightM - 1) <= 0.1);
    process.stdout.write(
      `b6-real-recon passed: sides ${lengths.join(", ")}; ceiling ${room.ceilingHeightM}; evidence ${fixture.root}\n`,
    );
  } finally {
    process.stdout.write(`Evidence retained at ${fixture.root}\n`);
    await fixture.close();
  }
}
