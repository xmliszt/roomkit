import { randomUUID } from "node:crypto";
import {
  copyFileSync,
  cpSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { ProjectSchema } from "@planner/shared/src/project/project-schema.ts";
import { ChatHistoryResultSchema } from "@planner/shared/src/protocol/chat-history-result-schema.ts";
import { expect, test } from "@playwright/test";
import { sendDaemonCommand } from "../../../e2e/send-daemon-command.ts";

test("capture matching editor snapshots and frozen views from a temporary room copy", async ({
  page,
}) => {
  test.skip(
    !process.env.PLANNER_B21_ROOM,
    "Set PLANNER_B21_ROOM to a temporary project copy",
  );
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 960, height: 540 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const source = process.env.PLANNER_B21_ROOM;
  const root = process.env.PLANNER_E2E_HOME;
  if (!source || !root || !source.includes("planner-b21-"))
    throw new Error("A temporary B21 room copy is required");
  const evidence = resolve("docs/work-packages/evidence");
  mkdirSync(evidence, { recursive: true });
  await sendDaemonCommand({
    type: "blender.path.set",
    path: resolve("test/fake-tools/blender-photo.mjs"),
  });
  for (const mode of ["orbit", "walk"]) {
    const project = ProjectSchema.parse(
      JSON.parse(readFileSync(join(source, "project.json"), "utf8")),
    );
    project.id = randomUUID();
    if (mode === "walk")
      project.scene.camera = {
        positionM: { x: 0.2, y: 1.6, z: -5.7 },
        targetM: { x: 0.1, y: 1.1, z: -2.25 },
      };
    const folder = join(root, "projects", project.id);
    cpSync(source, folder, {
      recursive: true,
      filter: (path) =>
        !path.includes("/.planner/") && !path.endsWith("/.planner"),
    });
    writeFileSync(join(folder, "project.json"), JSON.stringify(project));
    await page.goto(`/projects/${project.id}`);
    await expect(page.getByTestId("scene")).toHaveAttribute("data-camera");
    await expect(page.locator("canvas").first()).toBeVisible();
    await expect(page.locator('[data-load-in-stage="loading"]')).toHaveCount(
      0,
      { timeout: 60_000 },
    );
    await expect(page.locator('[data-load-in-stage="appearing"]')).toHaveCount(
      0,
      { timeout: 60_000 },
    );
    if (mode === "walk") {
      await page
        .getByRole("button", { name: "Walk mode", exact: true })
        .click();
      await page.getByRole("slider", { name: "Lens focal length" }).fill("16");
    }
    await page.waitForTimeout(400);
    const downloaded = page.waitForEvent("download");
    await page.getByRole("button", { name: "Snapshot", exact: true }).click();
    const png = await (await downloaded).path();
    if (!png) throw new Error("No editor snapshot");
    copyFileSync(png, join(evidence, `b21-${mode}-editor.png`));
    await page
      .getByRole("button", { name: "Render realistic photo", exact: true })
      .click();
    await page
      .getByRole("dialog", { name: "Snapshot photo", exact: true })
      .press("Escape");
    await page.getByRole("tab", { name: "Chat", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Open rendered photo" }),
    ).toBeVisible();
    const history = ChatHistoryResultSchema.parse(
      await sendDaemonCommand({ type: "chat.history", projectId: project.id }),
    );
    const block = history.messages
      .flatMap((message) => message.blocks)
      .findLast((block) => block.kind === "render");
    if (!block || block.kind !== "render") throw new Error("No render result");
    cpSync(
      join(folder, ".planner/render", block.jobId),
      resolve(`.tmp/b21-${mode}-from-editor`),
      { recursive: true },
    );
  }
});
