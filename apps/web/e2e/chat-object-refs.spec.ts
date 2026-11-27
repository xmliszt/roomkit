import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Item } from "@planner/shared/src/scene/item-schema.ts";
import { expect, test } from "@playwright/test";
import { createProject } from "../../../e2e/create-project.ts";
import { projectToScreen } from "../../../e2e/project-to-screen.ts";
import { sendDaemonCommand } from "../../../e2e/send-daemon-command.ts";

const evidence =
  process.env.PLANNER_EVIDENCE_DIR ?? "/tmp/planner-b14-evidence";
const viewport = { width: 1440, height: 900 };
const camera = {
  positionM: { x: 5, y: 4.5, z: 6.5 },
  targetM: { x: 0, y: 0.8, z: 0 },
};

test("mentioned objects stay referenced in chat and select their scene item", async ({
  page,
}) => {
  const project = await createProject({
    name: "Object references",
    widthM: 4,
    depthM: 5,
    ceilingHeightM: 2.6,
  });
  const items = ["Coffee table", "Sofa"].map(
    (name, index) =>
      ({
        id: `reference-${index}`,
        name,
        model: { kind: "pending", jobId: `reference-job-${index}` },
        locked: false,
        sizeM: { width: 0.8, depth: 0.6, height: 0.6 },
        placement: {
          kind: "floor",
          xM: index * 1.5,
          zM: 0,
          elevationM: 0,
          rotationRad: 0,
        },
      }) satisfies Item,
  );
  for (const item of items)
    await sendDaemonCommand({
      type: "scene.apply",
      projectId: project.id,
      command: { type: "item.add", item },
    });
  await sendDaemonCommand({
    type: "scene.apply",
    projectId: project.id,
    command: { type: "camera.set", camera },
  });
  await page.goto(`/projects/${project.id}`);
  const input = page.getByRole("textbox", { name: "Message", exact: true });
  await expect(input).toBeVisible();
  await expect(page.getByTestId("scene")).toHaveAttribute(
    "data-camera",
    JSON.stringify(camera),
  );
  await page.mouse.click(
    ...(() => {
      const point = projectToScreen({
        camera,
        pointM: { x: 0, y: 0.3, z: 0 },
        viewport,
      });
      return [point.x, point.y] satisfies [number, number];
    })(),
  );
  const tableChip = page.getByRole("button", {
    name: "Remove reference to Coffee table",
  });
  await expect(
    page.getByRole("heading", { name: "Coffee table", exact: true }),
  ).toBeVisible();
  await expect(tableChip).toHaveCount(0);
  await input.fill("[fake:echo] Fix @");
  await expect(
    page.getByRole("listbox", { name: "Room objects" }),
  ).toBeVisible();
  await expect(page.getByRole("option")).toHaveCount(2);
  await input.press("ArrowDown");
  await expect(
    page.getByRole("option", { name: "Sofa", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await input.press("ArrowUp");
  await input.press("Enter");
  await expect(tableChip).toBeVisible();
  await expect(input).toHaveValue("[fake:echo] Fix ");
  await input.pressSequentially("@Sof");
  await expect(page.getByRole("option")).toHaveCount(1);
  await expect
    .poll(async () => {
      const chips = await page.getByTestId("referenced-objects").boundingBox();
      const composer = await page.getByTestId("composer").boundingBox();
      return chips && composer ? chips.y + chips.height <= composer.y : false;
    })
    .toBe(true);
  mkdirSync(evidence, { recursive: true });
  await page.screenshot({ path: join(evidence, "object-picker.png") });
  await input.press("Enter");
  await expect(
    page.getByRole("button", { name: "Remove reference to Sofa" }),
  ).toBeVisible();
  await input.press("Enter");
  const message = page.getByRole("article", { name: "Your message" });
  await expect(
    message.getByRole("button", { name: "Coffee table", exact: true }),
  ).toBeVisible();
  const sofa = message.getByRole("button", { name: "Sofa", exact: true });
  await expect(sofa).toBeVisible();
  await expect(tableChip).toHaveCount(0);
  await expect(input).toHaveValue("");
  const sofaPoint = projectToScreen({
    camera,
    pointM: { x: 1.5, y: 0.3, z: 0 },
    viewport,
  });
  const clip = {
    x: Math.floor(sofaPoint.x - 70),
    y: Math.floor(sofaPoint.y - 70),
    width: 120,
    height: 140,
  };
  await input.hover();
  const withoutOutline = await page.screenshot({ clip });
  await sofa.hover();
  await expect
    .poll(async () =>
      Buffer.compare(withoutOutline, await page.screenshot({ clip })),
    )
    .not.toBe(0);
  await input.hover();
  await expect
    .poll(async () =>
      Buffer.compare(withoutOutline, await page.screenshot({ clip })),
    )
    .toBe(0);
  await sofa.hover();
  await page.screenshot({ path: join(evidence, "object-reference-hover.png") });
  await sofa.click();
  await page.getByRole("tab", { name: "Selected", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Sofa", exact: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Chat", exact: true }).click();
  await page.reload();
  await page.getByRole("button", { name: "chat", exact: true }).click();
  await expect(sofa).toBeVisible();
  await sendDaemonCommand({
    type: "scene.apply",
    projectId: project.id,
    command: { type: "item.remove", itemId: "reference-1" },
  });
  await expect(
    message.getByRole("button", { name: "Sofa · removed", exact: true }),
  ).toBeDisabled();
});

test("keyboard picker scrolls to its active object and deleted references release capacity", async ({
  page,
}) => {
  const project = await createProject({
    name: "Reference capacity",
    widthM: 4,
    depthM: 5,
    ceilingHeightM: 2.6,
  });
  for (const index of Array.from({ length: 12 }, (_, index) => index)) {
    await sendDaemonCommand({
      type: "scene.apply",
      projectId: project.id,
      command: {
        type: "item.add",
        item: {
          id: `capacity-${index}`,
          name: `Object ${String(index).padStart(2, "0")}`,
          locked: false,
          model: { kind: "pending", jobId: `capacity-job-${index}` },
          sizeM: { width: 0.2, height: 0.2, depth: 0.2 },
          placement: {
            kind: "floor",
            xM: 0,
            zM: 0,
            elevationM: 0,
            rotationRad: 0,
          },
        },
      },
    });
  }
  await page.goto(`/projects/${project.id}`);
  const input = page.getByRole("textbox", { name: "Message", exact: true });
  await input.fill("@");
  await expect(page.getByRole("option")).toHaveCount(12);
  for (let index = 0; index < 9; index += 1) await input.press("ArrowDown");
  const option = page.getByRole("option", { name: "Object 09", exact: true });
  await expect(option).toHaveAttribute("aria-selected", "true");
  await expect
    .poll(async () => {
      const bounds = await option.boundingBox();
      const list = await page.getByRole("listbox").boundingBox();
      return bounds && list
        ? bounds.y >= list.y && bounds.y + bounds.height <= list.y + list.height
        : false;
    })
    .toBe(true);
  await input.press("Enter");
  for (const index of Array.from({ length: 9 }, (_, index) => index)) {
    await input.fill(`@Object ${String(index).padStart(2, "0")}`);
    await input.press("Enter");
  }
  await expect(
    page.getByRole("button", { name: /^Remove reference to/ }),
  ).toHaveCount(10);
  for (const index of Array.from({ length: 10 }, (_, index) => index)) {
    await sendDaemonCommand({
      type: "scene.apply",
      projectId: project.id,
      command: { type: "item.remove", itemId: `capacity-${index}` },
    });
  }
  await expect(
    page.getByRole("button", { name: /^Remove reference to/ }),
  ).toHaveCount(0);
  await input.fill("@Object 10");
  await input.press("Enter");
  await expect(
    page.getByRole("button", { name: "Remove reference to Object 10" }),
  ).toBeVisible();
});
