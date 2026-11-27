import { expect, test } from "vitest";
import { createTranslator } from "../i18n/create-translator.ts";
import french from "../i18n/messages/fr.json";
import { formatSceneChange } from "./format-scene-change.ts";

const locale = "fr";
const t = createTranslator({ locale, catalog: french });

test("formats stored measurements and keeps the item’s name intact", () => {
  const change = {
    label: "كرسي · أزرق · heightM",
    before: "0.40 m",
    after: "0.65 m",
  };
  expect(formatSceneChange({ change, locale, t })).toEqual({
    label: "\u2068كرسي · أزرق\u2069 · Au-dessus du sol",
    before: "0,40 m",
    after: "0,65 m",
  });
});

test("localizes the rename label and preserves item names as supplied", () => {
  const change = { label: "camera · name", before: "true", after: "1.625" };
  expect(formatSceneChange({ change, locale, t })).toEqual({
    label: `\u2068camera\u2069 · Nom`,
    before: change.before,
    after: change.after,
  });
});

test("preserves change text with an unknown field", () => {
  const change = {
    label: "camera · custom property",
    before: "true",
    after: "1.625",
  };
  expect(formatSceneChange({ change, locale, t })).toEqual(change);
});

test("localizes known wall and material labels in stored changes", () => {
  const change = {
    label: "room · surfaces wall-2 material finish",
    before: "matte",
    after: "satin",
  };
  expect(formatSceneChange({ change, locale, t })).toEqual({
    label: "\u2068Mur 2\u2069 · Finition",
    before: "Mat",
    after: "Satiné",
  });
});
