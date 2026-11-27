import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRectangularScene } from "@planner/shared/src/scene/create-rectangular-scene.ts";
import { expect, it } from "vitest";
import { buildGlb } from "../../apps/web/src/capture/e2e/build-glb.ts";
import {
  buildBulbPrompt,
  bulbSystemPrompt,
} from "../../packages/daemon/src/bulb/build-bulb-prompt.ts";
import { readBulbAnswer } from "../../packages/daemon/src/bulb/read-bulb-answer.ts";
import { prepareReplay } from "../../scripts/demo/prepare-replay.ts";

it("snapshots completed inventory and isolates resized catalog copies without changing source assets", () => {
  const root = mkdtempSync(join(tmpdir(), "planner-demo-test-"));
  try {
    const source = join(root, "source");
    const destination = join(root, "replay");
    for (const folder of [
      source,
      destination,
      join(source, ".planner"),
      join(source, "photos"),
      join(source, "recon"),
    ])
      mkdirSync(folder);
    const scene = createRectangularScene({
      widthM: 4,
      depthM: 5,
      ceilingHeightM: 3,
    });
    const project = {
      id: "00000000-0000-4000-8000-000000000001",
      name: "Empty room",
      revision: 1,
      scene,
      reconstruction: {
        jobId: "00000000-0000-4000-8000-000000000002",
        weakScale: false,
      },
    };
    const original = JSON.stringify(project);
    writeFileSync(join(source, "project.json"), original);
    writeFileSync(
      join(source, ".planner", "jobs.json"),
      JSON.stringify([
        {
          job: {
            id: "00000000-0000-4000-8000-000000000003",
            kind: "inventory",
            projectId: "00000000-0000-4000-8000-000000000001",
            reconstructionJobId: "00000000-0000-4000-8000-000000000002",
            stage: "done",
            progress: 1,
            createdAt: "2026-11-23T00:00:00.000Z",
            updatedAt: "2026-11-23T00:00:00.000Z",
          },
          photoIds: [],
          scenePath: "scene.npz",
          camerasPath: "cameras.json",
          room: scene.room,
          submission: [],
          outcome: { items: [], generationJobs: [], undo: [], blocks: [] },
        },
      ]),
    );
    const replay = prepareReplay({ source, root: destination });
    expect(replay.entries).toEqual([]);
    expect(replay.inventory.job.id).toBe(
      "00000000-0000-4000-8000-000000000003",
    );
    expect(readFileSync(join(source, "project.json"), "utf8")).toBe(original);
    writeFileSync(
      join(source, "project.json"),
      JSON.stringify({ ...project, name: "Changed during modelling" }),
    );
    expect(
      JSON.parse(readFileSync(join(replay.snapshot, "replay.json"), "utf8"))
        .project.name,
    ).toBe("Empty room");
    const assetId = "00000000-0000-4000-8000-000000000004";
    const asset = join(source, "assets", assetId);
    mkdirSync(asset, { recursive: true });
    const nativeSizeM = { width: 1, height: 1, depth: 1 };
    const model = buildGlb({
      json: {
        asset: { version: "2.0" },
        nodes: [{}],
        scenes: [{ nodes: [0] }],
      },
      binary: Buffer.alloc(4),
    });
    writeFileSync(join(asset, "model.glb"), model);
    writeFileSync(
      join(asset, "meta.json"),
      JSON.stringify({
        id: assetId,
        kind: "catalog",
        nativeSizeM,
        mount: "floor",
        triangleCount: 0,
        hasColorMask: false,
        provenance: { method: "saved", sourcePhotoIds: [] },
      }),
    );
    const items = [1, 2].map((width) => ({
      id: `00000000-0000-4000-8000-00000000000${width + 4}`,
      name: `Port ${width}`,
      model: { kind: "asset", assetId },
      sizeM: { ...nativeSizeM, width },
      placement: { kind: "floor", xM: 0, zM: 0, elevationM: 0, rotationRad: 0 },
      locked: false,
    }));
    writeFileSync(
      join(source, "project.json"),
      JSON.stringify({ ...project, scene: { ...scene, items } }),
    );
    const secondDestination = join(root, "second-replay");
    mkdirSync(secondDestination);
    const fitted = prepareReplay({ source, root: secondDestination });
    const fittedSizes = fitted.entries.map((entry) => {
      if (entry.item.model.kind !== "asset") throw new Error("Expected asset");
      return JSON.parse(
        readFileSync(
          join(
            fitted.snapshot,
            "assets",
            entry.item.model.assetId,
            "meta.json",
          ),
          "utf8",
        ),
      ).nativeSizeM;
    });
    expect(fittedSizes).toEqual([nativeSizeM, { ...nativeSizeM, width: 2 }]);
    expect(fitted.entries.at(0)?.item.model).not.toEqual(
      fitted.entries.at(1)?.item.model,
    );
    expect(readFileSync(join(asset, "model.glb"))).toEqual(model);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it.each(["inventory", "photo", "surface"])(
  "submits saved %s results without real tools",
  (kind) => {
    const root = mkdtempSync(join(tmpdir(), "planner-demo-agent-test-"));
    try {
      const source = join(root, "source");
      const asset = join(source, "assets", "alternative");
      mkdirSync(asset, { recursive: true });
      writeFileSync(join(asset, "model.glb"), "saved asset bytes");
      writeFileSync(
        join(source, "replay.json"),
        JSON.stringify({
          project: {
            scene: {
              room: {
                surfaces: {
                  floor: {
                    color: "#ffffff",
                    material: {
                      kind: "paint",
                      color: "#ffffff",
                      finish: "matte",
                    },
                  },
                },
              },
            },
          },
          entries: [
            {
              replayJobId: kind === "photo" ? root.split("/").at(-1) : "unused",
              objectId: "chair",
              item: { model: { kind: "asset", assetId: "alternative" } },
            },
          ],
        }),
      );
      writeFileSync(
        join(root, "job.json"),
        JSON.stringify({
          ...(kind === "surface"
            ? { surfaceId: "floor" }
            : {
                reference:
                  kind === "photo"
                    ? { kind: "photo", photoId: "photo" }
                    : { object: { objectId: "chair" } },
              }),
          name: "Chair",
        }),
      );
      const requests = join(root, "mcp.jsonl");
      const config = join(root, "mcp.json");
      writeFileSync(
        config,
        JSON.stringify({
          mcpServers: {
            planner: {
              command: process.execPath,
              args: [resolve("test/fake-cli/mcp-server.mjs")],
              env: { FAKE_MCP_REQUESTS_PATH: requests },
            },
          },
        }),
      );
      const child = spawnSync(
        process.execPath,
        [
          resolve("scripts/demo/fake-agent.mjs"),
          "-p",
          "--output-format",
          "stream-json",
          "--mcp-config",
          config,
        ],
        {
          cwd: root,
          input: "Replay saved chair",
          encoding: "utf8",
          timeout: 10000,
          env: {
            PATH: process.env.PATH,
            HOME: root,
            PLANNER_HOME: join(root, "home"),
            PLANNER_PROJECTS: join(root, "projects"),
            DEMO_SOURCE: source,
            DEMO_CALLS: join(root, "calls.jsonl"),
            DEMO_PIECE_SECONDS: "0.01",
          },
        },
      );
      expect(child.status, child.stderr + child.stdout).toBe(0);
      if (kind === "surface") {
        expect(readFileSync(join(root, "surface.py"), "utf8")).toBe("");
        expect(
          JSON.parse(readFileSync(join(root, "surface.json"), "utf8")),
        ).toEqual({
          color: "#ffffff",
          material: { kind: "paint", color: "#ffffff", finish: "matte" },
        });
      } else {
        expect(readFileSync(join(root, "raw.glb"), "utf8")).toBe(
          "saved asset bytes",
        );
        expect(readFileSync(join(root, "model.py"), "utf8")).toBe("");
        expect(readFileSync(join(root, "notes.md"), "utf8")).toBe("");
      }
      const calls = readFileSync(requests, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line))
        .filter((request) => request.method === "tools/call");
      expect(calls.map((request) => request.params.name)).toEqual([
        "asset_submit",
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);

it("uses the copied asset dimensions and final placement instead of the original measurement", async () => {
  const { readReplayMeasurements } = await import(
    "../../scripts/demo/read-replay-measurements.ts"
  );
  const root = mkdtempSync(join(tmpdir(), "planner-demo-size-test-"));
  try {
    mkdirSync(join(root, "inventory"));
    mkdirSync(join(root, "assets", "alternative"), { recursive: true });
    const placement = {
      kind: "floor",
      xM: 1,
      zM: 2,
      elevationM: 0,
      rotationRad: 0,
    };
    writeFileSync(
      join(root, "inventory", "measurement.json"),
      JSON.stringify({
        objects: [
          {
            objectId: "chair",
            placement,
            sizeM: { width: 1, height: 1, depth: 1 },
          },
        ],
      }),
    );
    writeFileSync(
      join(root, "replay.json"),
      JSON.stringify({
        entries: [
          {
            objectId: "replay-chair",
            sourceObjectId: "chair",
            item: {
              id: "chair",
              name: "Chair",
              model: { kind: "asset", assetId: "alternative" },
              sizeM: { width: 3, height: 3, depth: 3 },
              placement: { ...placement, xM: -1, rotationRad: 1.5 },
              locked: false,
            },
          },
        ],
      }),
    );
    writeFileSync(
      join(root, "assets", "alternative", "meta.json"),
      JSON.stringify({
        id: "alternative",
        kind: "generated",
        nativeSizeM: { width: 2, height: 2, depth: 2 },
        mount: "floor",
        triangleCount: 12,
        hasColorMask: true,
        provenance: { method: "sam3d", sourcePhotoIds: [] },
      }),
    );
    expect(readReplayMeasurements(root)).toEqual({
      objects: [
        {
          objectId: "replay-chair",
          placement: { ...placement, xM: -1, rotationRad: 1.5 },
          sizeM: { width: 2, height: 2, depth: 2 },
        },
      ],
      failures: [],
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it("copies the saved thumbnail for each bulb view without Blender", () => {
  const root = mkdtempSync(join(tmpdir(), "planner-demo-blender-test-"));
  try {
    writeFileSync(join(root, "thumb.png"), "saved thumbnail bytes");
    const child = spawnSync(
      process.execPath,
      [
        resolve("scripts/demo/fake-blender.mjs"),
        "--background",
        "--python",
        resolve("blender/thumbnail.py"),
        "--",
        "--input",
        join(root, "model.glb"),
        "--output",
        join(root, "front-render.png"),
        "--view",
        "front",
      ],
      {
        cwd: root,
        encoding: "utf8",
        timeout: 10000,
        env: { PATH: process.env.PATH, DEMO_CALLS: join(root, "calls.jsonl") },
      },
    );
    expect(child.status, child.stderr + child.stdout).toBe(0);
    expect(readFileSync(join(root, "front-render.png"), "utf8")).toBe(
      "saved thumbnail bytes",
    );
    expect(
      JSON.parse(readFileSync(join(root, "calls.jsonl"), "utf8")),
    ).toMatchObject({ kind: "thumbnail", view: "front" });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it.each([
  {
    name: "Saved lamp",
    expected: {
      emitter: { x: 0.5, y: 0.62, z: 0.5 },
      beam: { direction: { x: 0, y: -1, z: 0 }, angleDeg: 120 },
      shade: "translucent",
      lumens: 200,
    },
  },
  {
    name: "New lamp",
    expected: {
      emitter: { x: 0.5, y: 0.7, z: 0.5 },
      beam: { direction: { x: 0, y: -1, z: 0 }, angleDeg: 90 },
      shade: "translucent",
      lumens: 400,
    },
  },
])("answers the bulb turn for $name", (entry) => {
  const root = mkdtempSync(join(tmpdir(), "planner-demo-bulb-test-"));
  try {
    const source = join(root, "source");
    mkdirSync(source);
    writeFileSync(
      join(source, "replay.json"),
      JSON.stringify({
        entries: [
          {
            item: { name: "Saved lamp" },
            bulb: {
              x: 0.5,
              y: 0.62,
              z: 0.5,
              beam: { direction: { x: 0, y: -1, z: 0 }, angleDeg: 120 },
              shade: "translucent",
              lumens: 200,
            },
          },
          { item: { name: "New lamp" } },
        ],
      }),
    );
    const child = spawnSync(
      process.execPath,
      [
        resolve("scripts/demo/fake-agent.mjs"),
        "-p",
        "--output-format",
        "stream-json",
        "--append-system-prompt",
        bulbSystemPrompt,
      ],
      {
        cwd: root,
        input: buildBulbPrompt({
          item: {
            name: entry.name,
            placement: {
              kind: "floor",
              xM: 0,
              zM: 0,
              elevationM: 0,
              rotationRad: 0,
            },
          },
          frontPath: join(root, "front.png"),
          sidePath: join(root, "side.png"),
        }),
        encoding: "utf8",
        timeout: 10000,
        env: {
          PATH: process.env.PATH,
          HOME: root,
          PLANNER_HOME: join(root, "home"),
          PLANNER_PROJECTS: join(root, "projects"),
          DEMO_SOURCE: source,
          DEMO_CALLS: join(root, "calls.jsonl"),
        },
      },
    );
    expect(child.status, child.stderr + child.stdout).toBe(0);
    const result = child.stdout
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line))
      .find((event) => event.type === "result");
    expect(readBulbAnswer(result.result)).toEqual(entry.expected);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
