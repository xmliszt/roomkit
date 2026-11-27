import type { Item } from "@planner/shared/src/scene/item-schema.ts";
import type { Room } from "@planner/shared/src/scene/room-schema.ts";
import { Sphere, Vector3 } from "three";
import { getItemSphere } from "./get-item-sphere.ts";

export function getSelectionSphere(options: {
  items: Item[];
  selectedIds: readonly string[];
  room: Room;
}) {
  const spheres = options.selectedIds.flatMap((id) => {
    const item = options.items.find((item) => item.id === id);
    const sphere = item && getItemSphere({ item, room: options.room });
    return sphere
      ? [
          new Sphere(
            new Vector3(sphere.centerM.x, sphere.centerM.y, sphere.centerM.z),
            sphere.radiusM,
          ),
        ]
      : [];
  });
  const first = spheres.at(0);
  if (!first) return undefined;
  const sphere = spheres
    .slice(1)
    .reduce((combined, member) => combined.union(member), first.clone());
  return {
    centerM: { x: sphere.center.x, y: sphere.center.y, z: sphere.center.z },
    radiusM: sphere.radius,
  };
}
