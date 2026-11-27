export function containsFloatingTarget(options: {
  root: HTMLElement | null;
  target: EventTarget | null;
}) {
  if (!(options.target instanceof Node)) return false;
  if (options.root?.contains(options.target)) return true;
  const owner =
    options.target instanceof Element
      ? options.target.closest<HTMLElement>("[data-floating-owner]")?.dataset
          .floatingOwner
      : undefined;
  return (
    owner !== undefined &&
    Array.from(
      options.root?.querySelectorAll<HTMLElement>("[data-floating-source]") ??
        [],
    ).some((source) => source.dataset.floatingSource === owner)
  );
}
