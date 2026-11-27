type Vec2 = { x: number; z: number };

/** `true` if `point` lies inside `polygon` by the even-odd rule; `false` when it lies outside. */
export function isInsidePolygon(options: { point: Vec2; polygon: Vec2[] }) {
  const { point, polygon } = options;
  return polygon.reduce((inside, a, index) => {
    const b = polygon[(index + 1) % polygon.length] ?? a;
    const crosses =
      a.z > point.z !== b.z > point.z &&
      point.x < ((b.x - a.x) * (point.z - a.z)) / (b.z - a.z) + a.x;
    return crosses ? !inside : inside;
  }, false);
}
