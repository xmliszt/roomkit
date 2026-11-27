import type { Item } from "@planner/shared/src/scene/item-schema.ts";

export function getLightState(items: readonly Item[]) {
  const lights = items.flatMap((item) => (item.light ? [item.light] : []));
  if (lights.length === 0) return undefined;
  const onCount = lights.filter((light) => light.on).length;
  return { onCount, total: lights.length };
}
