import type { FrameTarget } from "./frame-target.ts";
import type { Tool } from "./tool.ts";

type ShortcutAction =
  | { kind: "enter-walk" }
  | { kind: "exit-walk" }
  | { kind: "toggle-chrome" }
  | { kind: "focus-prompt" }
  | { kind: "toggle-labels" }
  | { kind: "toggle-snap" }
  | { kind: "toggle-grid" }
  | { kind: "frame"; target: FrameTarget }
  | { kind: "shortcuts" }
  | { kind: "objects" }
  | { kind: "toggle-chat" }
  | { kind: "start-voice" }
  | { kind: "set-tool"; tool: Tool }
  | { kind: "clear-selection" }
  | { kind: "select-all" }
  | { kind: "delete" }
  | { kind: "duplicate" }
  | { kind: "snapshot" }
  | { kind: "undo" }
  | { kind: "redo" };

const toolKeys: { [key: string]: Tool } = {
  v: "select",
  r: "rotate",
};

/** Return the editor action bound to `key` and the held modifiers, or `undefined` when the combination is unbound or typed into a field. */
export function getShortcutAction(options: {
  key: string;
  code: string;
  isTyping: boolean;
  isWalking: boolean;
  isCommandHeld: boolean;
  isShiftHeld: boolean;
  isAltHeld: boolean;
}): ShortcutAction | undefined {
  if (options.isTyping) {
    return undefined;
  }
  const key = options.key.toLowerCase();
  if (options.isWalking) {
    if (options.key === "Escape") return { kind: "exit-walk" };
    if (["w", "a", "s", "d", "q", "e"].includes(key) && !options.isCommandHeld)
      return undefined;
    if (
      key === "f" ||
      key === "0" ||
      (options.isShiftHeld &&
        ["Digit0", "Digit1", "Digit2"].includes(options.code))
    )
      return undefined;
  }
  if (options.isCommandHeld) {
    if (options.isAltHeld) {
      return undefined;
    }
    if (key === "a" && !options.isShiftHeld) return { kind: "select-all" };
    if (key === "0") return { kind: "frame", target: "room" };
    if (key === "z") {
      return options.isShiftHeld ? { kind: "redo" } : { kind: "undo" };
    }
    if (key === "s" && options.isShiftHeld) {
      return { kind: "snapshot" };
    }
    if (key === "d" && !options.isShiftHeld) {
      return { kind: "duplicate" };
    }
    return undefined;
  }
  if (options.isAltHeld) {
    return undefined;
  }
  if (options.key === "?") return { kind: "shortcuts" };
  if (options.isShiftHeld) {
    if (options.code === "Digit0") return { kind: "frame", target: "room" };
    if (options.code === "Digit1") return { kind: "frame", target: "room" };
    if (options.code === "Digit2")
      return { kind: "frame", target: "selection" };
  }
  if (options.key === "Escape") {
    return { kind: "clear-selection" };
  }
  if (options.key === "Backspace" || options.key === "Delete") {
    return { kind: "delete" };
  }
  if (options.key === "\\") {
    return { kind: "toggle-chrome" };
  }
  if (options.key === "/") {
    return { kind: "focus-prompt" };
  }
  if (key === "w") return { kind: "enter-walk" };
  if (key === "l") {
    return { kind: "toggle-labels" };
  }
  if (key === "s") {
    return { kind: "toggle-snap" };
  }
  if (key === "g") {
    return { kind: "toggle-grid" };
  }
  if (key === "f") {
    return { kind: "frame", target: "room" };
  }
  if (key === "o") return { kind: "objects" };
  if (key === "c") return { kind: "toggle-chat" };
  if (key === "m") return { kind: "start-voice" };
  const tool = toolKeys[key];
  return tool === undefined ? undefined : { kind: "set-tool", tool };
}
