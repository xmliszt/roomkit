import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { createDefaultConfig } from "@planner/shared/src/config/create-default-config.ts";
import { ProjectSchema } from "@planner/shared/src/project/project-schema.ts";
import { PhotoUploadResultSchema } from "@planner/shared/src/protocol/photo-upload-result-schema.ts";
import { ServerMessageSchema } from "@planner/shared/src/protocol/server-message-schema.ts";
import type { Scene } from "@planner/shared/src/scene/scene-schema.ts";
import { z } from "zod";
import { writeJson } from "../packages/daemon/src/util/write-json.ts";
import { createReconFixture } from "./b6/create-recon-fixture.ts";

const expectedSizeSchema = z.object({
  name: z.string(),
  width: z.number().positive(),
  height: z.number().positive(),
  depth: z.number().positive().optional(),
});

const targetSchema = z.object({
  name: z.string(),
  pattern: z.string(),
  walls: z.array(z.enum(["right", "left", "window"])),
});

export function scoreInventory(options: {
  scene: Scene;
  expectedSizes: z.infer<typeof expectedSizeSchema>[];
  targets: z.infer<typeof targetSchema>[];
  floorOrder: string[];
  axes: { right: { x: number; z: number }; forward: { x: number; z: number } };
}) {
  const room = options.scene.room;
  const axes = options.axes;
  const center = {
    x:
      room.walls.reduce((sum, wall) => sum + wall.startM.x, 0) /
      room.walls.length,
    z:
      room.walls.reduce((sum, wall) => sum + wall.startM.z, 0) /
      room.walls.length,
  };
  const walls = room.walls.map((wall, index) => {
    const next = room.walls.at((index + 1) % room.walls.length);
    assert.ok(next);
    const midpoint = {
      x: (wall.startM.x + next.startM.x) / 2 - center.x,
      z: (wall.startM.z + next.startM.z) / 2 - center.z,
    };
    return {
      ...wall,
      endM: next.startM,
      right: midpoint.x * axes.right.x + midpoint.z * axes.right.z,
      forward: midpoint.x * axes.forward.x + midpoint.z * axes.forward.z,
    };
  });
  const rightWall = walls.toSorted((a, b) => b.right - a.right).at(0);
  const leftWall = walls.toSorted((a, b) => a.right - b.right).at(0);
  const windowWall = walls.toSorted((a, b) => b.forward - a.forward).at(0);
  assert.ok(rightWall && leftWall && windowWall);
  assert.equal(
    new Set([rightWall.id, leftWall.id, windowWall.id]).size,
    3,
    "Overview camera must distinguish the window and side walls",
  );
  const wallBySide = {
    right: rightWall.id,
    left: leftWall.id,
    window: windowWall.id,
  };
  const targets = options.targets.map((target) => ({
    name: target.name,
    match: new RegExp(target.pattern, "i"),
    expectedWalls: target.walls.map((side) => wallBySide[side]),
  }));
  const namedItems = options.scene.items.map((item) => ({
    item,
    head:
      item.name
        .split(
          /[(),;:—]|\s[-–]\s|\b(?:with|by|near|beside|behind|under|above|below|next to|adjacent to|in front of|to the (?:left|right) of|at|on|against|for)\b/i,
        )
        .at(0)
        ?.trim() ?? "",
  }));
  const usedItemIds = new Set<string>();
  const scores = targets.map((target) => {
    const item = namedItems
      .filter(
        ({ item, head }) =>
          !usedItemIds.has(item.id) && target.match.test(head),
      )
      .toSorted(
        (a, b) =>
          a.head.length - b.head.length || a.item.id.localeCompare(b.item.id),
      )
      .at(0)?.item;
    if (!item) return { name: target.name, found: false, passed: false };
    usedItemIds.add(item.id);
    const placement = item.placement;
    const touchingWalls = (() => {
      if (placement.kind === "wall") return [placement.wallId];
      const cosine = Math.cos(placement.rotationRad);
      const sine = Math.sin(placement.rotationRad);
      return walls
        .filter((wall) => {
          const dx = wall.endM.x - wall.startM.x;
          const dz = wall.endM.z - wall.startM.z;
          const length = Math.hypot(dx, dz);
          const nx = -dz / length;
          const nz = dx / length;
          const radius =
            (Math.abs(nx * cosine - nz * sine) * item.sizeM.width) / 2 +
            (Math.abs(nx * sine + nz * cosine) * item.sizeM.depth) / 2;
          const distance =
            Math.abs(
              nx * (placement.xM - wall.startM.x) +
                nz * (placement.zM - wall.startM.z),
            ) - radius;
          const along =
            ((placement.xM - wall.startM.x) * dx +
              (placement.zM - wall.startM.z) * dz) /
            length;
          const alongRadius =
            (Math.abs((dx / length) * cosine - (dz / length) * sine) *
              item.sizeM.width) /
              2 +
            (Math.abs((dx / length) * sine + (dz / length) * cosine) *
              item.sizeM.depth) /
              2;
          return (
            distance <= 0.3 &&
            along + alongRadius >= -0.3 &&
            along - alongRadius <= length + 0.3
          );
        })
        .map((wall) => wall.id);
    })();
    const wallPassed = target.expectedWalls.every((wallId) =>
      touchingWalls.includes(wallId),
    );
    return {
      name: target.name,
      found: true,
      itemId: item.id,
      sizeM: item.sizeM,
      placement,
      touchingWalls,
      expectedWalls: target.expectedWalls,
      passed: wallPassed,
    };
  });
  const dimensions = options.expectedSizes.map((expected) => {
    const found = scores.find((score) => score.name === expected.name);
    const measured = found?.sizeM;
    const errors = measured
      ? {
          width: Math.abs(measured.width / expected.width - 1),
          height: Math.abs(measured.height / expected.height - 1),
          depth:
            expected.depth === undefined
              ? undefined
              : Math.abs(measured.depth / expected.depth - 1),
        }
      : undefined;
    return {
      name: expected.name,
      measured,
      expected,
      errors,
      passed:
        errors !== undefined &&
        errors.width <= 0.15 &&
        errors.height <= 0.15 &&
        (errors.depth === undefined || errors.depth <= 0.15),
    };
  });
  const order = options.floorOrder.map((name) => {
    const placement = scores.find((score) => score.name === name)?.placement;
    return placement && placement.kind !== "wall"
      ? placement.xM * axes.forward.x + placement.zM * axes.forward.z
      : undefined;
  });
  const orderPassed = order.every(
    (value, index) =>
      value !== undefined &&
      (index === 0 || (order.at(index - 1) ?? -Infinity) >= value),
  );
  const foundCount = scores.filter((score) => score.found).length;
  const outsideItems = options.scene.items
    .filter((item) => {
      const placement = item.placement;
      if (placement.kind === "wall") {
        const wall = walls.find((wall) => wall.id === placement.wallId);
        assert.ok(wall);
        return (
          placement.alongM < 0 ||
          placement.alongM >
            Math.hypot(wall.endM.x - wall.startM.x, wall.endM.z - wall.startM.z)
        );
      }
      let inside = false;
      for (const wall of walls) {
        const start = wall.startM;
        const end = wall.endM;
        const dx = end.x - start.x;
        const dz = end.z - start.z;
        const px = placement.xM - start.x;
        const pz = placement.zM - start.z;
        if (
          Math.abs(dx * pz - dz * px) <= 1e-8 * Math.hypot(dx, dz) &&
          px * dx + pz * dz >= 0 &&
          px * dx + pz * dz <= dx * dx + dz * dz
        )
          return false;
        if (
          start.z > placement.zM !== end.z > placement.zM &&
          placement.xM < start.x + (pz * dx) / dz
        )
          inside = !inside;
      }
      return !inside;
    })
    .map((item) => item.name);
  const floatingItems = options.scene.items
    .filter((item) => {
      const placement = item.placement;
      if (placement.kind !== "floor" || placement.elevationM === 0)
        return false;
      return !options.scene.items.some((support) => {
        if (support.id === item.id) return false;
        const base = support.placement;
        const bounds = (() => {
          if (base.kind === "ceiling") return undefined;
          if (base.kind === "floor")
            return {
              xM: base.xM,
              zM: base.zM,
              bottom: base.elevationM,
              top: base.elevationM + support.sizeM.height,
              width: support.sizeM.width,
              depth: support.sizeM.depth,
              cosine: Math.cos(base.rotationRad),
              sine: Math.sin(base.rotationRad),
            };
          const wall = walls.find((wall) => wall.id === base.wallId);
          assert.ok(wall);
          const dx = wall.endM.x - wall.startM.x;
          const dz = wall.endM.z - wall.startM.z;
          const length = Math.hypot(dx, dz);
          const cosine = Math.abs(Math.cos(base.rotationRad));
          const sine = Math.abs(Math.sin(base.rotationRad));
          const height =
            sine * support.sizeM.width + cosine * support.sizeM.height;
          return {
            xM:
              wall.startM.x +
              (dx / length) * base.alongM +
              ((dz / length) * support.sizeM.depth) / 2,
            zM:
              wall.startM.z +
              (dz / length) * base.alongM -
              ((dx / length) * support.sizeM.depth) / 2,
            bottom: base.heightM - height / 2,
            top: base.heightM + height / 2,
            width: cosine * support.sizeM.width + sine * support.sizeM.height,
            depth: support.sizeM.depth,
            cosine: dx / length,
            sine: -dz / length,
          };
        })();
        if (!bounds || bounds.bottom >= placement.elevationM || bounds.top <= 0)
          return false;
        const dx = placement.xM - bounds.xM;
        const dz = placement.zM - bounds.zM;
        return (
          Math.abs(placement.elevationM - bounds.top) <= 0.12 &&
          Math.abs(dx * bounds.cosine - dz * bounds.sine) <= bounds.width / 2 &&
          Math.abs(dx * bounds.sine + dz * bounds.cosine) <= bounds.depth / 2
        );
      });
    })
    .map((item) => item.name);
  const passed =
    foundCount === targets.length &&
    scores.filter((score) => score.found).every((score) => score.passed) &&
    dimensions.every((score) => score.passed) &&
    orderPassed &&
    floatingItems.length === 0 &&
    outsideItems.length === 0;
  return {
    passed,
    foundCount,
    targetCount: targets.length,
    scores,
    dimensions,
    orderPassed,
    order,
    floatingItems,
    outsideItems,
    walls: { right: rightWall.id, left: leftWall.id, window: windowWall.id },
  };
}

const isMain =
  process.argv[1] && resolve(process.argv[1]) === import.meta.filename;
if (isMain && process.env.PLANNER_B7_LOCKED !== "1") {
  const child = spawn(
    "scripts/machine-lock.sh",
    ["b7", process.execPath, resolve(import.meta.filename)],
    {
      stdio: "inherit",
      env: { ...process.env, PLANNER_B7_LOCKED: "1" },
    },
  );
  const [code] = await once(child, "exit");
  process.exitCode = typeof code === "number" ? code : 1;
} else if (isMain) {
  const benchmark = z
    .object({
      overviewPhoto: z.string(),
      scaleHeightM: z.number().positive(),
      expectedSizes: z.array(expectedSizeSchema).min(1),
      targets: z.array(targetSchema).min(1),
      floorOrder: z.array(z.string()),
    })
    .parse(JSON.parse(process.env.PLANNER_B7_BENCHMARK ?? "null"));
  const fixture = await createReconFixture({
    real: true,
    keep: true,
    env: {
      ...process.env,
      HOME: homedir(),
      ...(process.env.CLAUDE_CONFIG_DIR
        ? { CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR }
        : {}),
      PLANNER_CLAUDE_BIN: process.env.PLANNER_CLAUDE_BIN ?? "claude",
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
          `${frame.event.job.kind}: ${frame.event.job.stage} ${Math.round(frame.event.job.progress * 100)}%\n`,
        );
    });
    const config = createDefaultConfig();
    await daemon.command({
      type: "config.update",
      roles: {
        ...config.roles,
        surveyor: {
          cli: "claude",
          model: process.env.PLANNER_B7_MODEL ?? config.roles.surveyor.model,
        },
      },
    });
    const project = ProjectSchema.parse(
      await daemon.command({
        type: "project.create",
        name: "B7 real inventory",
        room: { widthM: 4, depthM: 5, ceilingHeightM: 2.6 },
      }),
    );
    const photosDir = process.env.PLANNER_B7_PHOTOS;
    if (!photosDir)
      throw new Error("Set PLANNER_B7_PHOTOS to the room photos directory.");
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
    const photoIds: { [name: string]: string } = {};
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
      photoIds[name] = PhotoUploadResultSchema.parse(
        await response.json(),
      ).photoId;
      process.stdout.write(`uploaded ${name}\n`);
    }
    assert.ok(photoIds[fridge.photo]);
    await daemon.command({
      type: "reconstruction.scale.set",
      projectId: project.id,
      sources: [
        {
          kind: "furniture",
          photoId: photoIds[fridge.photo],
          box: fridge.box,
          axis: "height",
          lengthM: benchmark.scaleHeightM,
          floorStanding: true,
          label: "fridge",
        },
      ],
    });
    const reconstruction = z.object({ jobId: z.string() }).parse(
      await daemon.command({
        type: "reconstruction.start",
        projectId: project.id,
      }),
    );
    const reconstructionResult = await daemon.waitFor({
      label: "real reconstruction",
      timeoutMs: 600_000,
      read: () =>
        daemon.frames
          .flatMap((frame) =>
            frame.type === "event" &&
            frame.event.kind === "job.updated" &&
            frame.event.job.id === reconstruction.jobId &&
            (frame.event.job.stage === "done" ||
              frame.event.job.stage === "failed")
              ? [frame.event.job]
              : [],
          )
          .at(-1),
    });
    assert.equal(
      reconstructionResult.stage,
      "done",
      reconstructionResult.error,
    );
    const inventoryResult = await daemon.waitFor({
      label: "real inventory",
      timeoutMs: 1_800_000,
      read: () =>
        daemon.frames
          .flatMap((frame) =>
            frame.type === "event" &&
            frame.event.kind === "job.updated" &&
            frame.event.job.kind === "inventory" &&
            frame.event.job.reconstructionJobId === reconstruction.jobId &&
            (frame.event.job.stage === "done" ||
              frame.event.job.stage === "failed")
              ? [frame.event.job]
              : [],
          )
          .at(-1),
    });
    assert.equal(inventoryResult.stage, "done", inventoryResult.error);
    const finished = ProjectSchema.parse(
      await daemon.command({ type: "project.open", projectId: project.id }),
    );
    const folder = join(fixture.root, "projects", project.id);
    const reconstructionRoom = z
      .object({ camerasPath: z.string() })
      .parse(
        JSON.parse(readFileSync(join(folder, "recon", "room.json"), "utf8")),
      );
    const cameras = z
      .array(
        z.object({
          photoId: z.string(),
          cameraToWorld: z.array(z.array(z.number())),
        }),
      )
      .parse(
        JSON.parse(
          readFileSync(
            resolve(folder, "recon", reconstructionRoom.camerasPath),
            "utf8",
          ),
        ),
      );
    const overview = cameras.find(
      (camera) => camera.photoId === photoIds[benchmark.overviewPhoto],
    );
    assert.ok(
      overview,
      "The overview photo must be registered to identify the physical walls",
    );
    const right = {
      x: overview.cameraToWorld.at(0)?.at(0),
      z: overview.cameraToWorld.at(2)?.at(0),
    };
    const forward = {
      x: overview.cameraToWorld.at(0)?.at(2),
      z: overview.cameraToWorld.at(2)?.at(2),
    };
    assert.ok(
      right.x !== undefined &&
        right.z !== undefined &&
        forward.x !== undefined &&
        forward.z !== undefined,
    );
    const axes = {
      right: { x: right.x, z: right.z },
      forward: { x: forward.x, z: forward.z },
    };
    const score = scoreInventory({
      scene: finished.scene,
      axes,
      expectedSizes: benchmark.expectedSizes,
      targets: benchmark.targets,
      floorOrder: benchmark.floorOrder,
    });
    writeJson({
      path: join(fixture.root, "gate-b7-real.json"),
      value: {
        ...score,
        projectId: project.id,
        reconstructionJobId: reconstruction.jobId,
        inventoryJobId: inventoryResult.id,
        scaleHeightM: benchmark.scaleHeightM,
      },
    });
    assert.ok(
      score.passed,
      `Real inventory gate failed; inspect ${join(fixture.root, "gate-b7-real.json")}`,
    );
    process.stdout.write(
      `b7-real-inventory passed: ${score.foundCount}/${score.targetCount} objects, measured sizes, wall placement and item order; evidence ${fixture.root}\n`,
    );
  } finally {
    process.stdout.write(`Evidence retained at ${fixture.root}\n`);
    await fixture.close();
  }
}
