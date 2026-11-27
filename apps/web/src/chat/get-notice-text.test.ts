import { expect, test } from "vitest";
import { createTranslator } from "../i18n/create-translator.ts";
import french from "../i18n/messages/fr.json";
import { getNoticeText } from "./get-notice-text.ts";

const t = createTranslator({ locale: "fr", catalog: french });

test("localizes existing setup notices and keeps the product name", () => {
  expect(
    getNoticeText({
      t,
      block: {
        kind: "notice",
        text: "Codex is not signed in. Sign in, then check again in Settings.",
        detail: { kind: "missing-requirement", settingsSection: "agents" },
      },
    }),
  ).toBe(
    "Vous n’êtes pas connecté à Codex. Connectez-vous, puis vérifiez à nouveau dans les paramètres.",
  );
});

test("keeps the agent’s original error text", () => {
  const text = "لم يُعثر على المصباح";
  expect(
    getNoticeText({
      t,
      block: { kind: "notice", text, detail: { kind: "error" } },
    }),
  ).toBe(text);
});
