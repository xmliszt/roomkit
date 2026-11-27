import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createDefaultConfig } from "@planner/shared/src/config/create-default-config.ts";
import { expect, test, vi } from "vitest";
import { createAgentRuntime } from "../agent/create-agent-runtime.ts";
import { createTurnSlots } from "../chat/create-turn-slots.ts";
import { createTestFixture } from "../create-test-fixture.ts";
import { readProjectJobRecords } from "../jobs/read-project-job-records.ts";
import { createLogger } from "../util/logger.ts";
import { createSurfaceQueue } from "./create-surface-queue.ts";

for (const waitingFor of [
  "preflight",
  "agent slot",
  "retry after failed save",
]) {
  test(`cancelled surfaces survive ${waitingFor} and restart`, async () => {
    const fixture = await createTestFixture();
    const { store, chat, bus } = fixture.daemon;
    const project = store.createProject({
      name: "cancelled surface",
      room: { widthM: 4, depthM: 5, ceilingHeightM: 2.8 },
    });
    const tools = join(fixture.root, "tools");
    mkdirSync(tools, { recursive: true });
    writeFileSync(join(tools, "blender"), '#!/bin/sh\necho "Blender 4.5.0"\n', {
      mode: 0o755,
    });
    const agentSlots = createTurnSlots({ size: 1 });
    const release = await agentSlots.acquire(new AbortController().signal);
    const runtime = createAgentRuntime({ env: fixture.env });
    const runTurn = vi
      .spyOn(runtime, "runTurn")
      .mockRejectedValue(new Error("Unexpected surfacer turn"));
    function buildQueue() {
      return createSurfaceQueue({
        store,
        chat,
        bus,
        logger: createLogger(),
        runtime,
        config: createDefaultConfig,
        env: fixture.env,
        plannerHome: join(fixture.root, "planner"),
        agentSlots,
        workerSlots: createTurnSlots({ size: 1 }),
        link: () => ({ wsUrl: "ws://127.0.0.1:9", token: "unused" }),
      });
    }
    const queue = buildQueue();
    const restarted = buildQueue();
    try {
      if (waitingFor === "retry after failed save") {
        const jobsPath = join(
          store.projectPath(project.id),
          ".planner",
          "jobs.json",
        );
        mkdirSync(jobsPath);
        expect(() =>
          queue.start({
            projectId: project.id,
            target: { kind: "surface", surfaceId: "floor" },
            prompt: "sage paint",
          }),
        ).toThrow();
        expect(queue.list()).toEqual([]);
        expect(chat.list(project.id)).toEqual([]);
        rmSync(jobsPath, { recursive: true });
      }
      const jobId = queue
        .start({
          projectId: project.id,
          target: { kind: "surface", surfaceId: "floor" },
          prompt: "sage paint",
        })
        .jobIds.at(0);
      if (!jobId) throw new Error("Missing surface job");
      if (waitingFor === "agent slot")
        await vi.waitFor(() =>
          expect(
            existsSync(
              join(
                store.projectPath(project.id),
                ".planner",
                "surfaces",
                jobId,
                "job.json",
              ),
            ),
          ).toBe(true),
        );
      expect(queue.list().at(0)?.stage).toBe("queued");
      expect(() => queue.cancel({ projectId: "other-project", jobId })).toThrow(
        "Unknown job in this project",
      );
      expect(queue.cancel({ projectId: project.id, jobId })).toEqual({
        jobId,
        stage: "cancelled",
      });
      expect(() => queue.cancel({ projectId: project.id, jobId })).toThrow(
        "Only queued jobs",
      );
      await queue.stopAll();
      release?.();
      await restarted.resume();
      await restarted.stopAll();
      expect(restarted.list().at(0)?.stage).toBe("cancelled");
      expect(
        readProjectJobRecords(store.projectPath(project.id)).at(0)?.job.stage,
      ).toBe("cancelled");
      expect(store.loadProject(project.id).scene.room.surfaces).toEqual(
        project.scene.room.surfaces,
      );
      expect(
        chat.list(project.id).find((message) => message.id === jobId)?.status,
      ).toBe("done");
      expect(runTurn).not.toHaveBeenCalled();
    } finally {
      await queue.stopAll();
      await restarted.stopAll();
      runTurn.mockRestore();
      await fixture.close();
    }
  });
}
