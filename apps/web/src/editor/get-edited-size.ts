import type { Size } from "@planner/shared/src/scene/size-schema.ts";

/** Return `sizeM` with `axis` set to `valueM`, and the other two axes scaled by the same ratio when `isProportionLocked`. */
export function getEditedSize(options: {
  sizeM: Size;
  axis: keyof Size;
  valueM: number;
  isProportionLocked: boolean;
}) {
  const { sizeM, axis, valueM } = options;
  if (!options.isProportionLocked) return { ...sizeM, [axis]: valueM };
  const ratio = valueM / sizeM[axis];
  return {
    width: sizeM.width * ratio,
    height: sizeM.height * ratio,
    depth: sizeM.depth * ratio,
    [axis]: valueM,
  };
}
