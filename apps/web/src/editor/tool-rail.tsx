import { AnimatePresence } from "motion/react";
import type { ComponentProps, ReactNode, RefObject } from "react";
import { useMessages } from "../i18n/use-messages.ts";
import { AddPicker } from "./add-picker.tsx";
import type { Tool } from "./tool.ts";

type ToolRailProps = {
  tool: Tool;
  addButtonRef: RefObject<HTMLButtonElement | null>;
  add: Omit<ComponentProps<typeof AddPicker>, "triggerRef"> | undefined;
  onToolChange: (tool: Tool) => void;
  onToggleAdd: () => void;
};

const tools: {
  tool: Tool;
  label: string;
  shortcut: string;
  icon: ReactNode;
}[] = [
  {
    tool: "select",
    label: "editor.tool-rail.select",
    shortcut: "V",
    icon: <path d="M3.5 2.5l8.5 5-3.8 1.1L6.6 12.5z" />,
  },
  {
    tool: "rotate",
    label: "editor.tool-rail.rotate",
    shortcut: "R",
    icon: <path d="M13.5 8a5.5 5.5 0 1 1-1.8-4.1M13.5 2v3h-3" />,
  },
];

export function ToolRail(props: ToolRailProps) {
  const t = useMessages();
  return (
    <div
      role="toolbar"
      aria-label={t("editor.tool-rail.tools")}
      aria-orientation="vertical"
      data-chrome
      data-room-tour-target="tools"
      className="panel absolute top-[72px] left-4 z-control flex flex-col"
    >
      {tools.map((entry) => (
        <button
          key={entry.tool}
          type="button"
          title={`${t(entry.label)} (${entry.shortcut})`}
          aria-label={t(entry.label)}
          data-room-tour-target={entry.tool === "select" ? "select" : undefined}
          aria-pressed={props.tool === entry.tool}
          onClick={() => props.onToolChange(entry.tool)}
          className="grid size-9 place-items-center border-line border-b aria-pressed:bg-accent-soft aria-pressed:text-accent"
        >
          <svg
            viewBox="0 0 16 16"
            className="size-4 fill-none stroke-current"
            aria-hidden="true"
          >
            {entry.icon}
          </svg>
        </button>
      ))}
      <div className="relative">
        <button
          ref={props.addButtonRef}
          type="button"
          data-room-tour-target="add"
          title={t("editor.tool-rail.add")}
          aria-label={t("editor.tool-rail.add")}
          aria-expanded={props.add !== undefined}
          aria-haspopup="dialog"
          onClick={props.onToggleAdd}
          className="grid size-9 place-items-center aria-expanded:bg-accent-soft aria-expanded:text-accent"
        >
          <svg
            viewBox="0 0 16 16"
            className="size-4 fill-none stroke-current"
            aria-hidden="true"
          >
            <path d="M8 2.5v11M2.5 8h11" />
          </svg>
        </button>
        <AnimatePresence>
          {props.add && (
            <AddPicker
              key="add-picker"
              {...props.add}
              triggerRef={props.addButtonRef}
            />
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
