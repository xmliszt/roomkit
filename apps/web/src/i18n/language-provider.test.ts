// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { PlannerSessionContext } from "../planner/planner-session-context.ts";
import { createPlannerSession } from "../ws/create-planner-session.ts";
import { LanguageProvider } from "./language-provider.tsx";
import { loadMessages } from "./load-messages.ts";
import french from "./messages/fr.json";

vi.mock("./load-messages.ts", { spy: true });

const languageKey = "roomkit.language";

beforeEach(() => {
  vi.stubGlobal("location", new URL("https://roomkit.example.ts.net"));
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function renderEditor() {
  const session = createPlannerSession({
    url: "ws://unused",
    createSocket() {
      throw new Error("This test never connects");
    },
  });
  render(
    createElement(
      PlannerSessionContext,
      { value: session },
      createElement(
        LanguageProvider,
        null,
        createElement("input", { "aria-label": "Project draft" }),
      ),
    ),
  );
  return screen.findByRole("textbox", { name: "Project draft" });
}

test("rereads the saved language when storage notifies or clears", async () => {
  await renderEditor();
  localStorage.setItem(languageKey, "de");
  fireEvent(
    window,
    new StorageEvent("storage", { key: languageKey, newValue: "fr" }),
  );
  await waitFor(() => expect(document.documentElement.lang).toBe("de"));

  localStorage.clear();
  fireEvent(window, new StorageEvent("storage", { key: null }));
  await waitFor(() => expect(document.documentElement.lang).toBe("en"));
});

test("keeps the open editor and retries the latest preference after a catalog failure", async () => {
  localStorage.setItem(languageKey, "fr");
  const editor = await renderEditor();
  fireEvent.change(editor, { target: { value: "Unfinished project" } });

  const load = vi.mocked(loadMessages);
  load.mockRejectedValueOnce(new Error("Catalog unavailable"));
  localStorage.setItem(languageKey, "ja");
  fireEvent(
    window,
    new StorageEvent("storage", { key: languageKey, newValue: "ja" }),
  );
  expect((await screen.findByRole("alert")).textContent).toBe(
    french["language.loadFailed"],
  );
  expect(document.documentElement.lang).toBe("fr");
  expect(screen.getByRole("textbox", { name: "Project draft" })).toBe(editor);

  load.mockRejectedValueOnce(new Error("Catalog unavailable"));
  fireEvent.click(
    screen.getByRole("button", { name: french["language.retry"] }),
  );
  expect((await screen.findByRole("alert")).textContent).toBe(
    french["language.loadFailed"],
  );
  expect(load).toHaveBeenLastCalledWith("ja");

  localStorage.setItem(languageKey, "de");
  fireEvent.click(
    screen.getByRole("button", { name: french["language.retry"] }),
  );
  await waitFor(() => expect(document.documentElement.lang).toBe("de"));
  expect(load).toHaveBeenLastCalledWith("de");
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.getByRole("textbox", { name: "Project draft" })).toBe(editor);
  expect(editor).toHaveProperty("value", "Unfinished project");
});
