import type { Room } from "@planner/shared/src/scene/room-schema.ts";
import { formatDecimal } from "../i18n/format-decimal.ts";
import { getRoomBounds } from "./get-room-bounds.ts";

export function formatRoomSize(options: { room: Room; locale?: string }) {
  const { room, locale } = options;
  const bounds = getRoomBounds(room);
  const widthM = bounds.maxX - bounds.minX;
  const depthM = bounds.maxZ - bounds.minZ;
  return `${formatDecimal({ value: widthM, locale })} × ${formatDecimal({ value: depthM, locale })} × ${formatDecimal({ value: room.ceilingHeightM, locale })} m`;
}
