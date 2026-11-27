type Point = { x: number; y: number; z: number };

export function getIsoGeometry() {
  function project(point: Point) {
    return {
      x: (point.x - point.y) * Math.cos(Math.PI / 6) + 90,
      y: (point.x + point.y) * 0.5 - point.z + 90,
    };
  }
  function path(points: Point[]) {
    return `${points.map((point, index) => `${index === 0 ? "M" : "L"}${project(point).x} ${project(point).y}`).join(" ")} Z`;
  }
  function line(points: Point[]) {
    return points
      .map(
        (point, index) =>
          `${index === 0 ? "M" : "L"}${project(point).x} ${project(point).y}`,
      )
      .join(" ");
  }
  function box(
    input: Point & { width: number; depth: number; height: number },
  ) {
    const { x, y, z, width: w, depth: d, height: h } = input;
    return [
      path([
        { x, y, z: z + h },
        { x: x + w, y, z: z + h },
        { x: x + w, y: y + d, z: z + h },
        { x, y: y + d, z: z + h },
      ]),
      path([
        { x, y: y + d, z: z + h },
        { x: x + w, y: y + d, z: z + h },
        { x: x + w, y: y + d, z },
        { x, y: y + d, z },
      ]),
      path([
        { x: x + w, y: y + d, z: z + h },
        { x: x + w, y, z: z + h },
        { x: x + w, y, z },
        { x: x + w, y: y + d, z },
      ]),
    ];
  }
  function front(point: Point) {
    const origin = project(point);
    return `matrix(${Math.cos(Math.PI / 6)} 0.5 0 1 ${origin.x} ${origin.y})`;
  }
  return { box, front, line, project };
}
