import { isTypingTarget } from "./is-typing-target.ts";

export function isViewportKeyTarget(target: EventTarget | null) {
  return (
    !isTypingTarget(target) &&
    !(
      target instanceof Element &&
      target.closest(
        'dialog, [role="dialog"], [role="menu"], [role="listbox"], [role="tablist"], [data-editor-popover]',
      )
    )
  );
}
