import type { Object3D } from "three";

export function isLightEmitterVisible(source: Object3D | undefined) {
  if (!source) return false;
  let visible = source.visible;
  source.traverseAncestors((ancestor) => {
    if (!ancestor.visible) visible = false;
  });
  return visible;
}
