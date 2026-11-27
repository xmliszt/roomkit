import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ChatMessageSchema } from "@planner/shared/src/chat/chat-message-schema.ts";
import { ConfigSchema } from "@planner/shared/src/config/config-schema.ts";
import { ProjectSchema } from "@planner/shared/src/project/project-schema.ts";
import { expect, test } from "@playwright/test";
import { createProject } from "../../../e2e/create-project.ts";
import { sendDaemonCommand } from "../../../e2e/send-daemon-command.ts";

const evidence = process.env.PLANNER_EVIDENCE_DIR ?? "/tmp/planner-a5-evidence";
mkdirSync(evidence, { recursive: true });

async function roomWithPort() {
  const project = await createProject({
    name: "Living room",
    widthM: 4.8,
    depthM: 3.4,
    ceilingHeightM: 2.6,
  });
  await sendDaemonCommand({
    type: "scene.apply",
    projectId: project.id,
    command: {
      type: "item.add",
      item: {
        id: "port",
        name: "Charging port",
        model: { kind: "asset", assetId: "charging-port" },
        sizeM: { width: 0.086, height: 0.086, depth: 0.01 },
        placement: {
          kind: "wall",
          wallId: "wall-1",
          alongM: 1.2,
          heightM: 0.3,
          rotationRad: 0,
        },
        locked: false,
      },
    },
  });
  return project;
}

async function portPlacement(projectId: string) {
  const project = ProjectSchema.parse(
    await sendDaemonCommand({ type: "project.open", projectId }),
  );
  return project.scene.items.find((item) => item.id === "port")?.placement;
}

test("switching a role's provider uses its default model and preserves drafts before save", async ({
  page,
}) => {
  const root = process.env.PLANNER_E2E_HOME;
  if (!root) throw new Error("PLANNER_E2E_HOME is required");
  const configPath = join(root, "home", "config.json");
  function readRoles() {
    const config = ConfigSchema.parse(
      JSON.parse(readFileSync(configPath, "utf8")),
    );
    return config.roles;
  }

  await page.goto("/settings");
  const provider = page.getByRole("combobox", { name: "modeler CLI" });
  const model = page.getByRole("textbox", { name: "modeler", exact: true });
  const save = page.getByRole("button", { name: "Save modeler model" });
  await expect(model).toHaveValue("claude-opus-5-5");
  const originalRoles = readRoles();
  await model.fill("custom-claude-model");

  await provider.selectOption("codex");
  await expect(model).toHaveValue("gpt-6.1-sol");
  await model.fill("custom-codex-model");
  await provider.selectOption("claude");
  await expect(model).toHaveValue("custom-claude-model");
  await provider.selectOption("codex");
  await expect(model).toHaveValue("custom-codex-model");

  try {
    await save.click();
    await expect
      .poll(() => readRoles().modeler)
      .toEqual({ cli: "codex", model: "custom-codex-model" });
    await page.reload();
    await expect(provider).toHaveValue("codex");
    await expect(model).toHaveValue("custom-codex-model");
    await provider.selectOption("claude");
    await expect(model).toHaveValue("claude-opus-5-5");
    await save.click();
    await expect.poll(readRoles).toEqual(originalRoles);
  } finally {
    await sendDaemonCommand({ type: "config.update", roles: originalRoles });
  }
});

test("designer text, tool, diff undo, live Settings, install logs and keyboard snapshot", async ({
  page,
}) => {
  const project = await roomWithPort();
  const before = await portPlacement(project.id);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`/projects/${project.id}`);
  await expect(page.getByRole("button", { name: "Send" })).toBeEnabled();
  await page
    .getByRole("textbox", { name: "Message", exact: true })
    .fill("move the charging port 0.5 m left");
  await page
    .getByRole("textbox", { name: "Message", exact: true })
    .press("Enter");
  const chat = page.getByTestId("chat-panel");
  await expect(
    chat.getByText("Moved the charging port 0.5 m left."),
  ).toBeVisible();
  await expect(
    chat.locator("summary").filter({ hasText: "scene_apply" }),
  ).toBeVisible();
  await expect
    .poll(() => portPlacement(project.id))
    .toEqual({ ...before, alongM: 1.7 });
  await page.screenshot({ path: join(evidence, "chat-diff.png") });
  await chat.getByRole("button", { name: "undo", exact: true }).click();
  await expect.poll(() => portPlacement(project.id)).toEqual(before);
  await expect(chat.getByRole("button", { name: "undone" })).toBeDisabled();
  await page.getByRole("tab", { name: "Log", exact: true }).click();
  await page.getByLabel("Filter by role").selectOption("designer");
  await expect(
    chat.locator("summary").filter({ hasText: "chat.block.set" }).first(),
  ).toBeVisible();
  await page.screenshot({ path: join(evidence, "log.png") });
  await page.getByRole("tab", { name: "Chat", exact: true }).click();
  await expect(chat.getByRole("button", { name: "undone" })).toBeDisabled();
  await page.keyboard.press("Meta+k");
  await expect(page.getByRole("dialog", { name: "Commands" })).toBeVisible();
  await expect(
    page.getByRole("combobox", { name: "Search commands" }),
  ).toBeFocused();
  await page
    .getByRole("combobox", { name: "Search commands" })
    .fill("snapshot");
  await page.screenshot({ path: join(evidence, "palette.png") });
  const downloaded = page.waitForEvent("download");
  await page.getByRole("combobox", { name: "Search commands" }).press("Enter");
  const download = await downloaded;
  const path = await download.path();
  expect(path).not.toBeNull();
  if (!path) throw new Error("snapshot was not downloaded");
  expect(readFileSync(path).subarray(0, 8)).toEqual(
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  );
  await expect(page.getByText(/snapshot saved/)).toBeVisible();
  await page
    .getByRole("dialog", { name: "Snapshot photo", exact: true })
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Settings", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Jobs", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByText("signed in", { exact: true })).toHaveCount(2);
  await expect(page.getByText("24%", { exact: true })).toBeVisible();
  await expect(page.getByText("17%", { exact: true })).toBeVisible();
  await expect(page.getByText(/fake-claude 0.0.1/)).toBeVisible();
  await expect(page.getByText(/fake-codex 0.0.1/)).toBeVisible();
  await page
    .getByRole("button", { name: "Install Blender", exact: true })
    .click();
  await expect(page.getByText("Blender 5.3.0", { exact: true })).toBeVisible();
  const blenderLog = page
    .locator("#blender")
    .getByRole("log", { name: "Job log" });
  await expect(blenderLog).toContainText("Fetching blender");
  await expect(blenderLog).toContainText("successfully installed");
  await page.screenshot({
    path: join(evidence, "settings.png"),
    fullPage: true,
  });
  await page.goBack();
  await expect(page.getByTestId("composer")).toBeVisible();
  await page.getByRole("button", { name: "Open install Blender" }).click();
  await expect(
    page.getByRole("tab", { name: "Jobs", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("log", { name: "Job log" })).toContainText(
    "successfully installed",
  );
  await page.screenshot({ path: join(evidence, "jobs.png") });
  expect(errors).toEqual([]);
});

test("streaming survives reload, choice answers use text, and attachments send with text", async ({
  page,
}) => {
  const project = await roomWithPort();
  await page.goto(`/projects/${project.id}`);
  const input = page.getByRole("textbox", { name: "Message", exact: true });
  await expect(page.getByRole("button", { name: "Send" })).toBeEnabled();
  await input.fill("[fake:chatty]");
  await input.press("Enter");
  await expect(
    page.getByTestId("chat-panel").getByText(/Working 1/),
  ).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "chat", exact: true }).click();
  await expect(
    page.getByTestId("chat-panel").getByText(/Working 8/),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Send" })).toBeEnabled();
  await input.fill("[fake:post-choice]");
  await input.press("Enter");
  await expect(
    page.getByRole("button", { name: "Oak", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Oak", exact: true }).click();
  await expect(
    page.getByRole("article", { name: "Your message" }).last(),
  ).toContainText("Which colour?\nOak");
  await expect(page.getByRole("button", { name: "Send" })).toBeEnabled();
  await page
    .locator('[data-testid="composer"] input[type="file"]')
    .setInputFiles({
      name: "room.png",
      mimeType: "image/png",
      buffer: readFileSync("packages/daemon/catalog/charging-port/thumb.png"),
    });
  await expect(
    page.getByRole("button", { name: "Remove room.png" }),
  ).toBeVisible();
  await input.fill("[fake:echo] With a photo");
  await input.press("Enter");
  await expect(input).toHaveValue("");
  await expect(
    page.getByRole("button", { name: "Remove room.png" }),
  ).toHaveCount(0);
  const history = await sendDaemonCommand({
    type: "chat.history",
    projectId: project.id,
  });
  expect(JSON.stringify(history)).toContain('"kind":"image"');
});

test("rich blocks render safely, images open in a lightbox, and files open in a viewer", async ({
  page,
}) => {
  const project = await roomWithPort();
  const root = process.env.PLANNER_E2E_HOME;
  if (!root) throw new Error("missing fixture directory");
  const folder = join(root, "projects", project.id, ".planner");
  mkdirSync(folder, { recursive: true });
  const thumbnail = readFileSync(
    "packages/daemon/catalog/charging-port/thumb.png",
  );
  const upload = await fetch(
    `http://127.0.0.1:${process.env.PLANNER_PORT}/projects/${project.id}/photos?origin=chat&fileName=reference.png`,
    {
      method: "POST",
      headers: { origin: `http://127.0.0.1:${process.env.PLANNER_WEB_PORT}` },
      body: thumbnail,
    },
  );
  expect(upload.status).toBe(201);
  const photo = await upload.json();
  const linkName = `${"a".repeat(32)}.png`;
  mkdirSync(join(folder, "links"), { recursive: true });
  writeFileSync(join(folder, "links", linkName), thumbnail);
  const message = ChatMessageSchema.parse({
    id: "rich",
    author: { kind: "agent", role: "designer" },
    status: "done",
    createdAt: new Date().toISOString(),
    blocks: [
      {
        kind: "text",
        markdown:
          "## Room notes\n\n**Oak** suits the room. Keep `0.5 m` clear.\n\n- Keep the window clear\n- Try the charging port below\n\n| Item | Width |\n| --- | --- |\n| Console | 1.4 m |\n\nملاحظات الغرفة `pnpm daemon`\n\n- Window\n- خزانة Roomkit\n\n| العنصر | العرض |\n| --- | --- |\n| الطاولة | 1.4 m |",
      },
      {
        kind: "link",
        url: "https://example.com/console",
        domain: "example.com",
        title: "Oak console",
        imageSrc: `.planner/links/${linkName}`,
      },
      {
        kind: "choice",
        choiceId: "finish",
        question: "Which finish?",
        options: [
          { id: "oak", label: "Natural oak" },
          { id: "dark", label: "Dark walnut" },
        ],
      },
      {
        kind: "image",
        photoId: photo.photoId,
        fileName: "reference.png",
        sizeBytes: thumbnail.length,
      },
      {
        kind: "file",
        src: `data:text/markdown;base64,${Buffer.from("**Room dimensions**\n\n4.8 × 3.4 m").toString("base64")}`,
        fileName: "notes.md",
        sizeBytes: 38,
        fileType: "MD",
      },
      {
        kind: "notice",
        text: "Blender is required for modelling.",
        detail: { kind: "missing-requirement", settingsSection: "blender" },
      },
      {
        kind: "notice",
        text: "Hosted generation is not configured.",
        detail: { kind: "missing-requirement", settingsSection: "connections" },
      },
      {
        kind: "capture-request",
        wallId: "wall-1",
        standM: { x: 0, z: 0 },
        lookAtM: { x: -2.4, z: 0 },
        text: "Face the wall beside the window.",
      },
      {
        kind: "asset",
        assetId: "charging-port",
        name: "Charging port",
        sizeM: { width: 0.086, height: 0.086, depth: 0.01 },
      },
      {
        kind: "video",
        src: "missing.webm",
        fileName: "room.webm",
        sizeBytes: 100,
        format: "webm",
      },
      { kind: "job", jobId: "missing-job" },
    ],
  });
  writeFileSync(join(folder, "chat.json"), JSON.stringify([message]));
  await page.goto(`/projects/${project.id}`);
  await page.getByRole("button", { name: "chat", exact: true }).click();
  await expect(page.getByText("Which finish?", { exact: true })).toBeVisible();
  const linkImage = page.locator(`img[src$="/links/${linkName}"]`);
  await expect
    .poll(() =>
      linkImage.evaluate((image) =>
        image instanceof HTMLImageElement ? image.naturalWidth : 0,
      ),
    )
    .toBeGreaterThan(0);
  await page
    .getByRole("button", { name: "Open reference.png", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "reference.png" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  await page.getByRole("button", { name: /MD · notes.md/ }).click();
  await expect(page.getByRole("dialog", { name: "notes.md" })).toContainText(
    "Room dimensions",
  );
  await page.keyboard.press("Escape");
  await page
    .getByRole("link", { name: "Oak console" })
    .scrollIntoViewIfNeeded();
  await page
    .getByRole("article", { name: "designer message" })
    .scrollIntoViewIfNeeded();
  const arabicNote = page.getByText("ملاحظات الغرفة pnpm daemon", {
    exact: true,
  });
  await expect(arabicNote).toHaveCSS("direction", "rtl");
  await expect(page.getByText("pnpm daemon", { exact: true })).toHaveCSS(
    "direction",
    "ltr",
  );
  await expect(page.getByText("خزانة Roomkit", { exact: true })).toHaveCSS(
    "direction",
    "rtl",
  );
  await expect(page.getByRole("table").filter({ hasText: "العنصر" })).toHaveCSS(
    "direction",
    "rtl",
  );
  const composer = page.getByRole("textbox", { name: "Message", exact: true });
  await composer.fill("خزانة Roomkit");
  await expect(composer).toHaveCSS("direction", "rtl");
  await composer.clear();
  await arabicNote.scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(evidence, "chat-reading-direction.png") });
  await page.getByText("Room notes", { exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(evidence, "chat-blocks.png") });
  await expect(
    page.getByTestId("chat-panel").getByRole("link", { name: "Settings" }),
  ).toHaveAttribute("href", `/settings?from=${project.id}#blender`);
  await expect(
    page.getByText("Hosted generation is not configured.", { exact: false }),
  ).toBeVisible();
  await expect(page.locator('a[href$="#connections"]')).toHaveCount(0);
  await expect(page.getByText("video · preview unavailable")).toBeAttached();
  await composer.fill("هذه خزانة");
  await composer.press("Enter");
  await expect(
    page
      .getByRole("article", { name: "Your message" })
      .getByText("هذه خزانة", { exact: true }),
  ).toHaveCSS("direction", "rtl");
});
