import type { Config } from "@planner/shared/src/config/config-schema.ts";
import type { LanguagePreference } from "@planner/shared/src/i18n/language-preference.ts";
import { createStore } from "zustand/vanilla";

export function createSnapshotStore() {
  return createStore<{
    config: Config | undefined;
    languagePreference: LanguagePreference | undefined;
    at: string | undefined;
    connection: "connecting" | "open" | "closed";
  }>(() => ({
    config: undefined,
    languagePreference: undefined,
    at: undefined,
    connection: "closed",
  }));
}
