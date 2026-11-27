/** `true` if `pointM` lies within `radiusM` of the bulb at `centreM` and no further than `maxAlongM` out along the beam `direction` (a zero vector for no beam); `false` otherwise. */
export function isInShade(options: {
  pointM: { x: number; y: number; z: number };
  centreM: { x: number; y: number; z: number };
  direction: { x: number; y: number; z: number };
  radiusM: number;
  maxAlongM: number;
}) {
  const offset = {
    x: options.pointM.x - options.centreM.x,
    y: options.pointM.y - options.centreM.y,
    z: options.pointM.z - options.centreM.z,
  };
  const along =
    offset.x * options.direction.x +
    offset.y * options.direction.y +
    offset.z * options.direction.z;
  return (
    Math.hypot(offset.x, offset.y, offset.z) <= options.radiusM &&
    along <= options.maxAlongM
  );
}
