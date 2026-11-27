import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ProjectSchema } from "@planner/shared/src/project/project-schema.ts";
import { PhotosListResultSchema } from "@planner/shared/src/protocol/photos-list-result-schema.ts";
import { ReconstructionScaleResultSchema } from "@planner/shared/src/protocol/reconstruction-scale-result-schema.ts";
import { ServerMessageSchema } from "@planner/shared/src/protocol/server-message-schema.ts";
import { expect, test, type WebSocketRoute } from "@playwright/test";
import { createProject } from "../../../../../e2e/create-project.ts";
import { sendDaemonCommand } from "../../../../../e2e/send-daemon-command.ts";

const evidence = process.env.PLANNER_EVIDENCE_DIR ?? "/tmp/planner-a7-evidence";
const root = process.env.PLANNER_E2E_HOME;
if (!root) throw new Error("Missing test home");
const controlPath = join(root, "control.json");
const fixture = readFileSync("packages/daemon/test/fixtures/oriented.heic");
const photo = { name: "room.heic", mimeType: "image/heic", buffer: fixture };

test.afterEach(() => {
  writeFileSync(controlPath, JSON.stringify({ mode: "normal" }));
});

for (const weak of [false, true]) {
  test(`capture four photos and reconstruct with ${weak ? "weak" : "furniture"} scale`, async ({
    page,
  }) => {
    mkdirSync(evidence, { recursive: true });
    writeFileSync(
      controlPath,
      JSON.stringify({ mode: "pause-intake", rejectFirst: true }),
    );
    const project = await createProject({
      name: weak ? "Weak scale" : "Measured room",
      widthM: 4,
      depthM: 5,
      ceilingHeightM: 2.6,
    });
    const stages: string[] = [];
    page.on("websocket", (socket) =>
      socket.on("framereceived", (frame) => {
        if (!socket.url().endsWith("/ws")) return;
        const text =
          typeof frame.payload === "string"
            ? frame.payload
            : frame.payload.toString();
        const message = ServerMessageSchema.parse(JSON.parse(text));
        if (
          message.type === "event" &&
          message.event.kind === "job.updated" &&
          message.event.job.kind === "reconstruction" &&
          message.event.job.projectId === project.id
        )
          stages.push(message.event.job.stage);
      }),
    );
    await page.goto(`/projects/${project.id}/capture`);
    await expect(page.getByLabel("Room photos", { exact: true })).toBeEnabled();
    await page
      .getByLabel("Room photos", { exact: true })
      .setInputFiles([photo, photo, photo, photo]);
    await expect(
      page.getByText("4 photos added", { exact: true }),
    ).toBeVisible();
    const thumbnails = page.getByRole("img", { name: /Room view/ });
    await expect(thumbnails).toHaveCount(4);
    for (const image of await thumbnails.all())
      await expect
        .poll(() =>
          image.evaluate((element) =>
            element instanceof HTMLImageElement ? element.naturalWidth : 0,
          ),
        )
        .toBeGreaterThan(0);
    const records = PhotosListResultSchema.parse(
      await sendDaemonCommand({ type: "photos.list", projectId: project.id }),
    ).photos;
    if (!weak) {
      await page
        .getByLabel("Scale source", { exact: true })
        .selectOption("furniture");
      await page
        .getByLabel("Reference photo", { exact: true })
        .selectOption(records.at(1)?.photoId ?? "");
      const picker = page.getByRole("button", { name: "Draw furniture box" });
      await expect(picker).toBeEnabled();
      await picker.scrollIntoViewIfNeeded();
      const bounds = await picker.boundingBox();
      if (!bounds) throw new Error("Missing picker bounds");
      await page.mouse.move(
        bounds.x + bounds.width * 0.2,
        bounds.y + bounds.height * 0.2,
      );
      await page.mouse.down();
      await page.mouse.move(
        bounds.x + bounds.width * 0.8,
        bounds.y + bounds.height * 0.8,
        { steps: 8 },
      );
      await page.mouse.up();
      await page.getByLabel("Axis", { exact: true }).selectOption("height");
      await page
        .getByLabel("Size · m", { exact: true })
        .pressSequentially("1,20");
      await page.getByRole("button", { name: "Add size", exact: true }).click();
      await expect(
        page.getByRole("list", { name: "Saved scale sources" }),
      ).toContainText("Furniture · height · 1.20 m");
      const saved = ReconstructionScaleResultSchema.parse(
        await sendDaemonCommand({
          type: "reconstruction.scale.get",
          projectId: project.id,
        }),
      ).sources.at(0);
      expect(saved?.kind).toBe("furniture");
      if (saved?.kind === "furniture") {
        expect(saved.lengthM).toBe(1.2);
        expect(saved.photoId).toBe(records.at(1)?.photoId);
        expect(saved.box[2]).toBeGreaterThan(saved.box[0]);
        expect(saved.box[2]).toBeLessThanOrEqual(records.at(1)?.widthPx ?? 0);
      }
    }
    await page.reload();
    await expect(thumbnails).toHaveCount(4);
    if (!weak)
      await expect(
        page.getByRole("list", { name: "Saved scale sources" }),
      ).toContainText("1.20 m");
    await page.screenshot({
      path: join(evidence, `capture-photos-${weak}.png`),
      fullPage: true,
    });
    await page.getByRole("button", { name: "Start reconstruction" }).click();
    await expect(page.locator(".job-stage")).toHaveText("intake");
    await page.screenshot({
      path: join(evidence, `capture-progress-${weak}.png`),
      fullPage: true,
    });
    await page.reload();
    await expect(
      page.getByRole("button", { name: "Reconstructing…" }),
    ).toBeVisible();
    writeFileSync(
      controlPath,
      JSON.stringify({ mode: "normal", rejectFirst: true }),
    );
    await expect(page).toHaveURL(new RegExp(`/projects/${project.id}$`), {
      timeout: 30_000,
    });
    await expect(
      page.getByRole("button", { name: /3.00 × 5.20 × 2.70/ }),
    ).toBeVisible();
    await expect(
      page.getByRole("dialog", { name: "Room", exact: true }),
    ).toHaveCount(weak ? 1 : 0);
    for (const stage of ["intake", "geometry", "layout", "coverage", "done"])
      expect(stages).toContain(stage);
    const opened = ProjectSchema.parse(
      await sendDaemonCommand({ type: "project.open", projectId: project.id }),
    );
    expect(opened.reconstruction?.weakScale).toBe(weak);
    if (weak) {
      await page.reload();
      await expect(
        page.getByRole("dialog", { name: "Room", exact: true }),
      ).toHaveCount(0);
    }
    await page.getByRole("button", { name: "chat", exact: true }).click();
    await expect(
      page.getByRole("img", { name: /Photo position facing/ }),
    ).toBeVisible();
    await expect(
      page.getByRole("img", {
        name: "Photo position looking down at the floor",
      }),
    ).toBeVisible();
    await page.screenshot({
      path: join(evidence, `capture-request-${weak}.png`),
    });
    await page.getByLabel("Upload capture photo").first().setInputFiles(photo);
    await expect(
      page.getByText("room.heic added · ready for reconstruction"),
    ).toBeVisible();
    const after = PhotosListResultSchema.parse(
      await sendDaemonCommand({ type: "photos.list", projectId: project.id }),
    ).photos;
    expect(after).toHaveLength(5);
    expect(after.every((entry) => entry.origin === "capture")).toBe(true);
    await page.goto(`/projects/${project.id}/capture`);
    await expect(page.getByText("too blurry", { exact: true })).toBeVisible();
    await expect(thumbnails).toHaveCount(4);
  });
}

test("start from photos on the empty projects page", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Start from photos" }).click();
  await expect(page).toHaveURL(/\/capture$/);
  await expect(
    page.getByRole("button", { name: "Add photos", exact: true }),
  ).toBeVisible();
});

test("queued scale changes apply to the next run and completion refreshes an open editor", async ({
  page,
  context,
}) => {
  writeFileSync(controlPath, JSON.stringify({ mode: "pause-intake" }));
  const first = await createProject({
    name: "Queue owner",
    widthM: 4,
    depthM: 5,
    ceilingHeightM: 2.6,
  });
  const second = await createProject({
    name: "Queued room",
    widthM: 4,
    depthM: 5,
    ceilingHeightM: 2.6,
  });
  const queuedPage = await context.newPage();
  const connections: { client: WebSocketRoute; server: WebSocketRoute }[] = [];
  const received = { projects: 0 };
  await queuedPage.routeWebSocket(/\/ws$/, (client) => {
    const server = client.connectToServer();
    connections.push({ client, server });
    server.onMessage((message) => {
      const frame = ServerMessageSchema.parse(JSON.parse(message.toString()));
      if (
        frame.type === "command.ack" &&
        frame.ok &&
        ProjectSchema.safeParse(frame.result).success
      )
        received.projects += 1;
      client.send(message);
    });
  });
  try {
    for (const entry of [
      { page, project: first },
      { page: queuedPage, project: second },
    ]) {
      await entry.page.goto(`/projects/${entry.project.id}/capture`);
      await expect(
        entry.page.getByLabel("Room photos", { exact: true }),
      ).toBeEnabled();
      await entry.page
        .getByLabel("Room photos", { exact: true })
        .setInputFiles([photo, photo]);
      await expect(
        entry.page.getByText("2 photos added", { exact: true }),
      ).toBeVisible();
      await entry.page
        .getByRole("button", { name: "Start reconstruction" })
        .click();
    }
    await expect(queuedPage.locator(".job-stage")).toHaveText("queued");
    await expect(
      queuedPage.getByRole("button", { name: "Reconstructing…" }),
    ).toBeDisabled();
    await expect(
      queuedPage.getByText(
        "Changes to scale apply to the next reconstruction.",
      ),
    ).toBeVisible();
    await queuedPage.getByLabel("Size · m", { exact: true }).fill("2.7");
    await queuedPage
      .getByRole("button", { name: "Add size", exact: true })
      .click();
    await expect(
      queuedPage.getByRole("list", { name: "Saved scale sources" }),
    ).toContainText("Room · height · 2.70 m");
    await queuedPage
      .getByRole("link", { name: "Open editor", exact: true })
      .click();
    await expect(
      queuedPage.getByRole("button", { name: "queued · 0%", exact: true }),
    ).toBeVisible();
    writeFileSync(controlPath, JSON.stringify({ mode: "normal" }));
    await expect(
      queuedPage.getByRole("dialog", { name: "Room", exact: true }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      queuedPage.getByRole("button", { name: /3.00 × 5.20 × 2.70/ }),
    ).toBeVisible();
    await queuedPage
      .getByRole("button", { name: /3.00 × 5.20 × 2.70/ })
      .click();
    await expect(
      queuedPage.getByRole("dialog", { name: "Room", exact: true }),
    ).toHaveCount(0);
    const beforeReconnect = received.projects;
    const connection = connections.at(-1);
    if (!connection) throw new Error("Planner socket was not routed");
    await Promise.all([connection.client.close(), connection.server.close()]);
    await expect.poll(() => received.projects).toBeGreaterThan(beforeReconnect);
    await queuedPage.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    await expect(
      queuedPage.getByRole("dialog", { name: "Room", exact: true }),
    ).toHaveCount(0);
  } finally {
    writeFileSync(controlPath, JSON.stringify({ mode: "normal" }));
    await queuedPage.close();
  }
});

test("clear all sizes recovers from multiple rejected furniture references", async ({
  page,
}) => {
  const project = await createProject({
    name: "Blurred references",
    widthM: 4,
    depthM: 5,
    ceilingHeightM: 2.6,
  });
  await page.goto(`/projects/${project.id}/capture`);
  await expect(page.getByLabel("Room photos", { exact: true })).toBeEnabled();
  await page
    .getByLabel("Room photos", { exact: true })
    .setInputFiles([photo, photo]);
  await expect(page.getByText("2 photos added", { exact: true })).toBeVisible();
  const records = PhotosListResultSchema.parse(
    await sendDaemonCommand({ type: "photos.list", projectId: project.id }),
  ).photos;
  await sendDaemonCommand({
    type: "reconstruction.scale.set",
    projectId: project.id,
    sources: records.map((entry) => ({
      kind: "furniture",
      photoId: entry.photoId,
      box: [0, 0, 10, 10],
      axis: "height",
      lengthM: 1,
    })),
  });
  const rejected = records.map((entry) => ({
    photoId: entry.photoId,
    origin: entry.origin,
    sourceFileName: entry.sourceFileName,
    widthPx: entry.widthPx,
    heightPx: entry.heightPx,
    orientation: entry.orientation,
    blurScore: 0,
    kind: "rejected",
    reason: "blur",
  }));
  writeFileSync(
    join(root, "projects", project.id, "photos", "photos.json"),
    JSON.stringify({ version: 1, photos: rejected }),
  );
  await page.reload();
  await expect(page.getByText("too blurry", { exact: true })).toHaveCount(2);
  await expect(
    page
      .getByRole("list", { name: "Saved scale sources" })
      .getByRole("listitem"),
  ).toHaveCount(2);
  await page
    .getByRole("button", { name: "Clear all sizes", exact: true })
    .click();
  await expect(
    page
      .getByRole("list", { name: "Saved scale sources" })
      .getByRole("listitem"),
  ).toHaveCount(0);
  const result = ReconstructionScaleResultSchema.parse(
    await sendDaemonCommand({
      type: "reconstruction.scale.get",
      projectId: project.id,
    }),
  );
  expect(result.sources).toEqual([]);
});
