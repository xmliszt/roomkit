import type { ColorAdjust } from "@planner/shared/src/scene/color-adjust-schema.ts";

function normalize(colorAdjust: ColorAdjust | null | undefined) {
  if (colorAdjust === null || colorAdjust === undefined) return undefined;
  return colorAdjust.kind === "colorize"
    ? { ...colorAdjust, color: colorAdjust.color.toLowerCase() }
    : colorAdjust;
}

/** `true` if `shown` is the same adjustment as `stored`, treating `null` as no adjustment and hex case as equal; `false` otherwise. */
export function isStoredColorAdjust(options: {
  shown: ColorAdjust | null;
  stored: ColorAdjust | undefined;
}) {
  return (
    JSON.stringify(normalize(options.shown)) ===
    JSON.stringify(normalize(options.stored))
  );
}
