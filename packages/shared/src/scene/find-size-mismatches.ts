import type { Size } from "./size-schema.ts";

/** Return each axis of `actual`, other than the largest axis of `expected`, that differs from `expected` by more than 20% and more than 5 mm. */
export function findSizeMismatches(options: { expected: Size; actual: Size }) {
  const largest = (["width", "height", "depth"] satisfies (keyof Size)[])
    .toSorted((a, b) => options.expected[b] - options.expected[a])
    .at(0);
  return (["width", "height", "depth"] satisfies (keyof Size)[])
    .filter(
      (axis) =>
        axis !== largest &&
        Math.abs(options.actual[axis] / options.expected[axis] - 1) >
          0.200001 &&
        Math.abs(options.actual[axis] - options.expected[axis]) > 0.005000001,
    )
    .map((axis) => ({
      axis,
      actualM: options.actual[axis],
      expectedM: options.expected[axis],
    }));
}
