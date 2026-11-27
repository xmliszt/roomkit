import { useEffect, useRef } from "react";
import { useMessages } from "../i18n/use-messages.ts";
import { Modal } from "../ui/modal.tsx";
import { ShortcutKeys } from "./shortcut-keys.tsx";

type ShortcutSheetProps = { walking: boolean; onClose: () => void };
type Binding = {
  label: string;
  keys: readonly (
    | Parameters<typeof ShortcutKeys>[0]["keys"][number]
    | { description: string }
  )[];
};

const orbitBindings: Binding[] = [
  { label: "editor.shortcut-sheet.enter-walk-mode", keys: [{ letter: "W" }] },
  {
    label: "editor.shortcut-sheet.orbit",
    keys: [{ description: "editor.shortcut-sheet.left-drag-empty-space" }],
  },
  {
    label: "editor.shortcut-sheet.pan",
    keys: [
      {
        description:
          "editor.shortcut-sheet.space-left-drag-right-drag-middle-drag",
      },
    ],
  },
  {
    label: "editor.shortcut-sheet.object-menu",
    keys: [
      {
        description:
          "editor.shortcut-sheet.right-click-shift-f10-context-menu-key",
      },
    ],
  },
  {
    label: "editor.shortcut-sheet.zoom-toward-pointer",
    keys: [{ description: "editor.shortcut-sheet.wheel-pinch" }],
  },
  {
    label: "editor.shortcut-sheet.zoom-in-out",
    keys: ["command", { letter: "+ / −" }],
  },
  {
    label: "editor.shortcut-sheet.reset-room-view",
    keys: ["shift", { letter: "0" }],
  },
  {
    label: "editor.shortcut-sheet.reset-room-view",
    keys: ["command", { letter: "0" }],
  },
  {
    label: "editor.shortcut-sheet.frame-room",
    keys: ["shift", { letter: "1" }, { letter: "/ F" }],
  },
  {
    label: "editor.shortcut-sheet.frame-selection-room-if-none",
    keys: ["shift", { letter: "2" }],
  },
  {
    label: "editor.shortcut-sheet.fly-forward-left-back-right",
    keys: [{ description: "editor.shortcut-sheet.hold-right-mouse-w-a-s-d" }],
  },
  {
    label: "editor.shortcut-sheet.fly-down-up",
    keys: [{ description: "editor.shortcut-sheet.hold-right-mouse-q-e" }],
  },
  {
    label: "editor.shortcut-sheet.fly-faster",
    keys: ["shift", { description: "editor.shortcut-sheet.while-flying" }],
  },
  {
    label: "editor.shortcut-sheet.pan-selection-nudge-0-05-m",
    keys: [{ description: "editor.shortcut-sheet.arrow-keys" }],
  },
  {
    label: "editor.shortcut-sheet.pan-further-selection-nudge-0-5-m",
    keys: ["shift", { description: "editor.shortcut-sheet.arrow-keys" }],
  },
  {
    label: "editor.shortcut-sheet.orbit-by-15",
    keys: ["option", { description: "editor.shortcut-sheet.arrow-keys" }],
  },
  {
    label: "editor.shortcut-sheet.select-rotate-tool",
    keys: [{ letter: "V / R" }],
  },
  {
    label: "editor.shortcut-sheet.toggle-labels-grid-snapping",
    keys: [{ letter: "L / G / S" }],
  },
  {
    label: "editor.shortcut-sheet.invert-snapping-while-dragging",
    keys: ["option"],
  },
  {
    label: "editor.shortcut-sheet.select-room-surface",
    keys: [{ description: "editor.shortcut-sheet.double-click-surface" }],
  },
  {
    label: "editor.shortcut-sheet.add-remove-object",
    keys: [{ letter: "⇧ / ⌘" }, { description: "editor.shortcut-sheet.click" }],
  },
  {
    label: "editor.shortcut-sheet.select-all-objects",
    keys: ["command", { letter: "A" }],
  },
  {
    label: "editor.shortcut-sheet.duplicate-selection",
    keys: ["command", { letter: "D" }],
  },
  { label: "editor.shortcut-sheet.delete-selection", keys: ["delete"] },
  { label: "editor.shortcut-sheet.undo", keys: ["command", { letter: "Z" }] },
  {
    label: "editor.shortcut-sheet.redo",
    keys: ["command", "shift", { letter: "Z" }],
  },
  {
    label: "editor.shortcut-sheet.save-png-snapshot",
    keys: ["command", "shift", { letter: "S" }],
  },
  {
    label: "editor.shortcut-sheet.commands",
    keys: ["command", { letter: "K" }],
  },
  { label: "editor.shortcut-sheet.focus-prompt", keys: [{ letter: "/" }] },
  { label: "editor.shortcut-sheet.open-objects", keys: [{ letter: "O" }] },
  {
    label: "editor.shortcut-sheet.open-or-close-chat",
    keys: [{ letter: "C" }],
  },
  {
    label: "editor.shortcut-sheet.voice-input-stop-with-esc",
    keys: [{ letter: "M" }],
  },
  {
    label: "editor.shortcut-sheet.hide-show-controls",
    keys: [{ letter: "\\" }],
  },
  {
    label: "editor.shortcut-sheet.cancel-nudge-clear-selection-close-panel",
    keys: [{ letter: "Esc" }],
  },
  {
    label: "editor.shortcut-sheet.open-close-shortcuts",
    keys: [{ letter: "?" }],
  },
];

const walkBindings: Binding[] = [
  {
    label: "editor.shortcut-sheet.move-forward-left-back-right",
    keys: [{ description: "editor.shortcut-sheet.w-a-s-d-arrow-keys" }],
  },
  {
    label: "editor.shortcut-sheet.lower-raise-eye-0-9-1-9-m",
    keys: [{ letter: "Q / E" }],
  },
  {
    label: "editor.shortcut-sheet.look-around",
    keys: [{ description: "editor.shortcut-sheet.drag-one-finger" }],
  },
  {
    label: "editor.shortcut-sheet.move-on-touch",
    keys: [{ description: "editor.shortcut-sheet.two-fingers" }],
  },
  {
    label: "editor.shortcut-sheet.return-to-orbit-view",
    keys: [{ description: "editor.shortcut-sheet.esc-walk-button" }],
  },
  {
    label: "editor.shortcut-sheet.save-png-snapshot",
    keys: ["command", "shift", { letter: "S" }],
  },
  { label: "editor.shortcut-sheet.focus-prompt", keys: [{ letter: "/" }] },
  { label: "editor.shortcut-sheet.open-objects", keys: [{ letter: "O" }] },
  {
    label: "editor.shortcut-sheet.open-or-close-chat",
    keys: [{ letter: "C" }],
  },
  {
    label: "editor.shortcut-sheet.voice-input-stop-with-esc",
    keys: [{ letter: "M" }],
  },
  {
    label: "editor.shortcut-sheet.hide-show-controls",
    keys: [{ letter: "\\" }],
  },
  {
    label: "editor.shortcut-sheet.open-close-shortcuts",
    keys: [{ letter: "?" }],
  },
];

export function ShortcutSheet(props: ShortcutSheetProps) {
  const t = useMessages();
  const bindings = props.walking ? walkBindings : orbitBindings;
  const onCloseRef = useRef(props.onClose);
  useEffect(() => {
    onCloseRef.current = props.onClose;
  }, [props.onClose]);
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "?") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!event.repeat) onCloseRef.current();
    }
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, []);
  return (
    <Modal
      title={t("editor.shortcut-sheet.keyboard-shortcuts")}
      onClose={props.onClose}
      wide
    >
      <dl className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-baseline gap-x-6 gap-y-1 p-3">
        {bindings.map((binding) => (
          <div
            key={`${binding.label}-${JSON.stringify(binding.keys)}`}
            className="contents"
          >
            <dt>{t(binding.label)}</dt>
            <dd>
              <ShortcutKeys
                keys={binding.keys.map((key) =>
                  typeof key === "object" && "description" in key
                    ? { letter: t(key.description) }
                    : key,
                )}
                className="flex-wrap gap-x-1"
              />
            </dd>
          </div>
        ))}
      </dl>
    </Modal>
  );
}
