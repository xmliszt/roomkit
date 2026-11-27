import { renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { PreflightSchema } from "@planner/shared/src/preflight/preflight-schema.ts";
import { ProjectSchema } from "@planner/shared/src/project/project-schema.ts";
import { ClientCommandSchema } from "@planner/shared/src/protocol/client-command-schema.ts";
import { ItemSchema } from "@planner/shared/src/scene/item-schema.ts";
import { expect, type Page, test } from "@playwright/test";
import { sendDaemonCommand } from "../../../e2e/send-daemon-command.ts";

async function readRoomItems(page: Page) {
  const items = await page.getByTestId("scene").getAttribute("data-items");
  return ItemSchema.array().parse(JSON.parse(items ?? "[]"));
}

async function readLampPower(page: Page) {
  return (await readRoomItems(page)).find((item) => item.id === "lamp")?.light
    ?.on;
}

test("opens, tours, and resets the sample room", async ({ page, request }) => {
  await page.goto("/");
  const lampModel = page.waitForResponse((response) =>
    response.url().endsWith("/assets/sample-lamp/model.glb"),
  );
  await page.getByRole("button", { name: "Open sample room" }).click();
  await expect(
    page.getByRole("heading", { name: "Sample living room" }),
  ).toBeVisible();
  const original = new URL(page.url()).pathname;
  const lampResponse = await lampModel;
  expect(lampResponse.ok()).toBe(true);
  expect((await lampResponse.body()).subarray(0, 4).toString()).toBe("glTF");
  await expect(
    page.getByRole("heading", { name: "Look around" }),
  ).toBeVisible();
  const next = page.getByRole("button", { name: "Next", exact: true });
  const closeTour = page.getByRole("button", { name: "Close tour" });
  const tour = page.getByRole("button", { name: "Room tour" });
  const highlight = page.locator("[data-room-tour-highlight]");
  await next.click();
  await expect(
    page.getByRole("heading", { name: "Move the reading chair" }),
  ).toBeVisible();
  await expect(
    highlight.and(page.getByRole("button", { name: "Select", exact: true })),
  ).toBeVisible();
  await next.click();
  await expect(
    page.getByRole("heading", { name: "Try a wall color" }),
  ).toBeVisible();
  await expect(highlight.and(page.getByTestId("room-size"))).toBeVisible();
  await next.click();
  await expect(
    page.getByRole("heading", { name: "Try the floor lamp" }),
  ).toBeVisible();
  const lightOn = page.getByRole("button", { name: "Turn lamp on" });
  await expect.poll(() => readLampPower(page)).toBe(false);
  await lightOn.press("Enter");
  const lightOff = page.getByRole("button", { name: "Turn lamp off" });
  await expect(lightOff).toBeFocused();
  await expect.poll(() => readLampPower(page)).toBe(true);
  await lightOff.click();
  await expect.poll(() => readLampPower(page)).toBe(false);
  await lightOn.click();
  await expect.poll(() => readLampPower(page)).toBe(true);
  await next.click();
  await expect(
    page.getByRole("heading", { name: "Add an object" }),
  ).toBeVisible();
  const add = page.getByRole("button", { name: "Add", exact: true });
  await expect(highlight.and(add)).toBeVisible();
  await add.click();
  const addPicker = page.getByRole("dialog", { name: "Add", exact: true });
  await expect(
    addPicker.getByRole("option", { name: "From photo" }),
  ).toBeVisible();
  await expect(next).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(highlight.and(add)).toBeVisible();

  for (const step of [
    { tab: "Chat", title: "Ask Roomkit" },
    { tab: "Objects", title: "Browse objects" },
    { tab: "Jobs", title: "Track jobs" },
    { tab: "Log", title: "See activity" },
  ]) {
    await next.click();
    await expect(page.getByRole("heading", { name: step.title })).toBeVisible();
    const tab = page.getByRole("tab", { name: step.tab });
    await expect(highlight.and(tab)).toBeVisible();
    await expect(tab).toHaveCSS("outline-width", "2px");
    await expect(tab).toHaveCSS("outline-style", "solid");
    await expect(tab).toHaveAttribute("aria-selected", "true");
  }
  const originalViewport = page.viewportSize();
  await page.setViewportSize({ width: 390, height: 900 });
  const chatToggle = page.getByRole("button", { name: "chat", exact: true });
  await chatToggle.click();
  await expect(highlight.and(chatToggle)).toBeInViewport({ ratio: 1 });
  await chatToggle.click();
  await expect(
    highlight.and(page.getByRole("tab", { name: "Log" })),
  ).toBeInViewport({ ratio: 1 });
  await next.click();
  await expect(page.getByTestId("chat-panel")).toBeVisible();
  await chatToggle.click();
  await expect(page.getByTestId("chat-panel")).toBeHidden();
  const shortcuts = page.getByRole("button", { name: "Keyboard shortcuts" });
  await expect(highlight.and(shortcuts)).toBeInViewport({ ratio: 1 });
  await shortcuts.click();
  await expect(
    page.getByRole("dialog", { name: "Keyboard shortcuts" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await next.click();
  const settings = page.getByRole("link", { name: "Settings" });
  await expect(highlight.and(settings)).toBeInViewport({ ratio: 1 });
  await settings.click();
  await expect(
    page.getByRole("heading", { name: "Settings", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Back to room" }).click();
  await tour.click({ trial: true });
  await expect(closeTour).toHaveCount(0);
  await expect(highlight).toHaveCount(0);
  if (originalViewport) await page.setViewportSize(originalViewport);

  await page.getByTestId("room-size").click();
  const wallColor = page.getByLabel("wall 1 colour", { exact: true });
  const originalColor = await wallColor.inputValue();
  await wallColor.fill("#4a656e");
  await expect(wallColor).toHaveValue("#4a656e");

  const model = await request.get(
    `http://127.0.0.1:${process.env.PLANNER_PORT ?? "4820"}${original}/assets/sample-chair/model.glb`,
    {
      headers: { Origin: new URL(page.url()).origin },
    },
  );
  expect(model.ok()).toBe(true);
  expect((await model.body()).subarray(0, 4).toString()).toBe("glTF");

  await page.reload();
  await expect.poll(() => readLampPower(page)).toBe(true);
  await page.getByTestId("room-size").click();
  await expect(page.getByLabel("wall 1 colour", { exact: true })).toHaveValue(
    "#4a656e",
  );
  await page.getByTestId("room-size").click();
  await expect(page.getByRole("heading", { name: "Look around" })).toHaveCount(
    0,
  );
  await tour.click();
  await expect(
    page.getByRole("heading", { name: "Look around" }),
  ).toBeVisible();
  const walk = page.getByRole("button", { name: "Walk mode" });
  await walk.click();
  await expect(walk).toHaveAttribute("aria-pressed", "true");
  await expect(tour).toHaveCount(0);
  await expect(closeTour).toHaveCount(0);
  await walk.click();
  await expect(tour).toBeVisible();
  await expect(closeTour).toHaveCount(0);
  await tour.click();
  await closeTour.press("Escape");
  await expect(tour).toBeFocused();

  await page.goto("/");
  await page.getByRole("button", { name: "Open sample room" }).click();
  await expect(page).toHaveURL(new RegExp(`${original}$`));
  await page.goto("/");
  await page.getByRole("button", { name: "Reset sample room" }).click();
  await expect(
    page.getByText("Your edits will be moved to the trash.", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Reset sample room" }).click();
  await expect(page).toHaveURL(/\/projects\/[a-f0-9-]+$/);
  expect(new URL(page.url()).pathname).not.toBe(original);
  await expect(
    page.getByRole("heading", { name: "Sample living room" }),
  ).toBeVisible();
  await expect.poll(() => readLampPower(page)).toBe(false);
  await page.getByTestId("room-size").click();
  await expect(page.getByLabel("wall 1 colour", { exact: true })).toHaveValue(
    originalColor,
  );
  await page.getByTestId("room-size").click();
  const resetProjectId = new URL(page.url()).pathname.split("/").at(-1);
  for (const itemId of ["chair", "lamp"]) {
    await sendDaemonCommand({
      type: "scene.apply",
      projectId: resetProjectId,
      command: { type: "item.remove", itemId },
    });
  }
  await expect.poll(() => readLampPower(page)).toBeUndefined();
  await tour.click();
  await next.click();
  await next.click();
  await expect(
    page.getByRole("heading", { name: "Try a wall color" }),
  ).toBeVisible();
  await next.click();
  await expect(
    page.getByRole("heading", { name: "Add an object" }),
  ).toBeVisible();
  await chatToggle.click();
  const logTab = page.getByRole("tab", { name: "Log" });
  await logTab.click();
  const roleFilter = page.getByRole("combobox", { name: "Filter by role" });
  await roleFilter.selectOption("modeler");
  await next.click();
  await expect(
    page.getByRole("heading", { name: "Ask Roomkit" }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Ask for a layout idea or describe an edit to the room, then press Enter.",
    ),
  ).toBeVisible();
  await expect(
    highlight.and(page.getByRole("tab", { name: "Chat", exact: true })),
  ).toBeVisible();
  await expect(logTab).toHaveAttribute("aria-selected", "true");
  const done = page.getByRole("button", { name: "Done", exact: true });
  for (const title of [
    "Browse objects",
    "Track jobs",
    "See activity",
    "Find keyboard shortcuts",
    "Set up Roomkit",
  ]) {
    await next.click();
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
  }
  await done.click();
  await expect(tour).toBeFocused();
  await expect(highlight).toHaveCount(0);
  await expect(roleFilter).toHaveValue("modeler");
});

test("installs a missing chat agent and resumes the chair exercise", async ({
  page,
}) => {
  const root = process.env.PLANNER_E2E_HOME;
  if (!root) throw new Error("PLANNER_E2E_HOME is required");
  const executable = join(root, "tools", "claude");
  const parkedExecutable = join(root, "tools", "claude-before-tour");
  const original = ProjectSchema.parse(
    await sendDaemonCommand({ type: "project.sample.open" }),
  );
  const sample = ProjectSchema.parse(
    await sendDaemonCommand({
      type: "project.sample.open",
      resetProjectId: original.id,
    }),
  );
  await page.goto(`/projects/${sample.id}`);
  await expect(
    page.getByRole("heading", { name: "Look around" }),
  ).toBeVisible();
  const next = page.getByRole("button", { name: "Next", exact: true });
  for (const title of [
    "Move the reading chair",
    "Try a wall color",
    "Try the floor lamp",
    "Add an object",
    "Ask Roomkit",
  ]) {
    await next.click();
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
  }

  const roomUrl = page.url();
  const prompt = "change the chair to orange";
  const message = page.getByRole("textbox", { name: "Message", exact: true });
  const writeMessage = page.getByRole("button", { name: "Write a message" });
  const send = page.getByRole("button", { name: "Send", exact: true });
  await expect(
    page.getByText(/type “change the chair to orange”/i),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Set up an agent" }),
  ).toHaveAttribute("href", /feature=claude#setup$/);
  await page.getByRole("button", { name: "chat", exact: true }).click();
  await expect(page.getByTestId("chat-panel")).toBeHidden();
  await writeMessage.press("Enter");
  await expect(message).toBeFocused();
  await expect(send).toBeEnabled();

  await sendDaemonCommand({ type: "preflight.check", force: true });
  renameSync(executable, parkedExecutable);
  try {
    await message.fill(prompt);
    await message.press("Enter");

    await expect(page.getByText(/Claude Code is not installed/)).toBeVisible();
    await page.getByRole("link", { name: "Set up required tools" }).click();
    await expect(page).toHaveURL(/feature=claude#setup$/);
    const setupAgent = page.getByRole("button", { name: "Set up Claude Code" });
    await setupAgent.click();
    await expect(setupAgent).toHaveCount(0);
    await page.getByRole("link", { name: "Back to room" }).click();

    await expect(page).toHaveURL(roomUrl);
    await expect(
      page.getByRole("heading", { name: "Ask Roomkit" }),
    ).toBeVisible();
    await expect(page.getByRole("tab", { name: "Chat" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await page.getByRole("tab", { name: "Log", exact: true }).click();
    await writeMessage.press("Enter");
    await expect(page.getByRole("tab", { name: "Chat" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(message).toBeFocused();
    await expect(send).toBeEnabled();
    await message.fill(prompt);
    await message.press("Enter");
    await expect(page.getByText("The reading chair is orange.")).toBeVisible();
    await expect
      .poll(
        async () =>
          (await readRoomItems(page)).find((item) => item.id === "chair")
            ?.colorAdjust,
      )
      .toEqual({ kind: "colorize", color: "#f97316", strength: 1 });
    await next.click();
    await expect(
      page.getByRole("heading", { name: "Browse objects" }),
    ).toBeVisible();
    await expect(page.getByRole("tab", { name: "Objects" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  } finally {
    rmSync(executable, { force: true });
    renameSync(parkedExecutable, executable);
  }
});

test("starts and retries Codex sign-in from the setup guide and Agents", async ({
  page,
}) => {
  const preflight = PreflightSchema.parse(
    await sendDaemonCommand({ type: "preflight.check", force: true }),
  );
  const signedOut = {
    ...preflight,
    agents: preflight.agents.map((agent) =>
      agent.cli === "codex" ? { ...agent, status: "sign-in" } : agent,
    ),
  };
  const logins: string[] = [];
  let isSignedIn = false;
  let canOpenTerminal = false;
  await page.routeWebSocket(
    `ws://127.0.0.1:${process.env.PLANNER_PORT ?? "4820"}/**`,
    (socket) => {
      const server = socket.connectToServer();
      socket.onMessage((raw) => {
        const command = ClientCommandSchema.safeParse(JSON.parse(String(raw)));
        if (!command.success) return server.send(raw);
        const { data } = command;
        if (data.type === "agent.login") logins.push(data.cli);
        else if (data.type !== "preflight.check") return server.send(raw);
        if (data.type === "agent.login" && !canOpenTerminal) {
          socket.send(
            JSON.stringify({
              type: "command.ack",
              ok: false,
              requestId: data.requestId,
              error: "Could not open Terminal.",
            }),
          );
          return;
        }
        socket.send(
          JSON.stringify({
            type: "command.ack",
            ok: true,
            requestId: data.requestId,
            result:
              data.type === "preflight.check"
                ? isSignedIn
                  ? preflight
                  : signedOut
                : {},
          }),
        );
      });
    },
  );

  await page.goto("/settings?feature=codex#setup");
  for (const section of [page.locator("#setup"), page.locator("#agents")]) {
    canOpenTerminal = false;
    const signIn = section.getByRole("button", { name: "Sign in to Codex" });
    await expect(signIn).toBeEnabled();
    await signIn.press("Enter");
    const error = section.getByRole("alert");
    await expect(error).toContainText("Could not open Terminal.");
    canOpenTerminal = true;
    await signIn.press("Enter");
    await expect(error).toHaveCount(0);
    await expect(
      section.getByText("Complete sign-in, then select Check again."),
    ).toBeVisible();
  }
  await expect.poll(() => logins).toEqual(["codex", "codex", "codex", "codex"]);
  await expect(page.locator("#agents").getByText("codex login")).toHaveCount(0);

  isSignedIn = true;
  const checkAgain = page.getByRole("button", {
    name: "check again",
    exact: true,
  });
  await checkAgain.click();
  await expect(
    page.getByRole("button", { name: "Use Codex for all roles" }),
  ).toBeVisible();
  isSignedIn = false;
  await checkAgain.click();
  await expect(
    page.locator("#setup").getByText("Sign in on this Mac to connect."),
  ).toBeVisible();
});

test("checks this Mac and installs selected photo tools", async ({ page }) => {
  test.skip(
    process.platform !== "darwin" || process.arch !== "arm64",
    "Photo tooling targets Apple silicon.",
  );
  await page.goto("/");
  await page.getByRole("link", { name: "Set up AI and photo tools" }).click();
  const setup = page.getByRole("region", { name: "Set up AI and photo tools" });
  await expect(setup.getByText(/free on the model disk/)).toBeVisible();
  await expect(setup.getByRole("checkbox")).toHaveCount(0);
  await expect(setup.getByText("Claude Code", { exact: true })).toHaveCount(0);
  await expect(setup.getByText("Codex", { exact: true })).toHaveCount(0);
  const setUpPhotos = setup.getByRole("button", {
    name: "Set up Rebuild rooms from photos",
  });
  await setUpPhotos.click();
  await expect(setUpPhotos).toHaveCount(0);
  const python = page.locator("#python");
  await expect(python.getByText("MapAnything", { exact: true })).toBeVisible();
  await expect(
    python.getByRole("button", { name: "Delete MapAnything" }),
  ).toBeVisible();
  await expect(
    python.getByRole("button", { name: "Delete SAM 3" }),
  ).toBeVisible();
});
