import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Item } from "@planner/shared/src/scene/item-schema.ts";
import { expect, test } from "@playwright/test";
import type { Scene } from "three";
import { generationFixture } from "../apps/web/e2e/generation-fixture.ts";
import { candelaPerLumen } from "../apps/web/src/editor/scene/lighting/candela-per-lumen.ts";
import { createProject } from "./create-project.ts";
import { sendDaemonCommand } from "./send-daemon-command.ts";

declare global {
  interface Window {
    __THREE_DEVTOOLS__: EventTarget;
    lampScenes: Scene[];
  }
}

test("lamp intensity follows page-clock frames between off and full", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.clock.install();
  await page.addInitScript(() => {
    window.lampScenes = [];
    window.__THREE_DEVTOOLS__ = new EventTarget();
    window.__THREE_DEVTOOLS__.addEventListener("observe", (event) => {
      if (!(event instanceof CustomEvent)) return;
      function isScene(value: unknown): value is Scene {
        return (
          typeof value === "object" &&
          value !== null &&
          "isScene" in value &&
          value.isScene === true
        );
      }
      if (isScene(event.detail)) window.lampScenes.push(event.detail);
    });
  });
  const project = await createProject({
    name: "Light fade",
    widthM: 4,
    depthM: 4,
    ceilingHeightM: 2.6,
  });
  const root = process.env.PLANNER_E2E_HOME;
  if (!root) throw new Error("Missing isolated project folder");
  const folder = join(root, "projects", project.id, "assets", "lamp-block");
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, "model.glb"), generationFixture().glb);
  writeFileSync(
    join(folder, "meta.json"),
    JSON.stringify({
      id: "lamp-block",
      kind: "catalog",
      nativeSizeM: { width: 1, height: 1, depth: 1 },
      mount: "floor",
      triangleCount: 12,
      hasColorMask: false,
      provenance: { method: "test", sourcePhotoIds: [] },
    }),
  );
  const light = {
    on: false,
    emitter: { x: 0.5, y: 0.85, z: 0.5 },
    lumens: 400,
    temperatureK: 2700,
  };
  await sendDaemonCommand({
    type: "scene.apply",
    projectId: project.id,
    command: {
      type: "item.add",
      item: {
        id: "lamp",
        name: "Lamp",
        model: { kind: "asset", assetId: "lamp-block" },
        placement: {
          kind: "floor",
          xM: 0,
          zM: 0,
          elevationM: 0,
          rotationRad: 0,
        },
        sizeM: { width: 0.3, height: 0.5, depth: 0.3 },
        light,
        locked: false,
      } satisfies Item,
    },
  });
  await page.goto(`/projects/${project.id}`);
  await expect(page.getByTestId("item-tag").first()).toHaveAttribute(
    "data-load-in-stage",
    "done",
  );
  async function intensity() {
    return page.evaluate(() => {
      const values: number[] = [];
      for (const scene of window.lampScenes)
        scene.traverse((object) => {
          if (
            object.type === "PointLight" &&
            "intensity" in object &&
            typeof object.intensity === "number"
          )
            values.push(object.intensity);
        });
      return Math.max(-1, ...values);
    });
  }
  expect(await intensity()).toBe(0);
  await page.clock.pauseAt(new Date());
  await sendDaemonCommand({
    type: "scene.apply",
    projectId: project.id,
    command: {
      type: "item.update",
      itemId: "lamp",
      patch: { light: { ...light, on: true } },
    },
  });
  for (let frame = 0; frame < 120 && (await intensity()) === 0; frame++)
    await page.clock.runFor(16);
  await page.clock.runFor(48);
  const partial = await intensity();
  expect(partial).toBeGreaterThan(0);
  expect(partial).toBeLessThan(light.lumens * candelaPerLumen);
  await page.clock.runFor(650);
  expect(await intensity()).toBeCloseTo(light.lumens * candelaPerLumen);
  async function shadowCount() {
    return page.evaluate(() => {
      const meshes: boolean[] = [];
      for (const scene of window.lampScenes)
        scene.traverse((object) => {
          if (object.type === "Mesh") meshes.push(object.castShadow);
        });
      return meshes.filter(Boolean).length;
    });
  }
  expect(await shadowCount()).toBe(0);
  await sendDaemonCommand({
    type: "scene.apply",
    projectId: project.id,
    command: { type: "item.update", itemId: "lamp", patch: { light } },
  });
  await expect
    .poll(async () => {
      await page.clock.runFor(16);
      return intensity();
    })
    .toBeLessThan(light.lumens * candelaPerLumen);
  expect(await intensity()).toBeGreaterThan(0);
  expect(await shadowCount()).toBe(0);
  await page.clock.runFor(450);
  expect(await intensity()).toBe(0);
  expect(await shadowCount()).toBeGreaterThan(0);
});
