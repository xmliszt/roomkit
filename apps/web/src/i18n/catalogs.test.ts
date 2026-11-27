import { readdirSync, readFileSync } from "node:fs";
import { AppLocaleSchema } from "@planner/shared/src/i18n/app-locale.ts";
import languageNames from "@planner/shared/src/i18n/locale-names.json";
import { expect, test } from "vitest";
import { createTranslator } from "./create-translator.ts";
import { getTextDirection } from "./get-text-direction.ts";
import { matchAppLocale } from "./match-app-locale.ts";
import english from "./messages/en.json";

const messageKeys = Object.keys(english).toSorted();

function placeholders(message: string) {
  return [...message.matchAll(/\{\w+\}/g)].map(([match]) => match).toSorted();
}

test("the app offers the landing page's 18 language names", () => {
  const published = new URL(
    "../../../../marketing/roomkit/locales/published.json",
    import.meta.url,
  );
  expect(languageNames).toEqual(JSON.parse(readFileSync(published, "utf8")));
  expect(AppLocaleSchema.options).toHaveLength(18);
});

test.each(AppLocaleSchema.options)(
  "%s covers every message and placeholder",
  (locale) => {
    const catalog = new URL(`./messages/${locale}.json`, import.meta.url);
    const translations: unknown = JSON.parse(readFileSync(catalog, "utf8"));
    expect(Object.keys(Object(translations)).toSorted()).toEqual(messageKeys);

    for (const [key, message] of Object.entries(english)) {
      const translation: unknown = Object(translations)[key];
      if (typeof translation !== "string") throw new Error(`${locale}: ${key}`);
      expect(translation.trim(), key).not.toBe("");
      expect(placeholders(translation), key).toEqual(placeholders(message));
    }
  },
);

test.each([
  { requested: ["fr-CA"], expected: "fr" },
  { requested: ["zh-TW"], expected: "zh-Hant" },
  { requested: ["zh-Hant-CN"], expected: "zh-Hant" },
  { requested: ["zh-SG"], expected: "zh-Hans" },
  { requested: ["bad_tag", "pt-PT"], expected: "pt-BR" },
  { requested: ["sv-SE", "ja-JP"], expected: "ja" },
  { requested: ["sv-SE"], expected: "en" },
])("matches $requested to $expected", ({ requested, expected }) => {
  expect(matchAppLocale(requested)).toBe(expected);
});

test("falls back to English and formats numbers without changing names or commands", () => {
  const t = createTranslator({
    locale: "de",
    catalog: { measurement: "{name} · {distance} m · {command}" },
  });
  expect(t("language.continue")).toBe("Continue");
  expect(
    t("measurement", {
      name: "{distance}",
      distance: 12.5,
      command: "pnpm daemon",
    }),
  ).toBe("{distance} · 12,5 m · pnpm daemon");
});

test("literal message lookups reference English catalog entries", () => {
  const source = new URL("../", import.meta.url);
  const productionFiles = readdirSync(source, {
    recursive: true,
    encoding: "utf8",
  }).filter(
    (path) => /\.tsx?$/.test(path) && !/\.(test|spec)\.tsx?$/.test(path),
  );
  const missing = productionFiles.flatMap((path) => {
    const text = readFileSync(new URL(path, source), "utf8");
    return [...text.matchAll(/\bt\(\s*"([\w.-]+)"/g)].flatMap(([, key]) =>
      key && !Object.hasOwn(english, key) ? [`${path}: ${key}`] : [],
    );
  });
  expect(missing).toEqual([]);
});

test("direction follows the locale script", () => {
  expect(AppLocaleSchema.options.map(getTextDirection)).toEqual(
    AppLocaleSchema.options.map(() => "ltr"),
  );
  expect(getTextDirection("ar")).toBe("rtl");
  expect(getTextDirection("he")).toBe("rtl");
  expect(getTextDirection("ar-Latn")).toBe("ltr");
  expect(getTextDirection("en-Arab")).toBe("rtl");
});
