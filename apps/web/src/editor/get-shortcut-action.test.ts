import { describe, expect, it } from "vitest";
import { getShortcutAction } from "./get-shortcut-action.ts";

function press(options: {
  key: string;
  code?: string;
  isTyping?: boolean;
  isWalking?: boolean;
  isCommandHeld?: boolean;
  isShiftHeld?: boolean;
  isAltHeld?: boolean;
}) {
  return getShortcutAction({
    key: options.key,
    code: options.code ?? "",
    isTyping: options.isTyping ?? false,
    isWalking: options.isWalking ?? false,
    isCommandHeld: options.isCommandHeld ?? false,
    isShiftHeld: options.isShiftHeld ?? false,
    isAltHeld: options.isAltHeld ?? false,
  });
}

describe("getShortcutAction", () => {
  it("maps the editor keys", () => {
    expect(press({ key: "\\" })).toEqual({ kind: "toggle-chrome" });
    expect(press({ key: "/" })).toEqual({ kind: "focus-prompt" });
    expect(press({ key: "v" })).toEqual({ kind: "set-tool", tool: "select" });
    expect(press({ key: "G" })).toEqual({ kind: "toggle-grid" });
    expect(press({ key: "g" })).toEqual({ kind: "toggle-grid" });
    expect(press({ key: "r" })).toEqual({ kind: "set-tool", tool: "rotate" });
    expect(press({ key: "l" })).toEqual({ kind: "toggle-labels" });
    expect(press({ key: "L" })).toEqual({ kind: "toggle-labels" });
    expect(press({ key: "s" })).toEqual({ kind: "toggle-snap" });
    expect(press({ key: "S" })).toEqual({ kind: "toggle-snap" });
    expect(press({ key: "F" })).toEqual({ kind: "frame", target: "room" });
    expect(press({ key: "o" })).toEqual({ kind: "objects" });
    expect(press({ key: "O" })).toEqual({ kind: "objects" });
    expect(press({ key: "o", isCommandHeld: true })).toBeUndefined();
    expect(press({ key: "c" })).toEqual({ kind: "toggle-chat" });
    expect(press({ key: "m" })).toEqual({ kind: "start-voice" });
    expect(press({ key: "M" })).toEqual({ kind: "start-voice" });
    expect(press({ key: "m", isTyping: true })).toBeUndefined();
    expect(press({ key: "m", isCommandHeld: true })).toBeUndefined();
    expect(press({ key: "C" })).toEqual({ kind: "toggle-chat" });
    expect(press({ key: "c", isCommandHeld: true })).toBeUndefined();
    expect(press({ key: "Escape" })).toEqual({ kind: "clear-selection" });
    expect(press({ key: "Backspace" })).toEqual({ kind: "delete" });
    expect(press({ key: "Delete" })).toEqual({ kind: "delete" });
  });

  it("maps the command keys", () => {
    expect(press({ key: "a", isCommandHeld: true })).toEqual({
      kind: "select-all",
    });
    expect(
      press({ key: "a", isCommandHeld: true, isTyping: true }),
    ).toBeUndefined();
    expect(press({ key: "d", isCommandHeld: true })).toEqual({
      kind: "duplicate",
    });
    expect(press({ key: "z", isCommandHeld: true })).toEqual({ kind: "undo" });
    expect(press({ key: "Z", isCommandHeld: true, isShiftHeld: true })).toEqual(
      { kind: "redo" },
    );
    expect(press({ key: "S", isCommandHeld: true, isShiftHeld: true })).toEqual(
      { kind: "snapshot" },
    );
    expect(press({ key: "s", isCommandHeld: true })).toBeUndefined();
  });

  it("ignores keys typed into a field or held with another modifier", () => {
    expect(press({ key: "l", isTyping: true })).toBeUndefined();
    expect(press({ key: "l", isCommandHeld: true })).toBeUndefined();
    expect(press({ key: "l", isAltHeld: true })).toBeUndefined();
    expect(press({ key: "g", isTyping: true })).toBeUndefined();
    expect(press({ key: "g", isCommandHeld: true })).toBeUndefined();
    expect(press({ key: "g", isAltHeld: true })).toBeUndefined();
    expect(press({ key: "s", isTyping: true })).toBeUndefined();
    expect(press({ key: "s", isAltHeld: true })).toBeUndefined();
    expect(press({ key: "v", isTyping: true })).toBeUndefined();
    expect(
      press({ key: "z", isTyping: true, isCommandHeld: true }),
    ).toBeUndefined();
    expect(press({ key: "Backspace", isTyping: true })).toBeUndefined();
    expect(press({ key: "r", isCommandHeld: true })).toBeUndefined();
    expect(press({ key: "r", isAltHeld: true })).toBeUndefined();
    expect(
      press({ key: "z", isCommandHeld: true, isAltHeld: true }),
    ).toBeUndefined();
  });

  it("frames the room, selection and default view with shifted digits", () => {
    expect(press({ key: "1", code: "Digit1", isShiftHeld: true })).toEqual({
      kind: "frame",
      target: "room",
    });
    expect(press({ key: "!", code: "Digit1", isShiftHeld: true })).toEqual({
      kind: "frame",
      target: "room",
    });
    expect(press({ key: "2", code: "Digit2", isShiftHeld: true })).toEqual({
      kind: "frame",
      target: "selection",
    });
    expect(press({ key: "@", code: "Digit2", isShiftHeld: true })).toEqual({
      kind: "frame",
      target: "selection",
    });
    expect(press({ key: ")", code: "Digit0", isShiftHeld: true })).toEqual({
      kind: "frame",
      target: "room",
    });
    expect(press({ key: "0", isCommandHeld: true })).toEqual({
      kind: "frame",
      target: "room",
    });
    expect(press({ key: "é", code: "Digit2", isShiftHeld: true })).toEqual({
      kind: "frame",
      target: "selection",
    });
    expect(
      press({ key: "@", code: "KeyQ", isShiftHeld: true }),
    ).toBeUndefined();
    expect(press({ key: "?" })).toEqual({ kind: "shortcuts" });
  });

  it("reserves movement keys and orbit bindings while walking", () => {
    expect(press({ key: "w" })).toEqual({ kind: "enter-walk" });
    for (const key of ["w", "a", "s", "d", "q", "e", "f"])
      expect(press({ key, isWalking: true })).toBeUndefined();
    for (const code of ["Digit0", "Digit1", "Digit2"])
      expect(
        press({ key: "!", code, isShiftHeld: true, isWalking: true }),
      ).toBeUndefined();
    expect(press({ key: "Escape", isWalking: true })).toEqual({
      kind: "exit-walk",
    });
    expect(press({ key: "w", isTyping: true })).toBeUndefined();
    expect(
      press({ key: "Escape", isWalking: true, isTyping: true }),
    ).toBeUndefined();
    expect(
      press({
        key: "S",
        isCommandHeld: true,
        isShiftHeld: true,
        isWalking: true,
      }),
    ).toEqual({ kind: "snapshot" });
  });

  it("keeps Delete and tool keys on the selection while walking", () => {
    expect(press({ key: "Delete", isWalking: true })).toEqual({
      kind: "delete",
    });
    expect(press({ key: "Backspace", isWalking: true })).toEqual({
      kind: "delete",
    });
    expect(press({ key: "v", isWalking: true })).toEqual({
      kind: "set-tool",
      tool: "select",
    });
    expect(press({ key: "r", isWalking: true })).toEqual({
      kind: "set-tool",
      tool: "rotate",
    });
  });

  it("ignores unbound keys", () => {
    expect(press({ key: "x" })).toBeUndefined();
    expect(press({ key: "b" })).toBeUndefined();
    expect(press({ key: "B" })).toBeUndefined();
  });
});
