import { ProjectSchema } from "@planner/shared/src/project/project-schema.ts";
import { expect, test } from "vitest";
import { getCameraResend } from "../../apps/web/src/editor/get-camera-resend.ts";
import { createPlannerSession } from "../../apps/web/src/ws/create-planner-session.ts";
import { createDaemon } from "../../packages/daemon/src/create-daemon.ts";
import {
  createTestFixture,
  TEST_WEB_ORIGIN,
} from "../../packages/daemon/src/create-test-fixture.ts";

function createBrowserSocket(url: string) {
  // Node's WebSocket takes request headers as a second argument that the DOM type does not declare; a browser sets Origin itself.
  const socket: WebSocket = Reflect.construct(WebSocket, [
    url,
    { headers: { origin: TEST_WEB_ORIGIN } },
  ]);
  return socket;
}

const camera = {
  positionM: { x: 6, y: 4, z: 7 },
  targetM: { x: 0, y: 1, z: 0 },
};

test("opens a watched project, keeps its own command on the echo, and reopens when stale", async () => {
  const fixture = await createTestFixture();
  const session = createPlannerSession({
    url: `ws://127.0.0.1:${fixture.address.port}/ws`,
    createSocket: createBrowserSocket,
  });
  const other = createPlannerSession({
    url: `ws://127.0.0.1:${fixture.address.port}/ws`,
    createSocket: createBrowserSocket,
  });
  try {
    session.start();
    other.start();
    await expect
      .poll(() => session.stores.snapshot.getState().connection)
      .toBe("open");
    const created = await session.command({
      type: "project.create",
      name: "Session",
      room: { widthM: 3.0, depthM: 5.2, ceilingHeightM: 2.7 },
    });
    const projectId = ProjectSchema.parse(
      created.ok ? created.result : undefined,
    ).id;
    session.watchProject(projectId);
    await expect
      .poll(() => session.stores.projects.getState().opened[projectId])
      .toMatchObject({ isStale: false, project: { revision: 0 } });

    expect(
      session.applySceneCommand({
        projectId,
        command: { type: "camera.set", camera },
      }),
    ).toBe(true);
    expect(
      session.stores.projects.getState().opened[projectId]?.project.scene
        .camera,
    ).toStrictEqual(camera);
    await expect
      .poll(() => session.stores.projects.getState().opened[projectId])
      .toMatchObject({
        isStale: false,
        project: { revision: 1, scene: { camera } },
      });
    expect(session.stores.projects.getState().ownRequestIds[projectId]).toEqual(
      [],
    );

    await other.command({
      type: "scene.apply",
      projectId,
      command: { type: "room.update", ceilingHeightM: 3 },
    });
    await expect
      .poll(() => session.stores.projects.getState().opened[projectId])
      .toMatchObject({
        isStale: false,
        project: { revision: 2, scene: { room: { ceilingHeightM: 3 } } },
      });

    session.stores.projects.setState((state) => {
      const entry = state.opened[projectId];
      return entry === undefined
        ? state
        : {
            opened: {
              [projectId]: {
                isStale: false,
                project: {
                  ...entry.project,
                  scene: {
                    ...entry.project.scene,
                    items: [
                      {
                        id: "ghost",
                        name: "Ghost",
                        model: { kind: "asset", assetId: "charging-port" },
                        placement: {
                          kind: "floor",
                          xM: 0,
                          zM: 0,
                          elevationM: 0,
                          rotationRad: 0,
                        },
                        sizeM: { width: 1, height: 1, depth: 1 },
                        locked: false,
                      },
                    ],
                  },
                },
              },
            },
          };
    });
    expect(
      session.applySceneCommand({
        projectId,
        command: { type: "item.remove", itemId: "ghost" },
      }),
    ).toBe(true);
    await expect
      .poll(() => session.stores.projects.getState().ownRequestIds[projectId])
      .toEqual([]);
    await expect
      .poll(() => session.stores.projects.getState().opened[projectId])
      .toMatchObject({
        isStale: false,
        project: { revision: 2, scene: { items: [] } },
      });
  } finally {
    session.stop();
    other.stop();
    await fixture.close();
  }
});

test("records a failed open, does not retry it, and retries on a new watch", async () => {
  const fixture = await createTestFixture();
  const session = createPlannerSession({
    url: `ws://127.0.0.1:${fixture.address.port}/ws`,
    createSocket: createBrowserSocket,
  });
  try {
    session.start();
    const projectId = "00000000-0000-4000-8000-000000000000";
    session.watchProject(projectId);
    await expect
      .poll(() => session.stores.projects.getState().openErrors[projectId])
      .toBeTypeOf("string");
    expect(
      session.stores.projects.getState().opened[projectId],
    ).toBeUndefined();
    session.watchProject(projectId);
    expect(
      session.stores.projects.getState().openErrors[projectId],
    ).toBeUndefined();
    await expect
      .poll(() => session.stores.projects.getState().openErrors[projectId])
      .toBeTypeOf("string");
  } finally {
    session.stop();
    await fixture.close();
  }
});

test("a camera moved while the socket is down is resent after the reopen, never forgotten first", async () => {
  const fixture = await createTestFixture();
  const session = createPlannerSession({
    url: `ws://127.0.0.1:${fixture.address.port}/ws`,
    createSocket: createBrowserSocket,
  });
  let restarted: ReturnType<typeof createDaemon> | undefined;
  try {
    session.start();
    await expect
      .poll(() => session.stores.snapshot.getState().connection)
      .toBe("open");
    const created = await session.command({
      type: "project.create",
      name: "Offline",
      room: { widthM: 4, depthM: 4, ceilingHeightM: 2.5 },
    });
    const projectId = ProjectSchema.parse(
      created.ok ? created.result : undefined,
    ).id;
    session.watchProject(projectId);
    await expect
      .poll(() => session.stores.projects.getState().opened[projectId]?.isStale)
      .toBe(false);
    await fixture.daemon.close();
    await expect
      .poll(() => session.stores.snapshot.getState().connection)
      .toBe("closed");

    const decisions: string[] = [];
    const unsubscribe = session.stores.projects.subscribe((state, previous) => {
      const resend = getCameraResend({
        previous: previous.opened[projectId],
        current: state.opened[projectId],
        moved: camera,
        pendingRequestCount: (state.ownRequestIds[projectId] ?? []).length,
      });
      decisions.push(resend.kind);
    });
    expect(
      session.applySceneCommand({
        projectId,
        command: { type: "camera.set", camera },
      }),
    ).toBe(true);
    await expect
      .poll(() => session.stores.projects.getState().opened[projectId]?.isStale)
      .toBe(true);
    restarted = createDaemon({
      env: { ...fixture.env, PLANNER_PORT: String(fixture.address.port) },
    });
    await restarted.listen();
    await expect
      .poll(() => decisions.includes("resend"), { timeout: 5000 })
      .toBe(true);
    expect(
      decisions.slice(0, decisions.indexOf("resend")),
      "no forget before the resend",
    ).not.toContain("forget");
    unsubscribe();
  } finally {
    session.stop();
    await restarted?.close();
    await fixture.close();
  }
});
