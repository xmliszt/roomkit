import { ProjectSchema } from "@planner/shared/src/project/project-schema.ts";
import {
  type Camera,
  CameraSchema,
} from "@planner/shared/src/scene/camera-schema.ts";
import type { Item } from "@planner/shared/src/scene/item-schema.ts";
import { expect, type Page, test } from "@playwright/test";
import { generationFixture } from "../apps/web/e2e/generation-fixture.ts";
import { createProject } from "./create-project.ts";
import { projectToScreen } from "./project-to-screen.ts";
import { sendDaemonCommand } from "./send-daemon-command.ts";

const camera = {
  positionM: { x: 0, y: 4, z: 6 },
  targetM: { x: 0, y: 0, z: 0 },
} satisfies Camera;
const placement = {
  kind: "floor",
  xM: 0,
  zM: 0,
  elevationM: 0,
  rotationRad: 0,
} satisfies Item["placement"];
const kinds = {
  pending: {
    model: { kind: "pending", jobId: "orbit-job" },
    sizeM: { width: 0.6, height: 0.6, depth: 0.6 },
  },
  asset: {
    model: { kind: "asset", assetId: "orbit-model" },
    sizeM: { width: 0.6, height: 0.6, depth: 0.6 },
  },
  rug: {
    model: { kind: "pending", jobId: "orbit-rug-job" },
    sizeM: { width: 1.6, height: 0.01, depth: 1.2 },
  },
} satisfies {
  [key: string]: { model: Item["model"]; sizeM: Item["sizeM"] };
};

function getAzimuthRad(view: Camera) {
  return Math.atan2(
    view.positionM.x - view.targetM.x,
    view.positionM.z - view.targetM.z,
  );
}

function getAngleBetweenRad(options: { from: number; to: number }) {
  return Math.atan2(
    Math.sin(options.to - options.from),
    Math.cos(options.to - options.from),
  );
}

async function readCamera(page: Page) {
  const value = await page.getByTestId("scene").getAttribute("data-camera");
  return CameraSchema.parse(JSON.parse(value ?? "null"));
}

async function readPlacement(projectId: string) {
  const project = ProjectSchema.parse(
    await sendDaemonCommand({ type: "project.open", projectId }),
  );
  return project.scene.items.at(0)?.placement;
}

async function openRoom(options: { page: Page; kind: keyof typeof kinds }) {
  const { page } = options;
  const project = await createProject({
    name: "Orbit drag",
    widthM: 5,
    depthM: 5,
    ceilingHeightM: 2.6,
  });
  await sendDaemonCommand({
    type: "scene.apply",
    projectId: project.id,
    command: { type: "camera.set", camera },
  });
  await sendDaemonCommand({
    type: "scene.apply",
    projectId: project.id,
    command: {
      type: "item.add",
      item: {
        id: "orbit-item",
        name: "Orbit item",
        ...kinds[options.kind],
        placement,
        locked: false,
      } satisfies Item,
    },
  });
  const model = { served: 0 };
  const glb = generationFixture().glb;
  await page.route("**/assets/orbit-model/*", async (route) => {
    const url = route.request().url();
    if (url.endsWith("model.glb")) {
      model.served += 1;
      await route.fulfill({ contentType: "model/gltf-binary", body: glb });
    } else if (url.endsWith("meta.json"))
      await route.fulfill({
        json: {
          id: "orbit-model",
          kind: "catalog",
          nativeSizeM: kinds.asset.sizeM,
          mount: "floor",
          triangleCount: 12,
          hasColorMask: false,
          provenance: { method: "test", sourcePhotoIds: [] },
        },
      });
    else await route.fulfill({ status: 404 });
  });
  await page.goto(`/projects/${project.id}`);
  await expect(page.getByTestId("item-tag")).toBeAttached();
  await expect(page.getByTestId("scene")).toHaveAttribute(
    "data-camera",
    /positionM/,
  );
  if (options.kind === "asset")
    await expect
      .poll(() => model.served, { message: "the asset GLB loads" })
      .toBeGreaterThan(0);
  if (options.kind === "asset")
    await expect(page.getByTestId("item-tag")).toHaveAttribute(
      "data-load-in-stage",
      "done",
    );
  const viewport = page.viewportSize() ?? { width: 1440, height: 900 };
  function screen(pointM: { x: number; y: number; z: number }) {
    return projectToScreen({ camera, pointM, viewport });
  }
  return { projectId: project.id, screen, heightPx: viewport.height };
}

async function drag(options: {
  page: Page;
  path: { x: number; y: number }[];
  onStep?: (index: number) => Promise<void>;
}) {
  const { page } = options;
  const [first, ...rest] = options.path;
  if (!first) return;
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  let from = first;
  for (const [index, to] of rest.entries()) {
    for (let step = 1; step <= 25; step++)
      await page.mouse.move(
        from.x + ((to.x - from.x) * step) / 25,
        from.y + ((to.y - from.y) * step) / 25,
      );
    from = to;
    await options.onStep?.(index);
  }
  await page.mouse.up();
}

async function expectOrbitedWithoutGrab(options: {
  page: Page;
  projectId: string;
}) {
  const { page } = options;
  await expect
    .poll(async () => (await readCamera(page)).positionM.x, {
      message: "the orbit moved the camera",
    })
    .not.toBe(camera.positionM.x);
  await expect(
    page.getByRole("complementary", { name: "Inspector" }),
    "nothing is selected",
  ).toHaveCount(0);
  expect(
    await readPlacement(options.projectId),
    "the item did not move",
  ).toEqual(placement);
}

for (const kind of ["pending", "asset", "rug"] as const)
  for (const labelsShown of [false, true])
    test(`a left drag from the floor orbits across a ${kind} item with labels ${labelsShown ? "on" : "off"}`, async ({
      page,
    }) => {
      const room = await openRoom({ page, kind });
      if (labelsShown) await page.keyboard.press("l");
      const tags = page.locator('[data-testid="item-tag"]:visible');
      await expect(tags).toHaveCount(labelsShown ? 1 : 0);
      const path = [
        room.screen({ x: -1, y: 0, z: 0 }),
        room.screen({ x: 0, y: kind === "rug" ? 0 : 0.3, z: 0 }),
        room.screen({ x: 0, y: kind === "rug" ? 0.08 : 0.68, z: 0 }),
        room.screen({ x: 0.9, y: 0, z: 0 }),
      ];
      await drag({ page, path });
      const afterItemPx = (path.at(3)?.x ?? 0) - (path.at(2)?.x ?? 0);
      await expect
        .poll(
          async () =>
            Math.abs(
              getAngleBetweenRad({
                from: getAzimuthRad(camera),
                to: getAzimuthRad(await readCamera(page)),
              }),
            ),
          {
            message:
              "the orbit kept turning for the drag after it crossed the item and its tag",
          },
        )
        .toBeGreaterThan(
          (2 * Math.PI * ((path.at(1)?.x ?? 0) - (path.at(0)?.x ?? 0))) /
            room.heightPx +
            (2 * Math.PI * afterItemPx * 0.8) / room.heightPx,
        );
      await expectOrbitedWithoutGrab({ page, projectId: room.projectId });
    });

test("an orbit released over an HTML overlay grabs nothing", async ({
  page,
}) => {
  const room = await openRoom({ page, kind: "pending" });
  const strip = await page
    .getByRole("button", { name: "labelsL", exact: true })
    .boundingBox();
  if (!strip) throw new Error("the labels button has no box");
  await drag({
    page,
    path: [
      room.screen({ x: -2, y: 0, z: 0 }),
      room.screen({ x: 0, y: 0.3, z: 0 }),
      { x: strip.x + strip.width / 2, y: strip.y + strip.height / 2 },
    ],
  });
  await expectOrbitedWithoutGrab({ page, projectId: room.projectId });
  const box = room.screen({ x: 0, y: 0.3, z: 0 });
  await page.mouse.move(box.x, box.y, { steps: 5 });
  await page.mouse.move(box.x + 120, box.y, { steps: 5 });
  await expect(
    page.getByRole("complementary", { name: "Inspector" }),
    "hovering after it selects nothing",
  ).toHaveCount(0);
});

const losses = {
  "release event": () =>
    window.addEventListener(
      "pointerup",
      (event) => event.stopImmediatePropagation(),
      { capture: true, once: true },
    ),
  "release event and the moves before the next press": () => {
    function swallow(event: Event) {
      event.stopImmediatePropagation();
    }
    window.addEventListener(
      "pointerup",
      (event) => {
        swallow(event);
        window.addEventListener("pointermove", swallow, true);
        window.addEventListener(
          "pointerdown",
          () => window.removeEventListener("pointermove", swallow, true),
          { capture: true, once: true },
        );
      },
      { capture: true, once: true },
    );
  },
};

for (const [loss, install] of Object.entries(losses))
  test(`an item drag that loses its ${loss} does not move the item on the next orbit`, async ({
    page,
  }) => {
    const room = await openRoom({ page, kind: "pending" });
    const box = room.screen({ x: 0, y: 0.3, z: 0 });
    await page.mouse.move(box.x, box.y);
    await page.evaluate(install);
    await page.mouse.down();
    await page.mouse.move(box.x + 2, box.y);
    await page.mouse.up();
    await expect(
      page.getByRole("complementary", { name: "Inspector" }),
      "the press selected the item",
    ).toHaveCount(1);
    await drag({
      page,
      path: [
        room.screen({ x: -2, y: 0, z: 1 }),
        room.screen({ x: 1, y: 0, z: 1 }),
      ],
    });
    await expect
      .poll(async () => (await readCamera(page)).positionM.x, {
        message: "the drag orbited",
      })
      .not.toBe(camera.positionM.x);
    expect(
      await readPlacement(room.projectId),
      "the item did not move",
    ).toEqual(placement);
  });

test("an item drag stops without moving the item when the window loses focus", async ({
  page,
}) => {
  const room = await openRoom({ page, kind: "pending" });
  const box = room.screen({ x: 0, y: 0.3, z: 0 });
  await page.mouse.move(box.x, box.y);
  await page.mouse.down();
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await page.mouse.move(box.x + 150, box.y, { steps: 10 });
  await page.mouse.up();
  await drag({
    page,
    path: [
      room.screen({ x: -2, y: 0, z: 1 }),
      room.screen({ x: 1, y: 0, z: 1 }),
    ],
  });
  await expect
    .poll(async () => (await readCamera(page)).positionM.x, {
      message: "the next drag orbited",
    })
    .not.toBe(camera.positionM.x);
  expect(await readPlacement(room.projectId), "the item did not move").toEqual(
    placement,
  );
});

test("a press on an item still selects and moves it", async ({ page }) => {
  const room = await openRoom({ page, kind: "asset" });
  await drag({
    page,
    path: [
      room.screen({ x: 0, y: 0.3, z: 0 }),
      room.screen({ x: 1, y: 0.3, z: 0 }),
    ],
  });
  await expect
    .poll(
      async () => {
        const moved = await readPlacement(room.projectId);
        return moved?.kind === "floor" ? moved.xM : 0;
      },
      { message: "the item moved right" },
    )
    .toBeGreaterThan(0.5);
  await expect(
    page.getByRole("complementary", { name: "Inspector" }),
  ).toHaveCount(1);
  expect((await readCamera(page)).positionM, "the camera stayed").toEqual(
    camera.positionM,
  );
  const floor = room.screen({ x: -1.5, y: 0, z: -1 });
  await page.mouse.click(floor.x, floor.y);
  await expect(
    page.getByRole("complementary", { name: "Inspector" }),
    "a click on empty floor clears the selection",
  ).toHaveCount(0);
});
