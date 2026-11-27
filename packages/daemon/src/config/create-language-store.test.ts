import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { createConfigStore } from "./create-config-store.ts";
import { createLanguageStore } from "./create-language-store.ts";

test("keeps first launch pending across restarts until language is chosen", ({
  onTestFinished,
}) => {
  const plannerHome = mkdtempSync(join(tmpdir(), "roomkit-language-"));
  onTestFinished(() => rmSync(plannerHome, { recursive: true, force: true }));

  expect(createLanguageStore({ plannerHome }).get()).toEqual({
    kind: "pending",
  });
  createConfigStore({ plannerHome });
  const restarted = createLanguageStore({ plannerHome });
  expect(restarted.get()).toEqual({ kind: "pending" });

  const selected = { kind: "selected", locale: "zh-Hant" };
  expect(restarted.set("zh-Hant")).toEqual(selected);
  expect(createLanguageStore({ plannerHome }).get()).toEqual(selected);
});

test("defaults an existing installation to English without changing config", ({
  onTestFinished,
}) => {
  const plannerHome = mkdtempSync(join(tmpdir(), "roomkit-language-"));
  onTestFinished(() => rmSync(plannerHome, { recursive: true, force: true }));
  createConfigStore({ plannerHome }).setBlenderPath("/opt/blender");
  const configPath = join(plannerHome, "config.json");
  const config = readFileSync(configPath, "utf8");

  const language = createLanguageStore({ plannerHome });
  expect(language.get()).toEqual({ kind: "selected", locale: "en" });
  language.set("fr");
  expect(readFileSync(configPath, "utf8")).toBe(config);
});

test.for(["{", '{"kind":"selected","locale":"unsupported"}'])(
  "defaults to English for invalid saved language %s",
  (saved, { onTestFinished }) => {
    const plannerHome = mkdtempSync(join(tmpdir(), "roomkit-language-"));
    onTestFinished(() => rmSync(plannerHome, { recursive: true, force: true }));
    writeFileSync(join(plannerHome, "language.json"), saved);

    expect(createLanguageStore({ plannerHome }).get()).toEqual({
      kind: "selected",
      locale: "en",
    });
  },
);

test("keeps first-launch selection available and lets the save be retried", ({
  onTestFinished,
}) => {
  const plannerHome = mkdtempSync(join(tmpdir(), "roomkit-language-"));
  onTestFinished(() => rmSync(plannerHome, { recursive: true, force: true }));
  const language = createLanguageStore({ plannerHome });
  const path = join(plannerHome, "language.json");
  const backup = join(plannerHome, "language.backup.json");
  renameSync(path, backup);
  mkdirSync(path);

  expect(language.get()).toEqual({ kind: "pending" });
  expect(() => language.set("fr")).toThrow();

  rmSync(path, { recursive: true });
  renameSync(backup, path);
  expect(language.get()).toEqual({ kind: "pending" });
  expect(language.set("fr")).toEqual({ kind: "selected", locale: "fr" });
});

test("opens existing installations when the language preference cannot be read", ({
  onTestFinished,
}) => {
  const plannerHome = mkdtempSync(join(tmpdir(), "roomkit-language-"));
  onTestFinished(() => rmSync(plannerHome, { recursive: true, force: true }));
  createConfigStore({ plannerHome });
  mkdirSync(join(plannerHome, "language.json"));
  const diagnostics: unknown[] = [];
  const language = createLanguageStore({
    plannerHome,
    onReadError: (error) => diagnostics.push(error),
  });

  expect(language.get()).toEqual({ kind: "selected", locale: "en" });
  expect(diagnostics).toHaveLength(1);
  expect(() => language.set("fr")).toThrow();
});

test("keeps the last selection when a running install loses access to its preference", ({
  onTestFinished,
}) => {
  const plannerHome = mkdtempSync(join(tmpdir(), "roomkit-language-"));
  onTestFinished(() => rmSync(plannerHome, { recursive: true, force: true }));
  const language = createLanguageStore({ plannerHome });
  createConfigStore({ plannerHome });
  const french = language.set("fr");
  const path = join(plannerHome, "language.json");
  rmSync(path);
  expect(language.get()).toEqual(french);
  mkdirSync(path);
  expect(language.get()).toEqual(french);
  expect(() => language.set("ja")).toThrow();
  expect(language.get()).toEqual(french);
  rmSync(path, { recursive: true });
  const japanese = { kind: "selected", locale: "ja" };
  writeFileSync(path, JSON.stringify(japanese));
  expect(language.get()).toEqual(japanese);
  writeFileSync(path, "{");
  expect(language.get()).toEqual(japanese);
});
