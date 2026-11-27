import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createDefaultConfig } from "@planner/shared/src/config/create-default-config.ts";
import { expect, test, vi } from "vitest";
import { createAgentRuntime } from "../agent/create-agent-runtime.ts";
import { createTurnSlots } from "../chat/create-turn-slots.ts";
import { createTestFixture } from "../create-test-fixture.ts";
import { createSurfaceQueue } from "../surfaces/create-surface-queue.ts";
import { createLogger } from "../util/logger.ts";
import { writeJson } from "../util/write-json.ts";
import { createGenerationQueue } from "./create-generation-queue.ts";

for (const kind of ["generation", "surface"]) {
  test(`${kind} usage-limit diagnostics stay in the log instead of chat`, async () => {
    const fixture = await createTestFixture({
      env: (root) => ({ PLANNER_CLAUDE_BIN: join(root, "usage-claude") }),
    });
    const { store, chat, bus } = fixture.daemon;
    const project = store.createProject({
      name: "Usage limit",
      room: { widthM: 4, depthM: 5, ceilingHeightM: 2.8 },
    });
    const folder = store.projectPath(project.id);
    const raw =
      'usage limit reached|1900000000\nRESULT {"raw":"private worker diagnostic"}';
    writeFileSync(
      fixture.env.PLANNER_CLAUDE_BIN,
      `#!${process.execPath}\nimport { runFakeCli } from ${JSON.stringify(pathToFileURL(resolve("test/fake-cli/run-fake-cli.mjs")).href)};\nawait runFakeCli({kind:"claude",scenario:{steps:[{kind:"error",message:${JSON.stringify(raw)}}]}});\n`,
      { mode: 0o755 },
    );
    mkdirSync(join(fixture.root, "tools"), { recursive: true });
    writeFileSync(
      join(fixture.root, "tools/blender"),
      '#!/bin/sh\necho "Blender 5.3.0"\n',
      { mode: 0o755 },
    );
    mkdirSync(join(folder, "photos/upright"), { recursive: true });
    mkdirSync(join(folder, "photos/vision"), { recursive: true });
    for (const name of ["upright", "vision"])
      copyFileSync(
        resolve("packages/daemon/catalog/charging-port/thumb.png"),
        join(folder, "photos", name, "photo.jpg"),
      );
    writeJson({
      path: join(folder, "photos/photos.json"),
      value: {
        version: 1,
        photos: [
          {
            photoId: "photo",
            origin: "chat",
            sourceFileName: "photo.png",
            widthPx: 512,
            heightPx: 512,
            orientation: 1,
            blurScore: 1,
            kind: "accepted",
            uprightPath: "upright/photo.jpg",
            visionPath: "vision/photo.jpg",
            visionWidthPx: 512,
            visionHeightPx: 512,
          },
        ],
      },
    });
    const runtime = createAgentRuntime({ env: fixture.env });
    const common = {
      store,
      chat,
      bus,
      runtime,
      env: fixture.env,
      logger: createLogger(),
      config: createDefaultConfig,
      plannerHome: fixture.env.PLANNER_HOME,
      agentSlots: createTurnSlots({ size: 2 }),
      workerSlots: createTurnSlots({ size: 1 }),
      link: () => ({ token: "unused", wsUrl: "ws://127.0.0.1:1" }),
    };
    const generation = createGenerationQueue({ ...common, allowedHosts: [] });
    const surfaces = createSurfaceQueue(common);
    try {
      const jobId =
        kind === "generation"
          ? generation.generate({
              projectId: project.id,
              spec: {
                name: "Sofa",
                prompt: "Sofa",
                reference: { kind: "photo", photoId: "photo" },
                sizeM: { width: 2, height: 1, depth: 1 },
                placement: {
                  kind: "floor",
                  xM: 0,
                  zM: 0,
                  elevationM: 0,
                  rotationRad: 0,
                },
              },
            }).jobId
          : surfaces
              .start({
                projectId: project.id,
                target: { kind: "surface", surfaceId: "floor" },
                prompt: "Sage paint",
              })
              .jobIds.at(0);
      await vi.waitFor(
        () =>
          expect(
            [...generation.list(), ...surfaces.list()].find(
              (job) => job.id === jobId,
            )?.stage,
          ).toBe("failed"),
        { timeout: 10000 },
      );
      const job = [...generation.list(), ...surfaces.list()].find(
        (job) => job.id === jobId,
      );
      expect(job?.error).toBe(
        kind === "generation"
          ? "Modeler usage limit reached; resets at 2030-03-17T17:46:40.000Z; see the job log"
          : "Error: Surfacer usage limit reached; resets at 2030-03-17T17:46:40.000Z; see the job log",
      );
      expect(JSON.stringify(chat.list(project.id))).not.toContain("RESULT");
      expect(JSON.stringify(chat.list(project.id))).not.toContain(
        "private worker diagnostic",
      );
      const log = readFileSync(
        join(
          folder,
          ".planner",
          kind === "generation" ? "generation" : "surfaces",
          jobId ?? "",
          "worker.log",
        ),
        "utf8",
      );
      expect(log).toContain('RESULT {"raw":"private worker diagnostic"}');
    } finally {
      await Promise.all([generation.stopAll(), surfaces.stopAll()]);
      runtime.killAll();
      await fixture.close();
    }
  });
}
