"use client";

import {
  type AppLocale,
  AppLocaleSchema,
} from "@planner/shared/src/i18n/app-locale.ts";
import { LanguagePreferenceSchema } from "@planner/shared/src/i18n/language-preference.ts";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "zustand";
import { PageColumn } from "../pages-ui/page-column.tsx";
import { RowButton } from "../pages-ui/row-button.tsx";
import { usePlannerSession } from "../planner/use-planner-session.ts";
import type { createSnapshotStore } from "../stores/create-snapshot-store.ts";
import { ChooseLanguage } from "./choose-language.tsx";
import { createTranslator } from "./create-translator.ts";
import { getTextDirection } from "./get-text-direction.ts";
import { LanguageContext } from "./language-context.ts";
import { loadMessages } from "./load-messages.ts";
import { matchAppLocale } from "./match-app-locale.ts";
import english from "./messages/en.json";

type LanguageView = {
  kind: "pending" | "selected";
  locale: AppLocale;
  catalog: { [key: string]: string };
};

type LanguageLoad = "preference" | "catalog";

const browserLanguageKey = "roomkit.language";

function usesLocalPreferences() {
  return location.hostname === "127.0.0.1" || location.hostname === "localhost";
}

function readBrowserLocale() {
  try {
    const parsed = AppLocaleSchema.safeParse(
      localStorage.getItem(browserLanguageKey),
    );
    return parsed.success ? parsed.data : "en";
  } catch {
    return "en";
  }
}

function syncBrowserLocale(snapshot: ReturnType<typeof createSnapshotStore>) {
  const locale = readBrowserLocale();
  const current = snapshot.getState().languagePreference;
  if (current?.kind === "selected" && current.locale === locale) return;
  snapshot.setState({ languagePreference: { kind: "selected", locale } });
}

export function LanguageProvider(props: { children: ReactNode }) {
  const session = usePlannerSession();
  const snapshot = session.stores.snapshot;
  const connection = useStore(snapshot, (state) => state.connection);
  const preference = useStore(snapshot, (state) => state.languagePreference);
  const [view, setView] = useState<LanguageView>();
  const [loadFailed, setLoadFailed] = useState<LanguageLoad>();
  const [attempts, setAttempts] = useState({ preference: 0, catalog: 0 });
  const [saving, setSaving] = useState(false);
  const [waitingForDaemon, setWaitingForDaemon] = useState(false);
  const saveInProgress = useRef(false);
  const locale = view?.locale ?? "en";
  const catalog = view?.catalog ?? english;
  const t = useMemo(
    () => createTranslator({ locale, catalog }),
    [locale, catalog],
  );

  useEffect(() => {
    if (preference || connection === "open" || !usesLocalPreferences()) return;
    const timeout = window.setTimeout(() => setWaitingForDaemon(true), 2500);
    return () => window.clearTimeout(timeout);
  }, [connection, preference]);

  useEffect(() => {
    if (usesLocalPreferences()) return;
    function onStorage(event: StorageEvent) {
      if (event.key === browserLanguageKey || event.key === null)
        syncBrowserLocale(snapshot);
    }
    syncBrowserLocale(snapshot);
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [snapshot]);

  useEffect(() => {
    if (!usesLocalPreferences() || connection !== "open") return;
    if (attempts.preference > 0)
      setLoadFailed((failed) => (failed === "preference" ? undefined : failed));
    let active = true;
    const previous = snapshot.getState().languagePreference;
    void session
      .command({ type: "language.get" })
      .then((ack) => {
        if (!active || snapshot.getState().languagePreference !== previous)
          return;
        if (!ack.ok) throw new Error(ack.error);
        snapshot.setState({
          languagePreference: LanguagePreferenceSchema.parse(ack.result),
        });
        setLoadFailed((failed) =>
          failed === "preference" ? undefined : failed,
        );
      })
      .catch(() => {
        if (active && snapshot.getState().languagePreference === previous)
          setLoadFailed("preference");
      });
    return () => {
      active = false;
    };
  }, [attempts.preference, connection, session, snapshot]);

  useEffect(() => {
    if (!preference || snapshot.getState().languagePreference !== preference)
      return;
    if (attempts.catalog > 0)
      setLoadFailed((failed) => (failed === "catalog" ? undefined : failed));
    let active = true;
    const selected =
      preference.kind === "pending"
        ? matchAppLocale(navigator.languages)
        : preference.locale;
    void loadMessages(selected)
      .then((messages) => {
        if (active && snapshot.getState().languagePreference === preference) {
          setLoadFailed((failed) =>
            failed === "catalog" ? undefined : failed,
          );
          setView({
            kind: preference.kind,
            locale: selected,
            catalog: messages,
          });
        }
      })
      .catch(() => {
        if (active && snapshot.getState().languagePreference === preference)
          setLoadFailed("catalog");
      });
    return () => {
      active = false;
    };
  }, [attempts.catalog, preference, snapshot]);

  useEffect(() => {
    const root = document.documentElement;
    const { lang, dir } = root;
    root.lang = locale;
    root.dir = getTextDirection(locale);
    return () => {
      root.lang = lang;
      root.dir = dir;
    };
  }, [locale]);

  async function saveLanguage(selected: AppLocale) {
    if (saveInProgress.current) return false;
    saveInProgress.current = true;
    setSaving(true);
    try {
      await loadMessages(selected);
      if (usesLocalPreferences()) {
        const previous = snapshot.getState().languagePreference;
        const ack = await session.command({
          type: "language.set",
          locale: selected,
          ...(view?.kind === "pending" ? { firstLaunch: true } : {}),
        });
        if (!ack.ok) return false;
        if (snapshot.getState().languagePreference === previous) {
          snapshot.setState({
            languagePreference: LanguagePreferenceSchema.parse(ack.result),
          });
        }
      } else {
        localStorage.setItem(browserLanguageKey, selected);
        snapshot.setState({
          languagePreference: { kind: "selected", locale: selected },
        });
      }
      return true;
    } catch {
      return false;
    } finally {
      saveInProgress.current = false;
      setSaving(false);
    }
  }

  function retryLoad() {
    if (!loadFailed) return;
    if (!usesLocalPreferences()) syncBrowserLocale(snapshot);
    setAttempts((current) => ({
      ...current,
      [loadFailed]: current[loadFailed] + 1,
    }));
  }

  const loadError = loadFailed && (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <p role="alert" className="text-danger">
        {t("language.loadFailed")}
      </p>
      <RowButton onClick={retryLoad}>{t("language.retry")}</RowButton>
    </div>
  );

  if (!view && loadError) {
    return <PageColumn title={t("language.label")}>{loadError}</PageColumn>;
  }

  if (!view) {
    return (
      <main className="mx-auto w-full max-w-[720px] px-4 py-16">
        <output>
          {waitingForDaemon && connection !== "open"
            ? t("projects.daemonUnavailable", { command: "pnpm daemon" })
            : t("language.connecting")}
        </output>
      </main>
    );
  }

  return (
    <LanguageContext value={{ locale, t, saveLanguage, saving }}>
      {loadError && (
        <div className="fixed inset-x-4 top-4 z-toast mx-auto max-w-lg rounded-panel border border-line bg-panel p-3">
          {loadError}
        </div>
      )}
      {view.kind === "pending" ? (
        <ChooseLanguage suggested={locale} />
      ) : (
        props.children
      )}
    </LanguageContext>
  );
}
