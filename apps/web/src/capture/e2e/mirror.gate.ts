import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ProjectSchema } from "@planner/shared/src/project/project-schema.ts";
import {
  type Item,
  ItemSchema,
} from "@planner/shared/src/scene/item-schema.ts";
import { expect, type Page, test } from "@playwright/test";
import { z } from "zod";
import { createProject } from "../../../../../e2e/create-project.ts";
import { projectToScreen } from "../../../../../e2e/project-to-screen.ts";
import { sendDaemonCommand } from "../../../../../e2e/send-daemon-command.ts";
import { mirrorFixture } from "./mirror-fixture.ts";

const viewport = { width: 1440, height: 900 };

async function savedProject(projectId: string) {
  return ProjectSchema.parse(
    await sendDaemonCommand({ type: "project.open", projectId }),
  );
}

async function pixel(options: {
  page: Page;
  point: { x: number; y: number };
  radiusPx?: number;
}) {
  const png = await options.page.locator("canvas").first().screenshot();
  return options.page.evaluate(
    async (input) => {
      const image = new Image();
      image.src = `data:image/png;base64,${input.base64}`;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Missing pixel context");
      context.drawImage(image, 0, 0);
      const [r = 0, g = 0, b = 0] = context.getImageData(
        Math.round(input.point.x),
        Math.round(input.point.y),
        1,
        1,
      ).data;
      const radiusPx = input.radiusPx;
      const patch = context.getImageData(
        Math.round(input.point.x) - radiusPx,
        Math.round(input.point.y) - radiusPx,
        radiusPx * 2 + 1,
        radiusPx * 2 + 1,
      ).data;
      const dark = Array.from({ length: patch.length / 4 }).filter(
        (_, index) =>
          (patch[index * 4] ?? 255) < 180 &&
          (patch[index * 4 + 1] ?? 255) < 180 &&
          (patch[index * 4 + 2] ?? 255) < 180,
      ).length;
      return { r, g, b, dark, isOrange: r > g * 1.5 && g > b * 1.3 && r > 100 };
    },
    {
      base64: png.toString("base64"),
      point: options.point,
      radiusPx: options.radiusPx ?? 0,
    },
  );
}

for (const isWall of [false, true]) {
  const mount = isWall ? "wall" : "floor";
  test(`${mount} mirror moves the distinctive side, undo restores it, duplicate mirrored persists`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(viewport);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const project = await createProject({
      name: `Mirror ${mount}`,
      widthM: 6,
      depthM: 6,
      ceilingHeightM: 2.6,
    });

    const camera = {
      positionM: { x: 0, y: 1.3, z: 6 },
      targetM: { x: 0, y: 0.7, z: isWall ? -3 : 0 },
    };
    const item = {
      id: "asymmetric-item",
      name: "Asymmetric item",
      model: { kind: "asset", assetId: "asymmetric-model" },
      placement: isWall
        ? {
            kind: "wall",
            wallId: "wall-4",
            alongM: 3,
            heightM: 1,
            rotationRad: 0,
          }
        : { kind: "floor", xM: 0, zM: 0, elevationM: 0, rotationRad: 0 },
      sizeM: { width: 1, height: 1, depth: 0.4 },
      locked: false,
    } satisfies Item;
    await sendDaemonCommand({
      type: "scene.apply",
      projectId: project.id,
      command: { type: "camera.set", camera },
    });
    await sendDaemonCommand({
      type: "scene.apply",
      projectId: project.id,
      command: { type: "item.add", item },
    });
    const fixture = mirrorFixture({ isWall });
    await page.route("**/assets/asymmetric-model/*", async (route) => {
      if (route.request().url().endsWith("model.glb"))
        await route.fulfill({
          contentType: "model/gltf-binary",
          body: fixture.glb,
        });
      else if (route.request().url().endsWith("meta.json"))
        await route.fulfill({
          json: {
            id: "asymmetric-model",
            kind: "catalog",
            nativeSizeM: item.sizeM,
            mount,
            triangleCount: 24,
            hasColorMask: false,
            provenance: { method: "test", sourcePhotoIds: [] },
          },
        });
      else await route.fulfill({ status: 404 });
    });
    const zM = isWall ? -2.6 : 0.2;
    const yM = isWall ? 1.2 : 0.7;
    function screen(xM: number) {
      return projectToScreen({
        camera,
        viewport,
        pointM: { x: xM, y: yM, z: zM },
      });
    }
    async function expectSide(input: { isLeft: boolean; offsetM?: number }) {
      const offsetM = input.offsetM ?? 0;
      await expect
        .poll(
          async () =>
            (await pixel({ page, point: screen(offsetM - 0.3) })).isOrange,
        )
        .toBe(input.isLeft);
      await expect
        .poll(
          async () =>
            (await pixel({ page, point: screen(offsetM + 0.3) })).isOrange,
        )
        .toBe(!input.isLeft);
    }
    await page.goto(`/projects/${project.id}`);
    await expect(page.getByTestId("scene")).toHaveAttribute(
      "data-camera",
      JSON.stringify(camera),
    );
    await expectSide({ isLeft: true });
    const at = screen(-0.3);
    await page.mouse.click(at.x, at.y);
    const inspector = page.getByRole("complementary", { name: "Inspector" });
    const mirror = inspector.getByRole("button", {
      name: "mirror",
      exact: true,
    });
    await expect(mirror).toHaveAttribute("aria-pressed", "false");
    await mirror.click();
    await expect(mirror).toHaveAttribute("aria-pressed", "true");
    await expectSide({ isLeft: false });
    await expect
      .poll(async () => (await savedProject(project.id)).scene.items)
      .toEqual([{ ...item, mirrored: true }]);
    await page.screenshot({
      path: testInfo.outputPath(`${mount}-mirrored.png`),
    });
    await page.keyboard.press("ControlOrMeta+z");
    await expectSide({ isLeft: true });
    await expect
      .poll(async () => (await savedProject(project.id)).scene.items)
      .toEqual([item]);
    await page.getByRole("button", { name: /commands/ }).click();
    await page
      .getByRole("combobox", { name: "Search commands" })
      .fill("mirror");
    await page.getByRole("button", { name: "Mirror", exact: true }).click();
    await expectSide({ isLeft: false });
    await inspector
      .getByRole("button", { name: "duplicate mirrored", exact: true })
      .click();
    await expect
      .poll(async () => (await savedProject(project.id)).scene.items.length)
      .toBe(2);
    const duplicated = await savedProject(project.id);
    const copy = duplicated.scene.items.at(1);
    expect(copy).toMatchObject({ mirrored: false, sizeM: item.sizeM });
    const copyXM = isWall ? -1.1 : 1.1;
    await expectSide({ isLeft: true, offsetM: copyXM });
    await page.keyboard.press("ControlOrMeta+z");
    await expect
      .poll(async () => (await savedProject(project.id)).scene.items)
      .toEqual([{ ...item, mirrored: true }]);
    const originalSide = screen(0.3);
    await page.mouse.click(originalSide.x, originalSide.y);
    await page.getByRole("button", { name: /commands/ }).click();
    await page
      .getByRole("combobox", { name: "Search commands" })
      .fill("duplicate mirrored");
    await page
      .getByRole("combobox", { name: "Search commands" })
      .press("Enter");
    await expect
      .poll(async () => (await savedProject(project.id)).scene.items.length)
      .toBe(2);
    const items = (await savedProject(project.id)).scene.items;
    const root = process.env.PLANNER_E2E_HOME;
    if (!root) throw new Error("Missing test home");
    await expect
      .poll(
        () =>
          ProjectSchema.parse(
            JSON.parse(
              readFileSync(
                join(root, "projects", project.id, "project.json"),
                "utf8",
              ),
            ),
          ).scene.items,
      )
      .toEqual(items);
    await page.reload();
    await expect
      .poll(async () =>
        z
          .array(ItemSchema)
          .parse(
            JSON.parse(
              (await page.getByTestId("scene").getAttribute("data-items")) ??
                "[]",
            ),
          ),
      )
      .toEqual(items);
    await expectSide({ isLeft: false });
    await expectSide({ isLeft: true, offsetM: copyXM });
    await page.screenshot({
      path: testInfo.outputPath(`${mount}-reloaded.png`),
    });
    expect(errors).toEqual([]);
  });
}
