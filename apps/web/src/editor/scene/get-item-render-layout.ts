import type { Item } from "@planner/shared/src/scene/item-schema.ts";
import { getItemBox } from "../../items/get-item-box.ts";
import { getItemFrame } from "../../items/get-item-frame.ts";
import type { WallSegment } from "../../room/wall-segment.ts";
import { floorCoveringLiftM } from "./floor-covering-lift-m.ts";
import { isFloorCovering } from "./is-floor-covering.ts";
import { wallThicknessM } from "./wall-thickness-m.ts";

/** Return the rendered frame and box in metres, clamping wall openings and lifting floor coverings by `floorCoveringLiftM` without changing the stored item. */
export function getItemRenderLayout(options: {
  item: Item;
  segments: WallSegment[];
  ceilingHeightM: number;
}) {
  const frame = getItemFrame({
    placement: options.item.placement,
    segments: options.segments,
    ceilingHeightM: options.ceilingHeightM,
  });
  if (!frame) return undefined;
  const isOpening =
    options.item.cutsOpening === true && options.item.placement.kind === "wall";
  const sizeM = isOpening
    ? {
        ...options.item.sizeM,
        depth: Math.min(options.item.sizeM.depth, wallThicknessM),
      }
    : options.item.sizeM;
  const backOffsetM = isOpening ? -(wallThicknessM + sizeM.depth) / 2 : 0;
  return {
    sizeM,
    frame: {
      ...frame,
      positionM: {
        x: frame.positionM.x + Math.sin(frame.yawRad) * backOffsetM,
        y:
          frame.positionM.y +
          (isFloorCovering({
            placementKind: options.item.placement.kind,
            sizeM: options.item.sizeM,
          })
            ? floorCoveringLiftM
            : 0),
        z: frame.positionM.z + Math.cos(frame.yawRad) * backOffsetM,
      },
    },
    box: getItemBox({ placementKind: options.item.placement.kind, sizeM }),
  };
}
