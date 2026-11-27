import { Camera } from "lucide-react";
import type { ReactNode } from "react";
import { useMessages } from "../i18n/use-messages.ts";
import { ShortcutKeys } from "./shortcut-keys.tsx";

type BottomRightProps = {
  tour: ReactNode;
  status: { kind: "info" | "error"; text: string } | undefined;
  snapshotBusy: boolean;
  chatOpen: boolean;
  onSnapshot: () => void;
};

export function BottomRight(props: BottomRightProps) {
  const t = useMessages();
  return (
    <div
      className={`absolute bottom-4 flex items-center gap-x-3 ${props.chatOpen ? "right-[432px] max-sm:right-4 max-sm:bottom-[calc(55%+12px)]" : "right-4 max-[849px]:bottom-15"}`}
    >
      {props.status !== undefined && (
        <output
          data-chrome
          data-testid="editor-status"
          className={
            props.status.kind === "error"
              ? "relative z-toast text-danger"
              : "relative z-toast text-ink-dim"
          }
        >
          {props.status.text}
        </output>
      )}
      {props.tour}
      <button
        type="button"
        data-chrome
        aria-label={t("editor.bottom-right.snapshot")}
        disabled={props.snapshotBusy}
        onPointerDown={(event) => event.preventDefault()}
        onClick={props.onSnapshot}
        className="press relative z-control flex h-7 items-center gap-x-1.5 whitespace-nowrap rounded-panel border border-line bg-panel px-2 hover:border-line-strong disabled:text-ink-dim [&>kbd]:text-inherit"
      >
        <Camera aria-hidden="true" size={14} strokeWidth={1.5} />
        <ShortcutKeys keys={["command", "shift", { letter: "S" }]} />
      </button>
    </div>
  );
}
