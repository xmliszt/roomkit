import { expect, type Page, test } from "@playwright/test";
import { createProject } from "../../../e2e/create-project.ts";

async function openProject(page: Page) {
  const project = await createProject({
    name: "Voice room",
    widthM: 4,
    depthM: 5,
    ceilingHeightM: 2.6,
  });
  await page.goto(`/projects/${project.id}`);
  await expect(page.locator("canvas")).toBeVisible();
}

function installFakeRecognizer(page: Page) {
  return page.addInitScript(() => {
    class FakeSpeechRecognition {
      lang = "";
      continuous = false;
      interimResults = false;
      onstart: (() => void) | null = null;
      onresult = null;
      onerror = null;
      onend = null;
      calls: string[] = [];
      start() {
        this.calls.push("start");
        Object.assign(window, { fakeRecognizer: this });
        this.onstart?.();
      }
      stop() {
        this.calls.push("stop");
      }
      abort() {
        this.calls.push("abort");
      }
    }
    Object.assign(window, {
      SpeechRecognition: FakeSpeechRecognition,
      webkitSpeechRecognition: FakeSpeechRecognition,
    });
  });
}

function getRecognizer(page: Page) {
  return page.evaluate(() => {
    const recognizer = Reflect.get(window, "fakeRecognizer");
    return {
      lang: String(Reflect.get(recognizer, "lang")),
      calls: Array.from(Reflect.get(recognizer, "calls"), String),
    };
  });
}

function callHandler(options: {
  page: Page;
  handler: "onresult" | "onerror";
  event: unknown;
}) {
  return options.page.evaluate(
    (call) => {
      const recognizer = Reflect.get(window, "fakeRecognizer");
      const handler: unknown = Reflect.get(recognizer, call.handler);
      if (typeof handler === "function") handler(call.event);
    },
    { handler: options.handler, event: options.event },
  );
}

function emitResults(options: {
  page: Page;
  results: { transcript: string; isFinal: boolean }[];
}) {
  return options.page.evaluate((results) => {
    const recognizer = Reflect.get(window, "fakeRecognizer");
    const handler: unknown = Reflect.get(recognizer, "onresult");
    if (typeof handler !== "function") return;
    handler({
      results: results.map((result) =>
        Object.assign([{ transcript: result.transcript }], {
          isFinal: result.isFinal,
        }),
      ),
    });
  }, options.results);
}

function getMic(page: Page) {
  return page.getByRole("button", { name: "Voice input", exact: true });
}

function getInput(page: Page) {
  return page.getByRole("textbox", { name: "Message", exact: true });
}

test("M opens chat and dictates into the composer without sending", async ({
  page,
}) => {
  await installFakeRecognizer(page);
  const commands: string[] = [];
  page.on("websocket", (socket) =>
    socket.on("framesent", (frame) => {
      if (typeof frame.payload === "string") commands.push(frame.payload);
    }),
  );
  await openProject(page);
  const input = getInput(page);
  const mic = getMic(page);
  await input.fill("Add sofa");
  await input.evaluate((field) => {
    if (field instanceof HTMLInputElement) field.setSelectionRange(3, 3);
  });
  await page.locator("canvas").click({ position: { x: 40, y: 40 } });
  await page.keyboard.press("m");

  await expect(page.getByTestId("composer")).toHaveAttribute(
    "data-docked",
    "true",
  );
  await expect(mic).toHaveAttribute("aria-pressed", "true");
  await expect(mic).toHaveAttribute("aria-keyshortcuts", "Escape");
  await expect(input).toBeFocused();
  expect((await getRecognizer(page)).lang).toBe(
    await page.evaluate(() => navigator.language),
  );

  await emitResults({
    page,
    results: [{ transcript: "a green", isFinal: false }],
  });
  await expect(input).toHaveValue("Add a green sofa");
  await emitResults({
    page,
    results: [{ transcript: "a green velvet", isFinal: true }],
  });
  await expect(input).toHaveValue("Add a green velvet sofa");
  await emitResults({
    page,
    results: [
      { transcript: "a green velvet", isFinal: true },
      { transcript: " corner", isFinal: false },
    ],
  });
  await expect(input).toHaveValue("Add a green velvet corner sofa");

  await page.keyboard.press("Escape");
  await expect(mic).toHaveAttribute("aria-pressed", "false");
  await expect(input).toHaveValue("Add a green velvet corner sofa");
  await expect(input).toBeFocused();
  await expect(mic).toHaveAttribute("aria-keyshortcuts", "M");
  expect((await getRecognizer(page)).calls.slice(0, 2)).toEqual([
    "start",
    "stop",
  ]);
  await expect
    .poll(async () => (await getRecognizer(page)).calls)
    .toEqual(["start", "stop", "abort"]);
  await expect(page.getByRole("article", { name: "Your message" })).toHaveCount(
    0,
  );
  expect(commands.filter((payload) => payload.includes("chat.send"))).toEqual(
    [],
  );

  await mic.click();
  await expect(mic).toHaveAttribute("aria-pressed", "true");
  await callHandler({
    page,
    handler: "onerror",
    event: { error: "not-allowed" },
  });
  await expect(page.getByTestId("composer").getByRole("alert")).toHaveText(
    "Microphone blocked. Allow it in the site settings.",
  );
  await expect(mic).toHaveAttribute("aria-pressed", "false");
});

test("typing, closing the chat and sending stop dictation", async ({
  page,
}) => {
  await installFakeRecognizer(page);
  await openProject(page);
  const input = getInput(page);
  const mic = getMic(page);

  await mic.click();
  await expect(mic).toHaveAttribute("aria-pressed", "true");
  await emitResults({ page, results: [{ transcript: "a", isFinal: false }] });
  await input.press("End");
  await input.pressSequentially(" lamp");
  await expect(mic).toHaveAttribute("aria-pressed", "false");
  expect((await getRecognizer(page)).calls).toEqual(["start", "abort"]);
  await emitResults({ page, results: [{ transcript: "b", isFinal: true }] });
  await expect(input).toHaveValue("a lamp");

  await page.locator("canvas").click({ position: { x: 40, y: 40 } });
  await page.keyboard.press("m");
  await expect(mic).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "chat", exact: true }).click();
  await expect(page.getByTestId("composer")).toHaveAttribute(
    "data-docked",
    "false",
  );
  await expect(mic).toHaveAttribute("aria-pressed", "false");
  expect((await getRecognizer(page)).calls).toEqual(["start", "abort"]);

  await mic.click();
  await expect(mic).toHaveAttribute("aria-pressed", "true");
  await emitResults({
    page,
    results: [{ transcript: "by the bed", isFinal: false }],
  });
  await expect(input).toHaveValue("a lamp by the bed");
  await input.press("Enter");
  await expect(mic).toHaveAttribute("aria-pressed", "false");
  await expect(input).toHaveValue("");
  await expect(
    page.getByRole("article", { name: "Your message" }).first(),
  ).toContainText("a lamp by the bed");
  expect((await getRecognizer(page)).calls).toEqual(["start", "abort"]);
  await emitResults({
    page,
    results: [{ transcript: "by the bed please", isFinal: true }],
  });
  await expect(input).toHaveValue("");
});

test("another writer, an open dialog and leaving the editor stop dictation", async ({
  page,
}) => {
  await installFakeRecognizer(page);
  await openProject(page);
  const input = getInput(page);
  const mic = getMic(page);

  await mic.click();
  await emitResults({
    page,
    results: [{ transcript: "a lamp", isFinal: false }],
  });
  await expect(input).toHaveValue("a lamp");
  await input.evaluate((field) => {
    if (field instanceof HTMLInputElement) field.value = "";
  });
  await emitResults({
    page,
    results: [{ transcript: "a lamp by the bed", isFinal: false }],
  });
  await expect(input).toHaveValue("");
  await expect(mic).toHaveAttribute("aria-pressed", "false");
  expect((await getRecognizer(page)).calls).toEqual(["start", "abort"]);

  await page.locator("canvas").click({ position: { x: 40, y: 40 } });
  await page.keyboard.press("?");
  await expect(
    page.getByRole("dialog", { name: "Keyboard shortcuts" }),
  ).toBeVisible();
  await page.keyboard.press("m");
  await expect(mic).toHaveAttribute("aria-pressed", "false");
  await page.keyboard.press("?");
  await expect(
    page.getByRole("dialog", { name: "Keyboard shortcuts" }),
  ).toHaveCount(0);

  await mic.click();
  await expect(mic).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: /^Voice room/ }).click();
  await page.getByRole("menuitem", { name: "back to projects" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect
    .poll(async () => (await getRecognizer(page)).calls)
    .toEqual(["start", "abort"]);
});

test("the mic is disabled where the browser has no speech recognition", async ({
  page,
}) => {
  await page.addInitScript(() => {
    for (const target of [window, Window.prototype]) {
      Reflect.deleteProperty(target, "SpeechRecognition");
      Reflect.deleteProperty(target, "webkitSpeechRecognition");
    }
  });
  await openProject(page);
  expect(
    await page.evaluate(
      () =>
        "SpeechRecognition" in window || "webkitSpeechRecognition" in window,
    ),
  ).toBe(false);
  const mic = getMic(page);
  await expect(mic).toHaveAttribute("aria-disabled", "true");
  await expect(mic).toHaveAttribute(
    "title",
    "Voice input needs Chrome or Safari",
  );
  await page.locator("canvas").click({ position: { x: 40, y: 40 } });
  await page.keyboard.press("m");
  await expect(page.getByTestId("composer")).toHaveAttribute(
    "data-docked",
    "true",
  );
  await expect(mic).toHaveAttribute("aria-pressed", "false");
});

test("closing the Roomkit window cancels dictation", async ({ page }) => {
  await installFakeRecognizer(page);
  await openProject(page);
  const mic = getMic(page);
  await mic.click();
  await expect(mic).toHaveAttribute("aria-pressed", "true");

  await page.evaluate(() =>
    window.dispatchEvent(new Event("roomkit:window-close")),
  );

  await expect(mic).toHaveAttribute("aria-pressed", "false");
  expect((await getRecognizer(page)).calls).toEqual(["start", "abort"]);
  await expect(page.locator("canvas")).toBeVisible();
});
