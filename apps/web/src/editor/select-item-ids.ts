import type { ItemSelection } from "./item-selection.ts";

export function selectItemIds(options: {
  current: readonly string[];
  selection: ItemSelection;
}) {
  const { selection } = options;
  switch (selection.kind) {
    case "replace":
      return [selection.itemId];
    case "toggle":
      return options.current.includes(selection.itemId)
        ? options.current.filter((id) => id !== selection.itemId)
        : [...options.current, selection.itemId];
    case "keep-set":
      return options.current.includes(selection.itemId)
        ? [
            ...options.current.filter((id) => id !== selection.itemId),
            selection.itemId,
          ]
        : [selection.itemId];
    default: {
      const unreachable: never = selection;
      return unreachable;
    }
  }
}
