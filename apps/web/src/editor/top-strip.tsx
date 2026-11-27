import { AnimatePresence } from "motion/react";
import Link from "next/link";
import {
  type ReactNode,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from "react";
import { useMessages } from "../i18n/use-messages.ts";
import { ShortcutKeys } from "./shortcut-keys.tsx";

type TopStripProps = {
  walking: boolean;
  lensMm: number;
  onLensChange: (lensMm: number) => void;
  onLensRelease: () => void;
  onToggleWalk: () => void;
  name: string;
  dimensions: string;
  labelsShown: boolean;
  onToggleLabels: () => void;
  gridShown: boolean;
  onToggleGrid: () => void;
  snapping: boolean;
  onToggleSnapping: () => void;
  chatOpen: boolean;
  onToggleChat: () => void;
  onOpenCommands: () => void;
  onOpenShortcuts: () => void;
  onNavigateToSettings: () => void;
  projectMenu: ReactNode;
  projectId: string;
  roomPanel: ReactNode;
  onToggleProjectMenu: () => void;
  onToggleRoomPanel: () => void;
  popoverRef: RefObject<HTMLDivElement | null>;
};

export function TopStrip(props: TopStripProps) {
  const t = useMessages();
  const nameRef = useRef<HTMLSpanElement>(null);
  const [truncatedName, setTruncatedName] = useState<string>();
  useEffect(() => {
    const name = nameRef.current;
    if (!name) return;
    function measure() {
      if (name)
        setTruncatedName(
          name.scrollWidth > name.clientWidth ? props.name : undefined,
        );
    }
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(name);
    return () => observer.disconnect();
  }, [props.name]);
  return (
    <header className="pointer-events-none absolute top-0 right-4 left-4 z-control flex h-12 items-center gap-x-4 max-sm:h-auto max-sm:flex-wrap max-sm:justify-end max-sm:gap-x-2 max-sm:gap-y-1 max-sm:py-2">
      <div
        ref={props.popoverRef}
        className="pointer-events-auto grid min-w-0 max-w-[40%] grid-cols-[minmax(0,220px)_auto] items-center gap-x-4"
      >
        <div className="relative min-w-0">
          <h1 data-chrome>
            <button
              type="button"
              data-testid="project-title"
              aria-haspopup="menu"
              aria-expanded={props.projectMenu !== undefined}
              onClick={props.onToggleProjectMenu}
              className="type-project-title grid w-full grid-cols-[minmax(0,1fr)_12px] items-center gap-x-1.5 whitespace-nowrap text-start"
            >
              <span
                dir="auto"
                ref={nameRef}
                className="truncate"
                title={
                  truncatedName === props.name &&
                  props.projectMenu === undefined
                    ? props.name
                    : undefined
                }
              >
                {props.name}
              </span>
              <span className="font-mono text-[11px] text-ink-dim">▾</span>
            </button>
          </h1>
          <AnimatePresence>{props.projectMenu}</AnimatePresence>
        </div>
        <div className="relative">
          <button
            type="button"
            data-chrome
            data-testid="room-size"
            data-room-tour-target="wall"
            aria-haspopup="dialog"
            aria-expanded={props.roomPanel !== undefined}
            onClick={props.onToggleRoomPanel}
            className="whitespace-nowrap text-ink-dim tabular-nums hover:text-ink aria-expanded:text-ink"
          >
            {props.dimensions}
          </button>
          <AnimatePresence>{props.roomPanel}</AnimatePresence>
        </div>
      </div>
      <span className="flex-1" />
      <button
        type="button"
        data-chrome
        aria-label={t("editor.top-strip.walk-mode")}
        aria-pressed={props.walking}
        aria-keyshortcuts={props.walking ? "Escape" : "W"}
        onPointerDown={(event) => event.preventDefault()}
        onClick={props.onToggleWalk}
        className="press pointer-events-auto flex h-7 items-center gap-x-1.5 whitespace-nowrap rounded-panel border border-line bg-panel px-2.5 hover:border-line-strong aria-pressed:border-accent aria-pressed:text-accent"
      >
        {t("editor.top-strip.walk")}{" "}
        <kbd className="font-mono text-ink-dim">
          {props.walking ? "Esc" : "W"}
        </kbd>
      </button>
      {props.walking && (
        <label
          data-chrome
          className="pointer-events-auto absolute top-12 right-0 flex h-7 items-center gap-x-2 rounded-panel border border-line bg-panel px-2.5 text-ink-dim max-sm:top-full"
        >
          {t("editor.top-strip.lens")}{" "}
          <input
            aria-label={t("editor.top-strip.lens-focal-length")}
            onPointerDown={() =>
              window.addEventListener("pointerup", props.onLensRelease, {
                once: true,
              })
            }
            type="range"
            min={16}
            max={50}
            step={1}
            value={props.lensMm}
            onChange={(event) => props.onLensChange(Number(event.target.value))}
            className="w-24 accent-accent"
          />
          <span className="w-10 whitespace-nowrap text-right tabular-nums">
            {props.lensMm} mm
          </span>
        </label>
      )}
      <button
        type="button"
        data-chrome
        aria-pressed={props.labelsShown}
        aria-keyshortcuts="L"
        onPointerDown={(event) => event.preventDefault()}
        onClick={props.onToggleLabels}
        className="press pointer-events-auto h-7 whitespace-nowrap rounded-panel border border-line bg-panel px-2.5 hover:border-line-strong aria-pressed:border-accent aria-pressed:text-accent"
      >
        {t("editor.top-strip.labels")}
        <kbd className="ml-1.5 font-mono text-ink-dim">L</kbd>
      </button>
      <button
        type="button"
        data-chrome
        aria-pressed={props.gridShown}
        aria-keyshortcuts="G"
        title={t("editor.top-strip.show-the-floor-dot-grid")}
        onPointerDown={(event) => event.preventDefault()}
        onClick={props.onToggleGrid}
        className="press pointer-events-auto h-7 whitespace-nowrap rounded-panel border border-line bg-panel px-2.5 hover:border-line-strong aria-pressed:border-accent aria-pressed:text-accent"
      >
        {t("editor.top-strip.grid")}
        <kbd className="ml-1.5 font-mono text-ink-dim">G</kbd>
      </button>
      <button
        type="button"
        data-chrome
        aria-pressed={props.snapping}
        aria-keyshortcuts="S"
        title={t("editor.top-strip.snap-to-0-05-m-and-15-hold")}
        onPointerDown={(event) => event.preventDefault()}
        onClick={props.onToggleSnapping}
        className="press pointer-events-auto h-7 whitespace-nowrap rounded-panel border border-line bg-panel px-2.5 hover:border-line-strong aria-pressed:border-accent aria-pressed:text-accent"
      >
        {t("editor.top-strip.snap")}
        <kbd className="ml-1.5 font-mono text-ink-dim">S</kbd>
      </button>
      <button
        type="button"
        data-chrome
        onClick={props.onOpenCommands}
        aria-haspopup="dialog"
        className="press pointer-events-auto h-7 whitespace-nowrap rounded-panel border border-line bg-panel px-2.5 hover:border-line-strong"
      >
        {t("editor.top-strip.commands")}{" "}
        <ShortcutKeys
          className="ml-1.5 align-middle"
          keys={["command", { letter: "K" }]}
        />
      </button>
      <button
        type="button"
        data-chrome
        aria-label={t("editor.top-strip.chat")}
        data-room-tour-target="chat-toggle"
        aria-keyshortcuts="C"
        aria-pressed={props.chatOpen}
        onPointerDown={(event) => event.preventDefault()}
        onClick={props.onToggleChat}
        className="press pointer-events-auto h-7 whitespace-nowrap rounded-panel border border-line bg-panel px-2.5 hover:border-line-strong aria-pressed:border-accent aria-pressed:text-accent"
      >
        {t("editor.top-strip.chat")}{" "}
        <ShortcutKeys
          className="ml-1.5 align-middle"
          keys={[{ letter: "C" }]}
        />
      </button>
      <Link
        href={`/settings?from=${props.projectId}`}
        onNavigate={props.onNavigateToSettings}
        data-chrome
        aria-label={t("editor.top-strip.settings")}
        data-room-tour-target="settings"
        className="press pointer-events-auto grid size-7 place-items-center rounded-panel border border-line bg-panel hover:border-line-strong"
      >
        <svg
          viewBox="0 0 16 16"
          className="size-4 fill-none stroke-current"
          aria-hidden="true"
        >
          <path d="M2 4.5h12M2 11.5h12" />
          <rect x="9.5" y="3" width="2.5" height="3" />
          <rect x="4" y="10" width="2.5" height="3" />
        </svg>
      </Link>
      <button
        type="button"
        data-chrome
        aria-label={t("editor.top-strip.keyboard-shortcuts")}
        data-room-tour-target="shortcuts"
        aria-keyshortcuts="?"
        aria-haspopup="dialog"
        onClick={props.onOpenShortcuts}
        className="press pointer-events-auto grid size-7 shrink-0 place-items-center rounded-panel border border-line bg-panel hover:border-line-strong"
      >
        ?
      </button>
    </header>
  );
}
