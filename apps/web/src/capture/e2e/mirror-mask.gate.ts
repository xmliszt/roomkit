import type { Item } from "@planner/shared/src/scene/item-schema.ts";
import { expect, test } from "@playwright/test";
import { createProject } from "../../../../../e2e/create-project.ts";
import { projectToScreen } from "../../../../../e2e/project-to-screen.ts";
import { sendDaemonCommand } from "../../../../../e2e/send-daemon-command.ts";
import { mirrorMaskFixture } from "./mirror-mask-fixture.ts";

const viewport = { width: 1440, height: 900 };
const camera = {
  positionM: { x: 0, y: 1.3, z: 6 },
  targetM: { x: 0, y: 0.7, z: 0 },
};

const cases = [
  { kind: "present", transformed: false, name: "base-map UV channel" },
  { kind: "present", transformed: true, name: "base-map UV transform" },
  {
    kind: "present",
    transformed: false,
    repeated: true,
    name: "repeating transformed base-map UVs",
  },
  { kind: "missing", name: "missing colour mask" },
  { kind: "invalid", name: "invalid colour mask" },
] satisfies (
  | { kind: "present"; transformed: boolean; repeated?: boolean; name: string }
  | { kind: "missing" | "invalid"; name: string }
)[];

for (const example of cases) {
  test(`a textured item keeps its model and colour adjustment through mirror and undo with ${example.name}`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(viewport);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const project = await createProject({
      name: "Masked mirror",
      widthM: 6,
      depthM: 6,
      ceilingHeightM: 2.6,
    });
    const item = {
      id: "masked-item",
      name: "Masked item",
      model: { kind: "asset", assetId: "masked-model" },
      placement: { kind: "floor", xM: 0, zM: 0, elevationM: 0, rotationRad: 0 },
      sizeM: { width: 1, height: 1, depth: 1 },
      colorAdjust: { kind: "colorize", color: "#0000ff", strength: 1 },
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
    const fixture = mirrorMaskFixture({
      transformed: example.kind === "present" && example.transformed,
      repeated: example.kind === "present" && example.repeated === true,
    });
    await page.route("**/assets/masked-model/*", async (route) => {
      const file = route.request().url().split("/").at(-1);
      if (file === "meta.json")
        await route.fulfill({
          json: {
            id: "masked-model",
            kind: "catalog",
            mount: "floor",
            nativeSizeM: item.sizeM,
            triangleCount: 12,
            hasColorMask: true,
            referenceLuma: 0.5,
            provenance: { method: "test", sourcePhotoIds: [] },
          },
        });
      else if (file === "colorMask.png" && example.kind !== "present")
        await route.fulfill({
          status: example.kind === "missing" ? 404 : 200,
          contentType: "image/png",
          body: "invalid image",
        });
      else
        await route.fulfill({
          contentType:
            file === "colorMask.png" ? "image/png" : "model/gltf-binary",
          body: file === "colorMask.png" ? fixture.mask : fixture.glb,
        });
    });
    const points = [-0.3, 0.3].map((xM) =>
      projectToScreen({ camera, viewport, pointM: { x: xM, y: 0.7, z: 0.5 } }),
    );
    async function colors() {
      const png = await page.locator("canvas").first().screenshot();
      return page.evaluate(
        async (input) => {
          const image = new Image();
          image.src = `data:image/png;base64,${input.base64}`;
          await image.decode();
          const canvas = document.createElement("canvas");
          canvas.width = image.width;
          canvas.height = image.height;
          const context = canvas.getContext("2d");
          if (!context) throw new Error("Missing mask pixel context");
          context.drawImage(image, 0, 0);
          return input.points.map((point) => {
            const [r = 0, g = 0, b = 0] = context.getImageData(
              Math.round(point.x),
              Math.round(point.y),
              1,
              1,
            ).data;
            return {
              isBlue: b > r * 2 && b > g * 2 && b > 80,
              isGrey:
                Math.abs(r - g) < 3 && Math.abs(g - b) < 3 && r > 80 && r < 230,
            };
          });
        },
        { base64: png.toString("base64"), points },
      );
    }
    await page.goto(`/projects/${project.id}`);
    const originalColors =
      example.kind !== "present"
        ? [
            { isBlue: true, isGrey: false },
            { isBlue: true, isGrey: false },
          ]
        : example.transformed
          ? [
              { isBlue: false, isGrey: true },
              { isBlue: true, isGrey: false },
            ]
          : [
              { isBlue: true, isGrey: false },
              { isBlue: false, isGrey: true },
            ];
    await expect.poll(colors).toEqual(originalColors);
    const select = points.at(0);
    if (!select) throw new Error("Missing mask point");
    await page.mouse.click(select.x, select.y);
    await page.getByRole("button", { name: "mirror", exact: true }).click();
    await expect.poll(colors).toEqual(originalColors.toReversed());
    await page.screenshot({ path: testInfo.outputPath("mirrored-mask.png") });
    await page.keyboard.press("ControlOrMeta+z");
    await expect.poll(colors).toEqual(originalColors);
    expect(errors).toEqual([]);
  });
}
