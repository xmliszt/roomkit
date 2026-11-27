import type { Size } from "@planner/shared/src/scene/size-schema.ts";

const axes = ["width", "height", "depth"] satisfies (keyof Size)[];

/** Return `{sizeM: displayedM, isDisplayedSize: true}` when `modelM`, scaled so its largest side equals the largest side of `displayedM`, is within 20% or 5 mm of it on every axis; otherwise return that scaled `modelM` with `isDisplayedSize: false`. */
export function getPublishedSize(options: { displayedM: Size; modelM: Size }) {
  const scale =
    Math.max(...axes.map((axis) => options.displayedM[axis])) /
    Math.max(...axes.map((axis) => options.modelM[axis]));
  const fitted = {
    width: options.modelM.width * scale,
    height: options.modelM.height * scale,
    depth: options.modelM.depth * scale,
  };
  const isClose = axes.every(
    (axis) =>
      Math.abs(fitted[axis] / options.displayedM[axis] - 1) <= 0.200001 ||
      Math.abs(fitted[axis] - options.displayedM[axis]) <= 0.005000001,
  );
  return isClose
    ? { sizeM: options.displayedM, isDisplayedSize: true }
    : { sizeM: fitted, isDisplayedSize: false };
}
