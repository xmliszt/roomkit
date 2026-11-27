import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ChatMessageSchema } from "@planner/shared/src/chat/chat-message-schema.ts";
import { ClientCommandSchema } from "@planner/shared/src/protocol/client-command-schema.ts";
import { expect, test } from "@playwright/test";
import { createProject } from "../../../e2e/create-project.ts";
import { sendDaemonCommand } from "../../../e2e/send-daemon-command.ts";

function preferencePath() {
  const home = process.env.PLANNER_E2E_HOME;
  if (!home) throw new Error("PLANNER_E2E_HOME is required");
  return join(home, "home", "language.json");
}

test.use({ locale: "fr-CA" });

test("an existing install opens in English and shows the language setting", async ({
  page,
}) => {
  const roomName = "غرفة القراءة 2026";
  const project = await createProject({
    name: roomName,
    widthM: 4,
    depthM: 5.2,
    ceilingHeightM: 2.7,
  });
  try {
    await page.addInitScript(() => {
      if (!sessionStorage.getItem("tour-fixture-initialized")) {
        localStorage.setItem("roomkit.sample-tour", "seen");
        sessionStorage.setItem("tour-fixture-initialized", "1");
      }
    });
    await page.goto("/settings");
    await expect(page.getByRole("combobox", { name: "Language" })).toHaveValue(
      "en",
    );
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(
      page.getByRole("button", { name: "Continue", exact: true }),
    ).toHaveCount(0);
    await page.getByRole("link", { name: "Projects", exact: true }).click();
    const room = page.getByRole("link", { name: roomName, exact: true });
    await expect(room).toBeVisible();
    await expect(room.locator("bdi")).toHaveCSS("direction", "rtl");
    await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
    await room.click();
    await expect(page.getByText(/^Sheet 01/)).toHaveText(
      `Sheet 01 · \u2068${roomName}\u2069 · 1:50`,
    );
    expect(
      await page.evaluate(() => localStorage.getItem("roomkit.sample-tour")),
    ).toBe("seen");
  } finally {
    await sendDaemonCommand({ type: "project.remove", projectId: project.id });
  }
});

test.describe("fresh install", () => {
  test.beforeEach(async () => {
    await writeFile(preferencePath(), JSON.stringify({ kind: "pending" }), {
      flag: "wx",
    });
  });

  test.afterEach(async () => {
    await sendDaemonCommand({ type: "language.set", locale: "en" });
    await rm(preferencePath(), { force: true });
  });

  test("confirms a language before opening the app and saves later switches", async ({
    page,
    context,
  }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto("/");
    const picker = page.getByRole("heading", {
      name: "Choisissez votre langue",
    });
    const frenchLanguage = page.getByRole("combobox", { name: "Langue" });
    const document = page.locator("html");
    await expect(picker).toBeVisible();
    await expect(page.getByRole("heading", { name: "Roomkit" })).toHaveCount(0);
    await expect(frenchLanguage).toHaveValue("fr");
    await expect(frenchLanguage.locator("option")).toHaveCount(18);
    await expect(frenchLanguage.locator('option[value="zh-Hant"]')).toHaveText(
      "繁體中文",
    );
    await expect(document).toHaveAttribute("lang", "fr");
    const evidence = process.env.PLANNER_EVIDENCE_DIR;
    if (evidence)
      await page.screenshot({
        path: join(evidence, "onboarding-language-fr-320.png"),
      });

    await frenchLanguage.selectOption("de");
    await page.reload();
    await expect(picker).toBeVisible();
    await expect(frenchLanguage).toHaveValue("fr");
    expect(await sendDaemonCommand({ type: "language.get" })).toEqual({
      kind: "pending",
    });

    const otherTab = await context.newPage();
    await otherTab.goto("/");
    await expect(
      otherTab.getByRole("heading", {
        name: "Choisissez votre langue",
      }),
    ).toBeVisible();

    await frenchLanguage.selectOption("de");
    await frenchLanguage.focus();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Continuer" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "Roomkit" })).toBeVisible();
    await expect(document).toHaveAttribute("lang", "de");
    await expect(otherTab.locator("html")).toHaveAttribute("lang", "de");
    await expect(
      otherTab.getByRole("heading", { name: "Roomkit" }),
    ).toBeVisible();
    await page.goto("/settings");
    const germanLanguage = page.getByRole("combobox", { name: "Sprache" });
    await expect(germanLanguage).toHaveValue("de");
    await expect(document).toHaveAttribute("lang", "de");

    await germanLanguage.selectOption("fr");
    await expect(frenchLanguage).toHaveValue("fr");
    await expect(document).toHaveAttribute("lang", "fr");
    await expect(otherTab.locator("html")).toHaveAttribute("lang", "fr");
    await page.reload();
    await expect(frenchLanguage).toHaveValue("fr");
    await expect(document).toHaveAttribute("lang", "fr");

    await frenchLanguage.selectOption("de");
    await expect(germanLanguage).toHaveValue("de");
    await expect(document).toHaveAttribute("lang", "de");
    expect(await document.evaluate((root) => root.scrollWidth)).toBe(320);
    const roleRow = page.locator(".role-model-row").first();
    const modelField = roleRow.getByRole("textbox");
    await expect(modelField).toBeVisible();
    const fieldBounds = await modelField.boundingBox();
    const labelBounds = await roleRow.locator("label").boundingBox();
    expect(fieldBounds?.width ?? 0).toBeGreaterThan(200);
    expect(fieldBounds?.y ?? 0).toBeGreaterThan(labelBounds?.y ?? 0);
    if (evidence)
      await page.screenshot({
        path: join(evidence, "settings-language-de-320.png"),
      });

    await germanLanguage.selectOption("hi");
    await expect(page.getByRole("heading", { name: "सेटिंग्स" })).toBeVisible();
    await expect(document).toHaveAttribute("lang", "hi");
    if (evidence)
      await page.screenshot({
        path: join(evidence, "settings-language-hi-320.png"),
      });

    await page.getByRole("combobox", { name: "भाषा" }).selectOption("zh-Hant");
    await expect(
      page.getByRole("heading", { name: "設定", exact: true }),
    ).toBeVisible();
    await expect(document).toHaveAttribute("lang", "zh-Hant");
    if (evidence)
      await page.screenshot({
        path: join(evidence, "settings-language-zh-hant-320.png"),
      });
  });

  test("reconstruction guidance follows the app language and keeps custom chat text", async ({
    page,
  }) => {
    const project = await createProject({
      name: "测试房间",
      widthM: 4.8,
      depthM: 3.4,
      ceilingHeightM: 2.6,
    });
    try {
      const root = process.env.PLANNER_E2E_HOME;
      if (!root) throw new Error("PLANNER_E2E_HOME is required");
      const message = ChatMessageSchema.parse({
        id: "capture-fixture",
        author: { kind: "agent", role: "surveyor" },
        status: "done",
        createdAt: new Date().toISOString(),
        blocks: [
          { kind: "job", jobId: "capture-fixture" },
          {
            kind: "capture-request",
            wallId: "wall-1",
            standM: { x: 0, z: 0 },
            lookAtM: { x: -2.4, z: 0 },
            text: "Photograph wall wall-1 near x -2.40, z 0.00 (inferred). Stand at the marked point and face the wall.",
          },
          {
            kind: "text",
            markdown:
              "Scale sources differ by more than 5%: bench, main seat. Check these measurements.",
          },
          { kind: "text", markdown: "Custom note about the room." },
        ],
      });
      await writeFile(
        join(root, "projects", project.id, ".planner", "chat.json"),
        JSON.stringify([message]),
      );
      await sendDaemonCommand({ type: "language.set", locale: "zh-Hans" });
      await page.goto(`/projects/${project.id}`);
      await page.getByRole("button", { name: "聊天", exact: true }).click();
      await expect(
        page.getByText("这面墙的位置是估算的。", { exact: false }),
      ).toBeVisible();
      await expect(
        page.getByText(
          "比例参考相差超过 5%（bench, main seat）。请检查这些实测尺寸。",
        ),
      ).toBeVisible();
      await expect(page.getByText("Custom note about the room.")).toBeVisible();

      await page.getByRole("tab", { name: "物体", exact: true }).click();
      await expect(
        page.getByRole("article", { name: "G 型双联插座", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("article", {
          name: "I 型（澳大利亚、中国）",
          exact: true,
        }),
      ).toBeVisible();
      await page.getByRole("tab", { name: "聊天", exact: true }).click();

      await sendDaemonCommand({ type: "language.set", locale: "en" });
      await expect(
        page.getByText(
          "Take another photo of wall 1. Its position was estimated.",
        ),
      ).toBeVisible();
    } finally {
      await sendDaemonCommand({ type: "language.set", locale: "en" });
      await sendDaemonCommand({
        type: "project.remove",
        projectId: project.id,
      });
    }
  });

  test("the French sample tour localizes the exercise and setup link", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Continuer" }).click();
    await page
      .getByRole("button", { name: "Ouvrir la pièce d’exemple" })
      .click();
    await expect(
      page.getByRole("heading", { name: "Regarder autour de soi" }),
    ).toBeVisible();
    const next = page.getByRole("button", { name: "Suivant", exact: true });
    for (let step = 0; step < 5; step += 1) await next.click();
    await expect(
      page.getByRole("heading", { name: "Demandez à Roomkit" }),
    ).toBeVisible();
    await expect(
      page.getByText(/change la couleur de la chaise en orange/),
    ).toBeVisible();
    const setup = page.getByRole("link", { name: "Configurer un agent" });
    await expect(setup).toHaveAttribute("href", /\/settings\?from=.+#setup$/);
    await page.getByRole("button", { name: "Écrire un message" }).click();
    await expect(
      page.getByRole("textbox", { name: "Message", exact: true }),
    ).toBeFocused();
  });

  test("a failed language save keeps the picker open and can be retried", async ({
    page,
  }) => {
    let shouldFail = true;
    await page.routeWebSocket(
      `ws://127.0.0.1:${process.env.PLANNER_PORT ?? "4820"}/**`,
      (socket) => {
        const server = socket.connectToServer();
        socket.onMessage((raw) => {
          const command = ClientCommandSchema.safeParse(
            JSON.parse(String(raw)),
          );
          if (
            !shouldFail ||
            !command.success ||
            command.data.type !== "language.set"
          ) {
            server.send(raw);
            return;
          }
          shouldFail = false;
          socket.send(
            JSON.stringify({
              type: "command.ack",
              requestId: command.data.requestId,
              ok: false,
              error: "Cannot write language preference",
            }),
          );
        });
      },
    );

    await page.goto("/");
    await page.getByRole("combobox", { name: "Langue" }).selectOption("de");
    const confirm = page.getByRole("button", { name: "Continuer" });
    await confirm.click();
    await expect(
      page.getByRole("alert").filter({ hasText: "n’a pas pu enregistrer" }),
    ).toContainText("n’a pas pu enregistrer");
    await expect(page.locator("html")).toHaveAttribute("lang", "fr");
    await expect(page.getByRole("heading", { name: "Roomkit" })).toHaveCount(0);
    expect(await sendDaemonCommand({ type: "language.get" })).toEqual({
      kind: "pending",
    });

    await confirm.click();
    await expect(page.getByRole("heading", { name: "Roomkit" })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", "de");
  });

  test.describe("with an unsupported browser language", () => {
    test.use({ locale: "ar-AE" });

    test("shows the English picker even on a direct Settings URL", async ({
      page,
    }) => {
      await page.goto("/settings");
      await expect(
        page.getByRole("heading", { name: "Choose your language" }),
      ).toBeVisible();
      await expect(page.getByRole("heading", { name: "Settings" })).toHaveCount(
        0,
      );
      await expect(
        page.getByRole("combobox", { name: "Language" }),
      ).toHaveValue("en");
    });
  });
});
