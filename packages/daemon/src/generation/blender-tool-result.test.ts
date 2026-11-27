import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { CHARGING_PORT } from "@planner/shared/src/catalog/charging-port.ts";
import { CommandAckSchema } from "@planner/shared/src/protocol/command-ack-schema.ts";
import { ServerMessageSchema } from "@planner/shared/src/protocol/server-message-schema.ts";
import { expect, test, vi } from "vitest";
import { z } from "zod";
import { createTestFixture } from "../create-test-fixture.ts";
import { readProjectJobRecords } from "../jobs/read-project-job-records.ts";
import { readModelRegistry } from "../preflight/read-model-registry.ts";
import { SurfaceRecordSchema } from "../surfaces/surface-record-schema.ts";
import { writeJson } from "../util/write-json.ts";
import { GenerationRecordSchema } from "./generation-record-schema.ts";

for (const kind of ["generation", "surface"]) {
  test(`${kind} Blender tool receives a traceback and exit code while alternatives wait for the machine`, async () => {
    const fixture = await createTestFixture({
      env(root) {
        const registry = readModelRegistry(undefined);
        registry.models = registry.models.map((model) => ({
          ...model,
          files: [{ path: "fixture.safetensors", sizeBytes: 4 }],
        }));
        const registryPath = join(root, "registry.json");
        writeJson({ path: registryPath, value: registry });
        for (const model of registry.models) {
          const directory = join(root, "weights", model.folder);
          mkdirSync(directory, { recursive: true });
          writeFileSync(join(directory, "fixture.safetensors"), "data");
        }
        return {
          PLANNER_CLAUDE_BIN: join(root, "tool-claude"),
          PLANNER_PYTHON_BIN: resolve(
            "packages/daemon/test/fixtures/timeout-python.mjs",
          ),
          PLANNER_MODEL_REGISTRY: registryPath,
          PLANNER_WEIGHTS_DIR: join(root, "weights"),
          PLANNER_MACHINE_LOCK: join(root, "machine.lock"),
        };
      },
    });
    try {
      const { store } = fixture.daemon;
      const project = store.createProject({
        name: "Blender tool",
        room: { widthM: 4, depthM: 5, ceilingHeightM: 2.8 },
      });
      const folder = store.projectPath(project.id);
      for (const directory of ["photos/upright", "photos/vision"])
        mkdirSync(join(folder, directory), { recursive: true });
      for (const directory of ["upright", "vision"])
        copyFileSync(
          resolve("packages/daemon/catalog/charging-port/thumb.png"),
          join(folder, "photos", directory, "photo.jpg"),
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
      mkdirSync(join(fixture.root, "tools"), { recursive: true });
      writeFileSync(
        join(fixture.root, "tools/blender"),
        `#!${process.execPath}\nif(process.argv.includes("--version"))console.log("Blender 5.3.0");else{process.stderr.write("x".repeat(10000)+"\\nTraceback: PRIVATE_BLENDER_DIAGNOSTIC\\n");process.exitCode=7;}\n`,
        { mode: 0o755 },
      );
      const spec = {
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
      };
      const designerStep =
        kind === "generation"
          ? { kind: "tool", name: "asset_generate", arguments: spec }
          : {
              kind: "tool",
              name: "surface_set",
              arguments: {
                target: { kind: "surface", surfaceId: "floor" },
                prompt: "Sage paint",
              },
            };
      const script = `#!${process.execPath}
import {readFileSync} from 'node:fs';
import {runFakeCli} from ${JSON.stringify(pathToFileURL(resolve("test/fake-cli/run-fake-cli.mjs")).href)};
const at=process.argv.indexOf('--mcp-config');
const role=at<0?'designer':JSON.parse(readFileSync(process.argv[at+1],'utf8')).mcpServers.planner.env.PLANNER_ROLE;
const steps=role==='designer'?[${JSON.stringify(designerStep)},{kind:'text',text:'Queued.'}]:[
{kind:'tool',name:'modeler_write',arguments:{path:'broken.py',text:'raise RuntimeError("broken")'}},
{kind:'tool',name:'blender_run',arguments:{path:'broken.py'}},
{kind:'tool',name:'modeler_write',arguments(results){return {path:'tool-result.txt',text:JSON.stringify(results.blender_run)}}},
{kind:'text',text:'Tool result recorded.'}];
await runFakeCli({kind:'claude',scenario:{steps}});
`;
      writeFileSync(fixture.env.PLANNER_CLAUDE_BIN, script, { mode: 0o755 });
      store.applyCommand({
        projectId: project.id,
        requestId: undefined,
        command: {
          type: "item.add",
          item: {
            id: "port",
            name: "Port",
            model: { kind: "asset", assetId: CHARGING_PORT.assetId },
            placement: {
              kind: "wall",
              wallId: project.scene.room.walls.at(0)?.id ?? "",
              alongM: 1,
              heightM: 0.3,
              rotationRad: 0,
            },
            sizeM: CHARGING_PORT.sizeM,
            locked: false,
          },
        },
      });
      mkdirSync(join(fixture.root, "machine.lock"));
      writeFileSync(
        join(join(fixture.root, "machine.lock"), "holder"),
        `${process.pid} fake-holder`,
      );
      const browser = await fixture.connectBrowser();
      const started = CommandAckSchema.parse(
        await browser.command({
          type: "generation.alternatives",
          projectId: project.id,
          itemId: "port",
        }),
      );
      expect(started.ok).toBe(true);
      await vi.waitFor(
        () => {
          const waiting = browser.received.flatMap((raw) => {
            const frame = ServerMessageSchema.parse(raw);
            return frame.type === "event" &&
              frame.event.kind === "job.updated" &&
              frame.event.job.waitingFor === "machine"
              ? [frame.event.job.id]
              : [];
          });
          expect(new Set(waiting).size).toBe(2);
        },
        { timeout: 10000 },
      );
      const chat = CommandAckSchema.parse(
        await browser.command({
          type: "chat.send",
          projectId: project.id,
          text: "Build the fixture",
        }),
      );
      expect(chat.ok).toBe(true);
      await vi.waitFor(
        () =>
          expect(
            readProjectJobRecords(folder).find(
              (record) => record.job.kind === kind,
            )?.job.stage,
          ).toBe("failed"),
        { timeout: 10000 },
      );
      const record = z
        .union([GenerationRecordSchema, SurfaceRecordSchema])
        .parse(
          readProjectJobRecords(folder).find(
            (record) => record.job.kind === kind,
          ),
        );
      const directory = join(
        folder,
        ".planner",
        kind === "generation" ? "generation" : "surfaces",
        record?.job.id ?? "",
      );
      expect(existsSync(join(directory, "tool-result.txt"))).toBe(true);
      const result = z
        .object({ code: z.number(), output: z.string() })
        .parse(
          JSON.parse(readFileSync(join(directory, "tool-result.txt"), "utf8")),
        );
      expect(result.code).toBe(7);
      expect(result.output).toHaveLength(8000);
      expect(result.output).toContain("Traceback: PRIVATE_BLENDER_DIAGNOSTIC");
      expect(record?.job.error).not.toContain("PRIVATE_BLENDER_DIAGNOSTIC");
      expect(
        JSON.stringify(fixture.daemon.chat.list(project.id)),
      ).not.toContain("PRIVATE_BLENDER_DIAGNOSTIC");
      expect(existsSync(join(fixture.root, "machine.lock"))).toBe(true);
      expect(
        readProjectJobRecords(folder)
          .filter((record) => record.job.kind === "generation-alternative")
          .every((record) => record.job.waitingFor === "machine"),
      ).toBe(true);
      const log = CommandAckSchema.parse(
        await browser.command({ type: "job.log", jobId: record?.job.id }),
      );
      expect(log.ok && JSON.stringify(log.result)).toContain(
        "PRIVATE_BLENDER_DIAGNOSTIC",
      );
    } finally {
      await fixture.close();
    }
  });
}
