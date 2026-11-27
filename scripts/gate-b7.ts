import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createDefaultConfig } from "@planner/shared/src/config/create-default-config.ts";
import { PreflightSchema } from "@planner/shared/src/preflight/preflight-schema.ts";
import { ProjectSchema } from "@planner/shared/src/project/project-schema.ts";
import { ChatHistoryResultSchema } from "@planner/shared/src/protocol/chat-history-result-schema.ts";
import { PhotoUploadResultSchema } from "@planner/shared/src/protocol/photo-upload-result-schema.ts";
import type { Item } from "@planner/shared/src/scene/item-schema.ts";
import type { Scene } from "@planner/shared/src/scene/scene-schema.ts";
import { z } from "zod";
import { readProcessIdentity } from "../packages/daemon/src/jobs/read-process-identity.ts";
import { readModelRegistry } from "../packages/daemon/src/preflight/read-model-registry.ts";
import { createReconFixture } from "./b6/create-recon-fixture.ts";
import { scoreInventory } from "./b7-real-inventory.ts";

function checkInventoryScoring() {
  function floor(options: {
    name: string;
    xM: number;
    zM: number;
    width: number;
    height: number;
    depth: number;
    rotationRad?: number;
    elevationM?: number;
  }) {
    return {
      id: options.name.replaceAll(" ", "-"),
      name: options.name,
      model: {
        kind: "pending",
        jobId: `job-${options.name.replaceAll(" ", "-")}`,
      },
      locked: false,
      sizeM: {
        width: options.width,
        height: options.height,
        depth: options.depth,
      },
      placement: {
        kind: "floor",
        xM: options.xM,
        zM: options.zM,
        rotationRad: options.rotationRad ?? 0,
        elevationM: options.elevationM ?? 0,
      },
    } satisfies Item;
  }
  const scene = {
    version: 1,
    camera: { positionM: { x: 0, y: 2, z: 4 }, targetM: { x: 0, y: 0, z: 0 } },
    room: {
      ceilingHeightM: 2.8,
      surfaces: {},
      walls: [
        { id: "left", startM: { x: -1.6, z: -2.8 }, kind: "solid" },
        { id: "back", startM: { x: -1.6, z: 2.8 }, kind: "inferred" },
        { id: "right", startM: { x: 1.6, z: 2.8 }, kind: "solid" },
        { id: "window", startM: { x: 1.6, z: -2.8 }, kind: "solid" },
      ],
    },
    items: [
      floor({
        name: "Coffee table",
        xM: 0,
        zM: -1,
        width: 0.9,
        height: 0.4,
        depth: 0.6,
      }),
      floor({
        name: "Sofa",
        xM: 1.1,
        zM: 0.9,
        width: 1.6,
        height: 0.7,
        depth: 0.8,
        rotationRad: Math.PI / 2,
      }),
      floor({
        name: "Oval dining table with fluted legs",
        xM: 1,
        zM: -1.2,
        width: 1.3,
        height: 0.75,
        depth: 0.8,
      }),
      floor({
        name: "Fridge",
        xM: 1.25,
        zM: 2.46,
        width: 0.55,
        height: 1.2,
        depth: 0.5,
        rotationRad: Math.PI / 2,
      }),
      floor({
        name: "TV console",
        xM: -1.35,
        zM: -1,
        width: 1.5,
        height: 0.4,
        depth: 0.4,
        rotationRad: Math.PI / 2,
      }),
      floor({
        name: "TV",
        xM: -1.35,
        zM: -1,
        width: 1.2,
        height: 0.67,
        depth: 0.08,
        rotationRad: Math.PI / 2,
        elevationM: 0.4,
      }),
      floor({
        name: "Floor lamp",
        xM: 1.25,
        zM: -2.4,
        width: 0.3,
        height: 1.6,
        depth: 0.3,
      }),
    ],
  } satisfies Scene;
  const expectedSizes = [
    { name: "sofa", width: 1.6, height: 0.7, depth: 0.8 },
    { name: "desk", width: 1.3, height: 0.75, depth: 0.8 },
    { name: "fridge", width: 0.55, height: 1.2, depth: 0.5 },
    { name: "tv", width: 1.2, height: 0.67 },
  ];
  const axes = { right: { x: 1, z: 0 }, forward: { x: 0, z: -1 } };
  const scoring = {
    axes,
    expectedSizes,
    targets: [
      { name: "sofa", pattern: "(?:sofa|couch)$", walls: ["right"] },
      {
        name: "desk",
        pattern:
          /^(?!.*\b(?:coffee|side|end|bedside|balcony|lamp)\b).*\b(?:desk|table)$/
            .source,
        walls: ["right"],
      },
      {
        name: "fridge",
        pattern: /\b(?:fridge|refrigerator)$/.source,
        walls: ["right"],
      },
      { name: "tv", pattern: /\b(?:tv|television)$/.source, walls: ["left"] },
      { name: "tv console", pattern: "tv console$", walls: ["left"] },
      { name: "coffee table", pattern: "coffee table$", walls: [] },
      {
        name: "floor lamp",
        pattern: "floor lamp$",
        walls: ["window", "right"],
      },
    ],
    floorOrder: ["desk", "sofa", "fridge"],
  } satisfies Omit<Parameters<typeof scoreInventory>[0], "scene">;
  const scored = scoreInventory({ scene, ...scoring });
  assert.equal(scored.passed, true, JSON.stringify(scored));
  assert.equal(scored.foundCount, 7);
  assert.deepEqual(
    scored.scores.find((score) => score.name === "fridge")?.touchingWalls,
    ["back", "right"],
  );
  for (const name of [
    "Desk (oval, fluted legs)",
    "Table",
    "Dining table",
    "Work table",
  ]) {
    const items = scene.items.map((item) =>
      item.name === "Oval dining table with fluted legs"
        ? { ...item, name }
        : item,
    );
    assert.equal(
      scoreInventory({ scene: { ...scene, items }, ...scoring }).passed,
      true,
      name,
    );
  }
  const wallSupported = scene.items.map((item) =>
    item.name === "TV console"
      ? {
          ...item,
          placement: {
            kind: "wall",
            wallId: "left",
            alongM: 1.8,
            heightM: 0.2,
            rotationRad: 0,
          } satisfies Item["placement"],
        }
      : item,
  );
  assert.equal(
    scoreInventory({
      scene: { ...scene, items: wallSupported },
      ...scoring,
    }).passed,
    true,
  );
  const missingDesk = scene.items.filter(
    (item) => item.name !== "Oval dining table with fluted legs",
  );
  assert.equal(
    scoreInventory({
      scene: { ...scene, items: missingDesk },
      ...scoring,
    }).foundCount,
    6,
  );
  assert.equal(
    scoreInventory({
      scene: { ...scene, items: missingDesk },
      ...scoring,
    }).passed,
    false,
  );
  const floating = scene.items.map((item) =>
    item.name === "Sofa"
      ? { ...item, placement: { ...item.placement, elevationM: 0.08 } }
      : item,
  );
  assert.deepEqual(
    scoreInventory({
      scene: { ...scene, items: floating },
      ...scoring,
    }).floatingItems,
    ["Sofa"],
  );
  const outside = [
    ...scene.items,
    floor({
      name: "Balcony chair",
      xM: 0,
      zM: -3,
      width: 0.5,
      height: 0.8,
      depth: 0.5,
    }),
  ];
  assert.deepEqual(
    scoreInventory({ scene: { ...scene, items: outside }, ...scoring })
      .outsideItems,
    ["Balcony chair"],
  );
  assert.equal(
    scoreInventory({ scene: { ...scene, items: outside }, ...scoring }).passed,
    false,
  );
  const outsideWall = scene.items.map((item) =>
    item.name === "TV"
      ? {
          ...item,
          placement: {
            kind: "wall",
            wallId: "left",
            alongM: 8,
            heightM: 1.1,
            rotationRad: 0,
          } satisfies Item["placement"],
        }
      : item,
  );
  assert.deepEqual(
    scoreInventory({
      scene: { ...scene, items: outsideWall },
      ...scoring,
    }).outsideItems,
    ["TV"],
  );
  const awayFromCorner = scene.items.map((item) =>
    item.name === "Fridge"
      ? { ...item, placement: { ...item.placement, xM: 0 } }
      : item,
  );
  assert.equal(
    scoreInventory({
      scene: { ...scene, items: awayFromCorner },
      ...scoring,
    }).scores.find((score) => score.name === "fridge")?.passed,
    false,
  );
}

checkInventoryScoring();

const fixture = await createReconFixture({
  env: { PLANNER_PYTHON_BIN: resolve("scripts/b7/fake-python.mjs") },
});
try {
  let daemon = await fixture.start();
  const config = createDefaultConfig();
  await daemon.command({
    type: "config.update",
    roles: {
      ...config.roles,
      surveyor: { cli: "claude", model: "fake-inventory" },
    },
  });
  const preflight = PreflightSchema.parse(
    await daemon.command({ type: "preflight.check" }),
  );
  for (const model of readModelRegistry(fixture.env.PLANNER_MODEL_REGISTRY)
    .models) {
    assert.equal(
      preflight.models.find((entry) => entry.id === model.id)?.state,
      "present",
    );
    const marker = join(
      fixture.root,
      "home",
      "python",
      "weights",
      model.folder,
      ".complete.json",
    );
    assert.ok(existsSync(marker));
    assert.deepEqual(JSON.parse(readFileSync(marker, "utf8")), {
      revision: model.revision,
    });
  }
  const project = ProjectSchema.parse(
    await daemon.command({
      type: "project.create",
      name: "B7 inventory",
      room: { widthM: 4, depthM: 5, ceilingHeightM: 2.6 },
    }),
  );
  const source = readFileSync(
    new URL("../packages/daemon/test/fixtures/oriented.heic", import.meta.url),
  );
  for (const origin of ["capture", "capture", "chat"]) {
    const response = await fetch(
      `http://127.0.0.1:${fixture.env.PLANNER_PORT}/projects/${project.id}/photos?fileName=room.heic&origin=${origin}`,
      { method: "POST", headers: { origin: fixture.origin }, body: source },
    );
    assert.equal(response.status, 201, await response.clone().text());
    PhotoUploadResultSchema.parse(await response.json());
  }
  async function reconstruct() {
    return z.object({ jobId: z.string() }).parse(
      await daemon.command({
        type: "reconstruction.start",
        projectId: project.id,
      }),
    ).jobId;
  }
  async function inventoryFor(reconstructionJobId: string) {
    return daemon.waitFor({
      label: "automatic inventory",
      read: () =>
        daemon.frames
          .flatMap((frame) =>
            frame.type === "event" &&
            frame.event.kind === "job.updated" &&
            frame.event.job.kind === "inventory" &&
            frame.event.job.reconstructionJobId === reconstructionJobId
              ? [frame.event.job]
              : [],
          )
          .at(-1),
    });
  }
  async function finish(jobId: string) {
    return daemon.waitFor({
      label: `inventory ${jobId}`,
      timeoutMs: 30_000,
      read: () =>
        daemon.frames
          .flatMap((frame) => {
            const jobs =
              frame.type === "snapshot"
                ? frame.jobs
                : frame.type === "event" && frame.event.kind === "job.updated"
                  ? [frame.event.job]
                  : [];
            return jobs.filter(
              (job) =>
                job.id === jobId &&
                (job.stage === "done" || job.stage === "failed"),
            );
          })
          .at(-1),
    });
  }
  async function opened() {
    return ProjectSchema.parse(
      await daemon.command({ type: "project.open", projectId: project.id }),
    );
  }
  const reconstructionJobId = await reconstruct();
  const inventory = await inventoryFor(reconstructionJobId);
  const completed = await finish(inventory.id);
  assert.equal(completed.stage, "done", completed.error);
  const result = await opened();
  const measurementCalls = readFileSync(
    join(fixture.root, "calls.jsonl"),
    "utf8",
  )
    .trim()
    .split("\n")
    .map((line) =>
      z
        .object({
          worker: z.string(),
          request: z.object({
            objects: z.array(z.object({ objectId: z.string() })).optional(),
          }),
        })
        .parse(JSON.parse(line)),
    )
    .filter((call) => call.worker === "measure");
  assert.equal(measurementCalls.length, 1);
  assert.deepEqual(
    measurementCalls.at(0)?.request.objects?.map((object) => object.objectId),
    ["sofa", "tv", "lamp"],
  );

  assert.equal(result.scene.items.length, 3);
  assert.equal(result.inventory?.jobId, inventory.id);
  assert.equal(
    new Set(
      result.scene.items.map((item) =>
        item.model.kind === "pending" ? item.model.jobId : undefined,
      ),
    ).size,
    3,
  );
  const sofa = result.scene.items.find((item) => item.name === "Sofa");
  assert.ok(sofa);
  assert.deepEqual(sofa.sizeM, { width: 1.6, height: 0.7, depth: 0.8 });
  assert.deepEqual(sofa.placement, {
    kind: "floor",
    xM: 1.15,
    zM: 0,
    elevationM: 0,
    rotationRad: -Math.PI / 2,
  });
  const tv = result.scene.items.find((item) => item.name === "TV");
  assert.ok(tv);
  assert.deepEqual(tv.placement, {
    kind: "wall",
    wallId: result.scene.room.walls.at(0)?.id,
    alongM: 1.2,
    heightM: 1.1,
    rotationRad: 0,
  });
  const history = ChatHistoryResultSchema.parse(
    await daemon.command({ type: "chat.history", projectId: project.id }),
  );
  const message = history.messages.find(
    (message) => message.id === inventory.id,
  );
  assert.ok(message);
  assert.equal(
    message.blocks.filter((block) => block.kind === "diff").length,
    1,
  );
  assert.ok(
    message.blocks.some(
      (block) => block.kind === "text" && /hidden/i.test(block.markdown),
    ),
  );
  const diff = message.blocks.find((block) => block.kind === "diff");
  assert.ok(diff?.kind === "diff");
  assert.equal(diff.undo.length, 3);
  await assert.rejects(
    daemon.command({ type: "inventory.start", projectId: project.id }),
  );
  await daemon.stop();
  daemon = await fixture.start();
  assert.deepEqual(await opened(), result);
  const snapshot = daemon.frames.find((frame) => frame.type === "snapshot");
  assert.ok(snapshot?.type === "snapshot");
  assert.deepEqual(
    snapshot.jobs
      .filter((job) => job.kind === "generation")
      .map((job) => job.id)
      .toSorted(),
    result.scene.items
      .flatMap((item) =>
        item.model.kind === "pending" ? [item.model.jobId] : [],
      )
      .toSorted(),
  );
  for (const command of diff.undo)
    await daemon.command({
      type: "scene.apply",
      projectId: project.id,
      command,
    });
  assert.equal((await opened()).scene.items.length, 0);
  const cancelled = daemon.frames.flatMap((frame) =>
    frame.type === "event" &&
    frame.event.kind === "job.updated" &&
    frame.event.job.kind === "generation" &&
    frame.event.job.stage === "failed"
      ? [frame.event.job.id]
      : [],
  );
  assert.equal(new Set(cancelled).size, 3);
  const callsBeforeRestart = readFileSync(
    join(fixture.root, "calls.jsonl"),
    "utf8",
  )
    .trim()
    .split("\n").length;
  fixture.control({ mode: "pause-measure" });
  const nextReconstruction = await reconstruct();
  const nextInventory = await inventoryFor(nextReconstruction);
  await daemon.waitFor({
    label: "paused measurement",
    read: () =>
      daemon.frames.find(
        (frame) =>
          frame.type === "event" &&
          frame.event.kind === "job.updated" &&
          frame.event.job.id === nextInventory.id &&
          frame.event.job.stage === "measuring",
      ),
  });
  await daemon.waitFor({
    label: "measurement process",
    read: () =>
      readFileSync(join(fixture.root, "calls.jsonl"), "utf8")
        .trim()
        .split("\n")
        .slice(callsBeforeRestart)
        .some(
          (line) =>
            z.object({ worker: z.string() }).parse(JSON.parse(line)).worker ===
            "measure",
        )
        ? true
        : undefined,
  });
  const processRecord = z
    .object({ pid: z.number() })
    .parse(
      JSON.parse(
        readFileSync(join(fixture.root, "home", "python-worker.json"), "utf8"),
      ),
    );
  await daemon.stop("SIGKILL");
  fixture.control({ mode: "normal" });
  daemon = await fixture.start();
  const resumed = await finish(nextInventory.id);
  assert.equal(resumed.stage, "done", resumed.error);
  assert.equal(readProcessIdentity(processRecord.pid), undefined);
  const afterRestart = await opened();
  assert.equal(afterRestart.scene.items.length, 3);
  assert.equal(afterRestart.inventory?.jobId, nextInventory.id);
  await daemon.stop();
  process.stdout.write(
    "gate:b7 passed: weights adoption, automatic surveyor inventory, measured pending items, single diff undo, generation job restart, cancellation, SIGKILL measurement recovery\n",
  );
} finally {
  await fixture.close();
}
