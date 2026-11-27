export function isEditorZoomEvent(event: KeyboardEvent) {
  return (
    (event.metaKey || event.ctrlKey) &&
    !event.altKey &&
    ["+", "=", "-", "0"].includes(event.key) &&
    !(
      event.target instanceof Element && event.target.closest("input, textarea")
    )
  );
}
