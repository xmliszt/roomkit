import type { Item } from "@planner/shared/src/scene/item-schema.ts";
import type { Room } from "@planner/shared/src/scene/room-schema.ts";
import { Euler, Vector3 } from "three";
import { getWallSegments } from "../../room/get-wall-segments.ts";
import { getItemRenderLayout } from "./get-item-render-layout.ts";

const minRadiusM = 0.3;
const paddingShare = 1.3;

/** Return a sphere around `item`'s box, padded so framing it keeps some room around it and never comes closer than the camera's minimum distance allows; `undefined` when its wall is gone. */
export function getItemSphere(options: { item: Item; room: Room }) {
  const layout = getItemRenderLayout({
    item: options.item,
    segments: getWallSegments(options.room),
    ceilingHeightM: options.room.ceilingHeightM,
  });
  if (layout === undefined) return undefined;
  const { frame, box } = layout;
  const centre = new Vector3(
    (box.x.min + box.x.max) / 2,
    (box.y.min + box.y.max) / 2,
    (box.z.min + box.z.max) / 2,
  )
    .applyEuler(new Euler(0, frame.yawRad, frame.rollRad, "YXZ"))
    .add(new Vector3(frame.positionM.x, frame.positionM.y, frame.positionM.z));
  const { width, height, depth } = layout.sizeM;
  return {
    centerM: { x: centre.x, y: centre.y, z: centre.z },
    radiusM: Math.max(
      minRadiusM,
      (Math.sqrt(width * width + height * height + depth * depth) / 2) *
        paddingShare,
    ),
  };
}
