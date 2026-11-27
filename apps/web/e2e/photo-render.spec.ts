import { mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ChatHistoryResultSchema } from "@planner/shared/src/protocol/chat-history-result-schema.ts";
import { RenderViewSchema } from "@planner/shared/src/render/render-view-schema.ts";
import { expect, test } from "@playwright/test";
import { z } from "zod";
import { createProject } from "../../../e2e/create-project.ts";
import { sendDaemonCommand } from "../../../e2e/send-daemon-command.ts";

test("Render photo captures orbit and walk lens, leaves the editor usable, and opens and downloads the result", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await sendDaemonCommand({
    type: "blender.path.set",
    path: resolve("test/fake-tools/blender-photo.mjs"),
  });
  const project = await createProject({
    name: "Photo render",
    widthM: 4,
    depthM: 5,
    ceilingHeightM: 2.6,
  });
  await page.goto(`/projects/${project.id}`);
  await expect(page.getByTestId("scene")).toHaveAttribute("data-camera");
  await page.getByRole("button", { name: "Snapshot", exact: true }).click();
  await page
    .getByRole("button", { name: "Render realistic photo", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Snapshot photo", exact: true })
    .press("Escape");
  await expect(
    page.getByText("Render photo", { exact: true }).first(),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Chat", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Open rendered photo" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Open rendered photo" }).click();
  await expect(
    page.getByRole("dialog", { name: "Rendered photo", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close Rendered photo" }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: /Download photo/ }).click();
  expect((await download).suggestedFilename()).toMatch(/\.png$/);
  const root = process.env.PLANNER_E2E_HOME;
  if (!root) throw new Error("Missing isolated e2e folder");
  async function lastView() {
    const history = ChatHistoryResultSchema.parse(
      await sendDaemonCommand({ type: "chat.history", projectId: project.id }),
    );
    const block = history.messages
      .flatMap((message) => message.blocks)
      .findLast((block) => block.kind === "render");
    if (!block || block.kind !== "render") throw new Error("No rendered photo");
    return z
      .object({ view: RenderViewSchema })
      .parse(
        JSON.parse(
          readFileSync(
            join(
              root ?? "",
              "projects",
              project.id,
              ".planner/render",
              block.jobId,
              "scene.json",
            ),
            "utf8",
          ),
        ),
      ).view;
  }
  expect((await lastView()).mode).toBe("orbit");
  await page.getByRole("button", { name: "Walk mode", exact: true }).click();
  await page.getByRole("slider", { name: "Lens focal length" }).fill("16");
  await page.getByRole("button", { name: "Snapshot", exact: true }).click();
  await page
    .getByRole("button", { name: "Render realistic photo", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Snapshot photo", exact: true })
    .press("Escape");
  await page.getByRole("tab", { name: "Chat", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Open rendered photo" }),
  ).toHaveCount(2);
  const walkView = await lastView();
  expect(walkView.mode).toBe("walk");
  expect(walkView.hiddenSurfaceIds).toHaveLength(0);
  expect(walkView.positionM.y).toBeCloseTo(1.6);
  expect(walkView.fovDeg).toBeGreaterThan(60);
  const evidence =
    process.env.PLANNER_EVIDENCE_DIR ?? "/tmp/planner-b21-evidence";
  mkdirSync(evidence, { recursive: true });
  await page.screenshot({ path: join(evidence, "b21-chat.png") });
  const messages = JSON.parse(
    readFileSync(
      join(root, "projects", project.id, ".planner/chat.json"),
      "utf8",
    ),
  );
  expect(
    messages.some((message: { blocks: { kind: string }[] }) =>
      message.blocks.some((block) => block.kind === "render"),
    ),
  ).toBe(true);
});
