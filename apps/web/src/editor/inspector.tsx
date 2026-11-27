import type { ComponentProps } from "react";
import { useMessages } from "../i18n/use-messages.ts";
import { InspectorBody } from "./inspector-body.tsx";

type InspectorProps = ComponentProps<typeof InspectorBody> & {
  onClose: () => void;
};

export function Inspector(props: InspectorProps) {
  const t = useMessages();
  return (
    <aside
      aria-label={t("editor.inspector.inspector")}
      data-chrome
      className="panel absolute z-control top-[72px] right-4 max-h-[calc(100%-144px)] w-[300px] overflow-x-hidden overflow-y-auto p-3"
    >
      <button
        type="button"
        aria-label={t("editor.inspector.deselect")}
        title={t("editor.inspector.deselect-esc")}
        onClick={props.onClose}
        className="absolute top-2 right-2 grid size-7 place-items-center text-ink-dim hover:text-ink"
      >
        <svg
          viewBox="0 0 16 16"
          aria-hidden="true"
          className="size-3.5 fill-none stroke-current"
        >
          <path d="M4 4l8 8M12 4l-8 8" strokeWidth="1.25" />
        </svg>
      </button>
      <InspectorBody {...props} />
    </aside>
  );
}
