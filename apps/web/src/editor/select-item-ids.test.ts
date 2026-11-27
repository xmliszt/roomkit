import { expect, test } from "vitest";
import { selectItemIds } from "./select-item-ids.ts";

test("a plain selection replaces the set and a modifier toggles membership in click order", () => {
  const first = selectItemIds({
    current: [],
    selection: { itemId: "a", kind: "replace" },
  });
  const second = selectItemIds({
    current: first,
    selection: { itemId: "b", kind: "toggle" },
  });
  const third = selectItemIds({
    current: second,
    selection: { itemId: "c", kind: "toggle" },
  });
  expect(third).toEqual(["a", "b", "c"]);
  expect(third.at(-1)).toBe("c");
  expect(
    selectItemIds({
      current: third,
      selection: { itemId: "b", kind: "toggle" },
    }),
  ).toEqual(["a", "c"]);
  expect(
    selectItemIds({
      current: third,
      selection: { itemId: "c", kind: "toggle" },
    }).at(-1),
  ).toBe("b");
  expect(
    selectItemIds({
      current: first,
      selection: { itemId: "a", kind: "toggle" },
    }),
  ).toEqual([]);
  expect(
    selectItemIds({
      current: third,
      selection: { itemId: "a", kind: "replace" },
    }),
  ).toEqual(["a"]);
  expect(first).toEqual(["a"]);
});

test("keep-set makes a member primary and replaces the set for an unselected item", () => {
  expect(
    selectItemIds({
      current: ["a", "b"],
      selection: { kind: "keep-set", itemId: "a" },
    }),
  ).toEqual(["b", "a"]);
  expect(
    selectItemIds({
      current: ["a", "b"],
      selection: { kind: "keep-set", itemId: "c" },
    }),
  ).toEqual(["c"]);
});
