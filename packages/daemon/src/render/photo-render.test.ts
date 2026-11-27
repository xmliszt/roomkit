import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { RenderJobSchema } from "@planner/shared/src/jobs/job-schema.ts";
import { ProjectSchema } from "@planner/shared/src/project/project-schema.ts";
import { CommandAckSchema } from "@planner/shared/src/protocol/command-ack-schema.ts";
import {
  type RenderView,
  RenderViewSchema,
} from "@planner/shared/src/render/render-view-schema.ts";
import { expect, test, vi } from "vitest";
import { createTestFixture, TEST_WEB_ORIGIN } from "../create-test-fixture.ts";
import { createRenderQueue } from "./create-render-queue.ts";

async function fixture(options: { mode?: string } = {}) {
  const fixture = await createTestFixture({
    env: (root) => ({
      BLENDER: resolve("test/fake-tools/blender-photo.mjs"),
      PLANNER_MACHINE_LOCK: join(root, "machine.lock"),
      FAKE_RENDER_MODE: options.mode ?? "done",
      PLANNER_FAKE_SCENARIO: "render-photo",
    }),
  });
  const client = await fixture.connectBrowser();
  const created = CommandAckSchema.parse(
    await client.command({
      type: "project.create",
      name: "Render test",
      room: { widthM: 4, depthM: 5, ceilingHeightM: 2.6 },
    }),
  );
  if (!created.ok) throw new Error(created.error);
  const project = ProjectSchema.parse(created.result);
  const view: RenderView = {
    ...project.scene.camera,
    fovDeg: 32,
    aspect: 16 / 9,
    mode: "orbit",
    hiddenSurfaceIds: ["ceiling", project.scene.room.walls.at(0)?.id ?? ""],
  };
  async function start() {
    const ack = CommandAckSchema.parse(
      await client.command({
        type: "render.start",
        projectId: project.id,
        view,
      }),
    );
    if (!ack.ok) throw new Error(ack.error);
    const result = ack.result;
    if (
      !result ||
      typeof result !== "object" ||
      !("jobId" in result) ||
      typeof result.jobId !== "string"
    )
      throw new Error("No job ID");
    return result.jobId;
  }
  function jobs() {
    return client.received.flatMap((value) => {
      if (!value || typeof value !== "object" || !("event" in value)) return [];
      const event = value.event;
      if (
        !event ||
        typeof event !== "object" ||
        !("kind" in event) ||
        event.kind !== "job.updated" ||
        !("job" in event)
      )
        return [];
      return [event.job];
    });
  }
  return { ...fixture, client, project, view, start, jobs };
}

test("render captures the view, reports samples, publishes a downloadable PNG and includes it in reconnected snapshots", async () => {
  const f = await fixture();
  try {
    const jobId = await f.start();
    await vi.waitFor(
      () =>
        expect(f.jobs()).toContainEqual(
          expect.objectContaining({ id: jobId, stage: "done", progress: 1 }),
        ),
      { timeout: 10_000 },
    );
    expect(f.jobs()).toContainEqual(
      expect.objectContaining({
        id: jobId,
        stage: "rendering",
        progress: 0.25,
      }),
    );
    expect(f.daemon.chat.list(f.project.id).at(-1)?.blocks).toContainEqual(
      expect.objectContaining({
        kind: "render",
        jobId,
        widthPx: 1920,
        heightPx: 1080,
      }),
    );
    const folder = f.daemon.store.projectPath(f.project.id);
    const saved: unknown = JSON.parse(
      readFileSync(
        join(folder, ".planner/render", jobId, "scene.json"),
        "utf8",
      ),
    );
    expect(saved).toMatchObject({ view: f.view, revision: 0 });
    const response = await fetch(
      `http://127.0.0.1:${f.address.port}/projects/${f.project.id}/renders/${jobId}.png?download=1`,
      { headers: { Origin: TEST_WEB_ORIGIN } },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toContain(
      `${jobId}.png`,
    );
    const watcher = await f.connectBrowser();
    expect(await watcher.frame("snapshot")).toMatchObject({
      jobs: expect.arrayContaining([
        expect.objectContaining({
          id: jobId,
          stage: "done",
          startedAt: expect.any(String),
          finishedAt: expect.any(String),
        }),
      ]),
    });
  } finally {
    await f.close();
  }
});

test("saved renders reload and an unfinished render fails with a retry message", async () => {
  const f = await fixture();
  try {
    const jobId = await f.start();
    await vi.waitFor(
      () =>
        expect(f.jobs()).toContainEqual(
          expect.objectContaining({ id: jobId, stage: "done" }),
        ),
      { timeout: 10_000 },
    );
    const restored = createRenderQueue({
      store: f.daemon.store,
      chat: f.daemon.chat,
      bus: f.daemon.bus,
      env: f.env,
      blenderPaths: () => [f.env.BLENDER],
    });
    await restored.resume();
    expect(restored.list()).toContainEqual(
      expect.objectContaining({
        id: jobId,
        stage: "done",
        finishedAt: expect.any(String),
      }),
    );
    const path = join(
      f.daemon.store.projectPath(f.project.id),
      ".planner/render",
      jobId,
      "job.json",
    );
    const saved = RenderJobSchema.parse(JSON.parse(readFileSync(path, "utf8")));
    writeFileSync(
      path,
      JSON.stringify({
        ...saved,
        stage: "rendering",
        progress: 0.5,
        finishedAt: undefined,
      }),
    );
    await restored.resume();
    expect(restored.list()).toContainEqual(
      expect.objectContaining({
        id: jobId,
        stage: "failed",
        error:
          "The app stopped before this render finished. Render the view again.",
      }),
    );
  } finally {
    await f.close();
  }
});

test("an active render can be cancelled, releases its machine lock and has no image block", async () => {
  const f = await fixture({ mode: "hold" });
  try {
    const jobId = await f.start();
    await vi.waitFor(
      () =>
        expect(f.jobs()).toContainEqual(
          expect.objectContaining({ id: jobId, stage: "rendering" }),
        ),
      { timeout: 10_000 },
    );
    expect(
      await f.client.command({
        type: "job.cancel",
        projectId: f.project.id,
        jobId,
      }),
    ).toMatchObject({ ok: true, result: { jobId, stage: "cancelled" } });
    expect(existsSync(join(f.root, "machine.lock"))).toBe(false);
    expect(
      f.daemon.chat
        .list(f.project.id)
        .at(-1)
        ?.blocks.some((block) => block.kind === "render"),
    ).toBe(false);
    expect(f.jobs()).toContainEqual(
      expect.objectContaining({
        id: jobId,
        stage: "cancelled",
        error: "Render cancelled",
      }),
    );
  } finally {
    await f.close();
  }
});

test("out of memory is reported in plain words", async () => {
  const f = await fixture({ mode: "oom" });
  try {
    const jobId = await f.start();
    await vi.waitFor(
      () =>
        expect(f.jobs()).toContainEqual(
          expect.objectContaining({
            id: jobId,
            stage: "failed",
            error: "Not enough memory to render this room",
          }),
        ),
      { timeout: 10_000 },
    );
  } finally {
    await f.close();
  }
});

test("a successful CPU fallback publishes its image after GPU memory exhaustion", async () => {
  const f = await fixture({ mode: "fallback" });
  try {
    const jobId = await f.start();
    await vi.waitFor(
      () =>
        expect(f.jobs()).toContainEqual(
          expect.objectContaining({ id: jobId, stage: "done" }),
        ),
      { timeout: 10_000 },
    );
    expect(f.daemon.chat.list(f.project.id).at(-1)?.blocks).toContainEqual(
      expect.objectContaining({ kind: "render", jobId }),
    );
  } finally {
    await f.close();
  }
});

test("removing a project during rendering removes its job from subsequent snapshots", async () => {
  const f = await fixture({ mode: "hold" });
  try {
    const jobId = await f.start();
    await vi.waitFor(
      () =>
        expect(f.jobs()).toContainEqual(
          expect.objectContaining({ id: jobId, stage: "rendering" }),
        ),
      { timeout: 10_000 },
    );
    expect(
      await f.client.command({
        type: "project.remove",
        projectId: f.project.id,
      }),
    ).toMatchObject({ ok: true });
    const browser = await f.connectBrowser();
    expect(await browser.frame("snapshot")).toMatchObject({
      jobs: expect.not.arrayContaining([
        expect.objectContaining({ id: jobId }),
      ]),
    });
  } finally {
    await f.close();
  }
});

test("rejects invalid cameras and surfaces before creating a render", async () => {
  const f = await fixture();
  try {
    expect(
      RenderViewSchema.safeParse({ ...f.view, targetM: f.view.positionM })
        .success,
    ).toBe(false);
    expect(RenderViewSchema.safeParse({ ...f.view, fovDeg: 180 }).success).toBe(
      false,
    );
    expect(
      await f.client.command({
        type: "render.start",
        projectId: f.project.id,
        view: { ...f.view, hiddenSurfaceIds: ["another-room"] },
      }),
    ).toMatchObject({ ok: false });
    expect(
      await f.client.command({
        type: "agent.render.start",
        projectId: f.project.id,
        turnId: crypto.randomUUID(),
      }),
    ).toMatchObject({ ok: false });
  } finally {
    await f.close();
  }
});

test("designer MCP renders the settled viewport and refuses after its browser disconnects", async () => {
  const f = await fixture();
  try {
    expect(
      await f.client.command({
        type: "view.report",
        projectId: f.project.id,
        view: { ...f.view, mode: "walk", fovDeg: 58 },
      }),
    ).toMatchObject({ ok: true });
    expect(
      await f.client.command({
        type: "chat.send",
        projectId: f.project.id,
        text: "Render a photo",
      }),
    ).toMatchObject({ ok: true });
    await vi.waitFor(
      () =>
        expect(f.jobs()).toContainEqual(
          expect.objectContaining({ kind: "render", stage: "done" }),
        ),
      { timeout: 15_000 },
    );
    const count = f.daemon.chat
      .list(f.project.id)
      .filter((message) =>
        message.blocks.some((block) => block.kind === "render"),
      ).length;
    f.client.socket.close();
    await new Promise<void>((resolve) =>
      f.client.socket.once("close", resolve),
    );
    const browser = await f.connectBrowser();
    await browser.command({
      type: "chat.send",
      projectId: f.project.id,
      text: "Render another photo",
    });
    await vi.waitFor(
      () =>
        expect(f.daemon.chat.list(f.project.id).at(-1)?.status).toBe("failed"),
      { timeout: 15_000 },
    );
    expect(
      f.daemon.chat
        .list(f.project.id)
        .filter((message) =>
          message.blocks.some((block) => block.kind === "render"),
        ),
    ).toHaveLength(count);
  } finally {
    await f.close();
  }
});
