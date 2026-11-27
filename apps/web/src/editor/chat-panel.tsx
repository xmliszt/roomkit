"use client";

import { motion } from "motion/react";
import { type ComponentProps, useId } from "react";
import { LogPanel } from "../activity/log-panel.tsx";
import type { ChatActions } from "../chat/chat-actions.ts";
import { ChatThread } from "../chat/chat-thread.tsx";
import { useMessages } from "../i18n/use-messages.ts";
import { JobsPanel } from "../jobs/jobs-panel.tsx";
import type { ChatTab } from "./chat-tab.ts";
import { InspectorBody } from "./inspector-body.tsx";
import { panelEnter, panelExit } from "./interface-motion.ts";
import { ObjectsPanel } from "./objects/objects-panel.tsx";

type ChatPanelProps = {
  tab: ChatTab;
  projectId: string;
  actions: ChatActions | undefined;
  selectedJobId: string | undefined;
  error: string | undefined;
  onStop: () => void;
  selected: ComponentProps<typeof InspectorBody> | undefined;
  onTabChange: (tab: ChatTab) => void;
  objects: ComponentProps<typeof ObjectsPanel> | undefined;
};

export function ChatPanel(props: ChatPanelProps) {
  const t = useMessages();
  const panelId = useId();
  const tabs = [
    { tab: "chat", label: t("editor.chat-panel.chat") },
    { tab: "objects", label: t("editor.chat-panel.objects") },
    { tab: "jobs", label: t("editor.chat-panel.jobs") },
    { tab: "log", label: t("editor.chat-panel.log") },
    { tab: "selected", label: t("editor.chat-panel.selected") },
  ] satisfies { tab: ChatTab; label: string }[];
  const selected = props.selected;
  const shownTabs = tabs.filter(
    (entry) => selected !== undefined || entry.tab !== "selected",
  );
  const activeTab =
    selected === undefined && props.tab === "selected" ? "chat" : props.tab;

  return (
    <motion.aside
      aria-label={t("editor.chat-panel.chat")}
      data-chrome
      data-testid="chat-panel"
      initial={{ opacity: 0, x: 8 }}
      animate={{ opacity: 1, x: 0, transition: panelEnter }}
      exit={{ opacity: 0, x: 4, transition: panelExit }}
      className="panel z-panel max-[1099px]:top-[45%] absolute top-[72px] right-4 bottom-4 flex w-[min(400px,calc(100%-32px))] flex-col"
    >
      <div
        role="tablist"
        aria-label={t("editor.chat-panel.chat-panels")}
        className="flex flex-wrap gap-x-4 gap-y-2 border-line border-b px-3 py-2.5"
      >
        {shownTabs.map((entry) => (
          <button
            key={entry.tab}
            type="button"
            role="tab"
            data-room-tour-target={entry.tab}
            id={`${panelId}-${entry.tab}`}
            aria-controls={panelId}
            tabIndex={activeTab === entry.tab ? 0 : -1}
            aria-selected={activeTab === entry.tab}
            onKeyDown={(event) => {
              if (
                !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
              )
                return;
              event.preventDefault();
              const index = shownTabs.findIndex((tab) => tab.tab === activeTab);
              const next =
                event.key === "Home"
                  ? shownTabs.at(0)
                  : event.key === "End"
                    ? shownTabs.at(-1)
                    : shownTabs.at(
                        (index +
                          (event.key === "ArrowRight" ? 1 : -1) +
                          shownTabs.length) %
                          shownTabs.length,
                      );
              if (next) {
                props.onTabChange(next.tab);
                document.getElementById(`${panelId}-${next.tab}`)?.focus();
              }
            }}
            onClick={() => props.onTabChange(entry.tab)}
            className="type-label hover:text-ink aria-selected:text-ink"
          >
            {entry.label}
          </button>
        ))}
      </div>
      <div
        id={panelId}
        role="tabpanel"
        aria-labelledby={`${panelId}-${activeTab}`}
        className={
          activeTab === "chat"
            ? "flex min-h-0 flex-1 flex-col"
            : "min-h-0 flex-1 overflow-y-auto p-3 pb-20"
        }
      >
        {(() => {
          switch (activeTab) {
            case "chat":
              return props.actions ? (
                <ChatThread
                  actions={props.actions}
                  error={props.error}
                  onStop={props.onStop}
                />
              ) : (
                <p className="p-3 text-ink-dim">
                  {t("editor.chat-panel.opening-project")}
                </p>
              );
            case "jobs":
              return (
                <JobsPanel
                  key={props.selectedJobId}
                  projectId={props.projectId}
                  selectedJobId={props.selectedJobId}
                />
              );
            case "objects":
              return props.objects ? (
                <ObjectsPanel key={props.projectId} {...props.objects} />
              ) : null;
            case "log":
              return <LogPanel projectId={props.projectId} />;
            case "selected":
              return selected === undefined ? null : (
                <InspectorBody key={selected.item.id} {...selected} />
              );
            default: {
              const unreachable: never = activeTab;
              return unreachable;
            }
          }
        })()}
      </div>
    </motion.aside>
  );
}
