import type { Command } from "@planner/shared/src/commands/command-schema.ts";
import type { Item } from "@planner/shared/src/scene/item-schema.ts";
import type { Placement } from "@planner/shared/src/scene/placement-schema.ts";
import type { Room } from "@planner/shared/src/scene/room-schema.ts";
import { getWallSegments } from "../room/get-wall-segments.ts";
import { getItemPlacementBounds } from "./get-item-placement-bounds.ts";
import { isSamePlacement } from "./is-same-placement.ts";

type Range = { min: number; max: number };

function clamp(options: { value: number; ranges: Range[] }) {
  const min = Math.max(...options.ranges.map((range) => range.min));
  const max = Math.min(...options.ranges.map((range) => range.max));
  return min > max ? 0 : Math.max(min, Math.min(max, options.value));
}

function projectRange(options: {
  range: Range;
  origin: number;
  direction: number;
}): Range {
  if (Math.abs(options.direction) < 1e-10)
    return { min: -Infinity, max: Infinity };
  const first = (options.range.min - options.origin) / options.direction;
  const second = (options.range.max - options.origin) / options.direction;
  return { min: Math.min(first, second), max: Math.max(first, second) };
}

export function getGroupPlacementCommands(options: {
  items: Item[];
  selectedIds: readonly string[];
  itemId: string;
  placement: Placement;
  room: Room;
}) {
  const source = options.items.find((item) => item.id === options.itemId);
  if (!source) return [];
  const start = source.placement;
  const next = options.placement;
  const selectedIds = options.selectedIds.includes(source.id)
    ? options.selectedIds
    : [source.id];
  const selected = options.items.filter(
    (item) => selectedIds.includes(item.id) && !item.locked,
  );
  const rotationRad = next.rotationRad - start.rotationRad;
  if (source.locked && rotationRad === 0) return [];
  function update(options: { item: Item; placement: Placement }): Command[] {
    return isSamePlacement({
      first: options.item.placement,
      second: options.placement,
    })
      ? []
      : [
          {
            type: "item.update",
            itemId: options.item.id,
            patch: { placement: options.placement },
          },
        ];
  }
  if (rotationRad !== 0)
    return selected.flatMap((item) =>
      (item.placement.kind === "wall") === (start.kind === "wall")
        ? update({
            item,
            placement: {
              ...item.placement,
              rotationRad: item.placement.rotationRad + rotationRad,
            },
          })
        : [],
    );
  if (
    start.kind === "wall" &&
    next.kind === "wall" &&
    start.wallId !== next.wallId
  ) {
    if (selectedIds.length > 1) return [];
    const bounds = getItemPlacementBounds({
      item: { ...source, placement: next },
      room: options.room,
    });
    return bounds?.kind === "wall"
      ? update({
          item: source,
          placement: {
            ...next,
            alongM: clamp({ value: next.alongM, ranges: [bounds.alongM] }),
            heightM: clamp({ value: next.heightM, ranges: [bounds.heightM] }),
          },
        })
      : [];
  }
  const wall =
    start.kind === "wall"
      ? getWallSegments(options.room).find(
          (segment) => segment.wall.id === start.wallId,
        )
      : undefined;
  const moving = selected.flatMap((item) => {
    const placement = item.placement;
    if (
      placement.kind === "wall" &&
      (start.kind !== "wall" || placement.wallId !== start.wallId)
    )
      return [];
    const bounds = getItemPlacementBounds({ item, room: options.room });
    if (!bounds) return [];
    if (placement.kind === "wall" && bounds.kind === "wall")
      return [
        {
          item,
          first: {
            min: bounds.alongM.min - placement.alongM,
            max: bounds.alongM.max - placement.alongM,
          },
          second: {
            min: bounds.heightM.min - placement.heightM,
            max: bounds.heightM.max - placement.heightM,
          },
        },
      ];
    if (placement.kind !== "wall" && bounds.kind === "horizontal") {
      const x = projectRange({
        range: bounds.xM,
        origin: placement.xM,
        direction: start.kind === "wall" ? (wall?.direction.x ?? 0) : 1,
      });
      const z = projectRange({
        range: bounds.zM,
        origin: placement.zM,
        direction: start.kind === "wall" ? (wall?.direction.z ?? 0) : 1,
      });
      return [
        {
          item,
          first:
            start.kind === "wall"
              ? { min: Math.max(x.min, z.min), max: Math.min(x.max, z.max) }
              : x,
          second: start.kind === "wall" ? { min: -Infinity, max: Infinity } : z,
        },
      ];
    }
    return [];
  });
  const first = clamp({
    value:
      start.kind === "wall" && next.kind === "wall"
        ? next.alongM - start.alongM
        : start.kind !== "wall" && next.kind !== "wall"
          ? next.xM - start.xM
          : 0,
    ranges: moving.map((entry) => entry.first),
  });
  const second = clamp({
    value:
      start.kind === "wall" && next.kind === "wall"
        ? next.heightM - start.heightM
        : start.kind !== "wall" && next.kind !== "wall"
          ? next.zM - start.zM
          : 0,
    ranges: moving.map((entry) => entry.second),
  });
  return moving.flatMap(({ item }) => {
    const placement = item.placement;
    switch (placement.kind) {
      case "wall":
        return update({
          item,
          placement: {
            ...placement,
            alongM: placement.alongM + first,
            heightM: placement.heightM + second,
          },
        });
      case "floor":
      case "ceiling":
        return update({
          item,
          placement: {
            ...placement,
            xM:
              placement.xM +
              first * (start.kind === "wall" ? (wall?.direction.x ?? 0) : 1),
            zM:
              placement.zM +
              (start.kind === "wall"
                ? first * (wall?.direction.z ?? 0)
                : second),
          },
        });
      default: {
        const unreachable: never = placement;
        return unreachable;
      }
    }
  });
}
