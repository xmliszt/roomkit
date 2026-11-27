import type { Item } from "@planner/shared/src/scene/item-schema.ts";
import { BufferGeometry, Float32BufferAttribute } from "three";
import { wallThicknessM } from "./wall-thickness-m.ts";

type Point = [number, number, number];
type Vertex = { x: number; y: number; depth?: number };
const epsilon = 1e-8;

export function createWallGeometry(options: {
  wallId: string;
  lengthM: number;
  heightM: number;
  startExtensionM?: number;
  endExtensionM?: number;
  items: Pick<Item, "cutsOpening" | "placement" | "sizeM">[];
}) {
  const { lengthM, heightM } = options;
  const startExtensionM = options.startExtensionM ?? 0;
  const endExtensionM = options.endExtensionM ?? 0;
  const leftM = -lengthM / 2;
  const rightM = lengthM / 2;
  const outerLeftM = leftM - endExtensionM;
  const outerRightM = rightM + startExtensionM;
  const boundsLeftM = Math.min(leftM, outerLeftM);
  const boundsRightM = Math.max(rightM, outerRightM);
  function rectangle(options: { left: number; right: number; depth?: number }) {
    return [
      { x: options.left, y: 0, depth: options.depth ?? 0 },
      { x: options.right, y: 0, depth: options.depth ?? 0 },
      { x: options.right, y: heightM, depth: options.depth ?? 0 },
      { x: options.left, y: heightM, depth: options.depth ?? 0 },
    ];
  }
  const wall = rectangle({ left: leftM, right: rightM });
  const bounds = rectangle({ left: boundsLeftM, right: boundsRightM });
  function side(options: { p: Vertex; a: Vertex; b: Vertex }) {
    const { p, a, b } = options;
    return (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
  }
  function clipPlane(options: {
    polygon: Vertex[];
    distance: (p: Vertex) => number;
  }) {
    return options.polygon.flatMap((p, index) => {
      const q = options.polygon[(index + 1) % options.polygon.length];
      if (!q) return [];
      const dp = options.distance(p);
      const dq = options.distance(q);
      const crossing =
        (dp < -epsilon && dq > epsilon) || (dp > epsilon && dq < -epsilon);
      const intersection = crossing
        ? [
            {
              x: p.x + ((q.x - p.x) * dp) / (dp - dq),
              y: p.y + ((q.y - p.y) * dp) / (dp - dq),
              depth:
                (p.depth ?? 0) +
                (((q.depth ?? 0) - (p.depth ?? 0)) * dp) / (dp - dq),
            },
          ]
        : [];
      return dp >= -epsilon ? [p, ...intersection] : intersection;
    });
  }
  function clip(options: {
    polygon: Vertex[];
    a: Vertex;
    b: Vertex;
    inside: boolean;
  }) {
    return clipPlane({
      polygon: options.polygon,
      distance: (p) =>
        side({ p, a: options.a, b: options.b }) * (options.inside ? 1 : -1),
    });
  }
  function area(polygon: Vertex[]) {
    const first = polygon.at(0);
    if (!first) return 0;
    return polygon.slice(1, -1).reduce((sum, p, index) => {
      const q = polygon[index + 2];
      if (!q) return sum;
      const a = {
        x: p.x - first.x,
        y: p.y - first.y,
        z: (p.depth ?? 0) - (first.depth ?? 0),
      };
      const b = {
        x: q.x - first.x,
        y: q.y - first.y,
        z: (q.depth ?? 0) - (first.depth ?? 0),
      };
      return (
        sum +
        Math.hypot(
          a.y * b.z - a.z * b.y,
          a.z * b.x - a.x * b.z,
          a.x * b.y - a.y * b.x,
        ) /
          2
      );
    }, 0);
  }
  function intersect(options: { polygon: Vertex[]; boundary: Vertex[] }) {
    return options.boundary.reduce((polygon, a, index) => {
      const b = options.boundary[(index + 1) % options.boundary.length];
      return b ? clip({ polygon, a, b, inside: true }) : polygon;
    }, options.polygon);
  }
  function subtract(options: { polygon: Vertex[]; cut: Vertex[] }) {
    return options.cut.reduce<{ remainder: Vertex[]; outside: Vertex[][] }>(
      (state, a, index) => {
        const b = options.cut[(index + 1) % options.cut.length];
        if (!b || area(state.remainder) <= epsilon) return state;
        const piece = clip({ polygon: state.remainder, a, b, inside: false });
        return {
          remainder: clip({ polygon: state.remainder, a, b, inside: true }),
          outside:
            state.remainder.some((p) => side({ p, a, b }) < -epsilon) &&
            area(piece) > epsilon
              ? [...state.outside, piece]
              : state.outside,
        };
      },
      { remainder: options.polygon, outside: [] },
    ).outside;
  }
  const cuts = options.items.flatMap((item) => {
    const placement = item.placement;
    if (
      !item.cutsOpening ||
      placement.kind !== "wall" ||
      placement.wallId !== options.wallId
    )
      return [];
    const cos = Math.cos(placement.rotationRad);
    const sin = Math.sin(placement.rotationRad);
    const corners = [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ].map(([x = 0, y = 0]) => ({
      x:
        lengthM / 2 -
        placement.alongM +
        ((x * item.sizeM.width) / 2) * cos -
        ((y * item.sizeM.height) / 2) * sin,
      y:
        placement.heightM +
        ((x * item.sizeM.width) / 2) * sin +
        ((y * item.sizeM.height) / 2) * cos,
    }));
    const bottomM = Math.min(...corners.map((p) => p.y));
    const floorExtended =
      bottomM > 0 && bottomM <= 0.05 + epsilon
        ? corners.map((p) =>
            Math.abs(p.y - bottomM) < epsilon ? { ...p, y: 0 } : p,
          )
        : corners;
    const polygon = intersect({ polygon: floorExtended, boundary: bounds });
    const visible = intersect({ polygon, boundary: wall });
    return area(polygon) > epsilon
      ? [
          {
            polygon,
            visible,
            left: Math.min(...visible.map((p) => p.x)),
            right: Math.max(...visible.map((p) => p.x)),
          },
        ]
      : [];
  });
  function solids(polygon: Vertex[]) {
    return cuts.reduce(
      (pieces, cut) =>
        pieces.flatMap((piece) =>
          subtract({ polygon: piece, cut: cut.polygon }),
        ),
      [polygon],
    );
  }
  const frontPolygons = solids(wall);
  const boundsPolygons = solids(bounds);
  const positions: number[] = [];
  const uvs: number[] = [];
  const outline: Point[] = [];
  const baseOutline: Point[] = [];
  const topOutline: Point[] = [];
  const startOutline: Point[] = [];
  function point(p: Vertex): Point {
    return [p.x, p.y - heightM / 2, p.depth ?? 0];
  }
  function face(options: {
    polygon: Vertex[];
    uv: (p: Vertex) => [number, number];
  }) {
    const first = options.polygon.at(0);
    if (!first) return;
    for (const [index, b] of options.polygon.slice(1, -1).entries()) {
      const c = options.polygon[index + 2];
      if (!c) continue;
      const triangle = [first, b, c];
      positions.push(...triangle.flatMap(point));
      uvs.push(...triangle.flatMap(options.uv));
    }
  }
  const back = rectangle({
    left: outerLeftM,
    right: outerRightM,
    depth: -wallThicknessM,
  });
  for (const polygon of [
    ...frontPolygons,
    ...solids(back).map((polygon) => polygon.toReversed()),
  ]) {
    face({ polygon, uv: (p) => [lengthM / 2 - p.x, p.y] });
  }
  for (const [index, a] of wall.entries()) {
    const b = wall[(index + 1) % wall.length];
    const outerA = back[index];
    const outerB = back[(index + 1) % wall.length];
    if (!b || !outerA || !outerB) continue;
    for (const polygon of solids([b, a, outerA, outerB])) {
      face({
        polygon,
        uv: (p) => [Math.hypot(p.x - a.x, p.y - a.y), -(p.depth ?? 0)],
      });
    }
  }
  function boundaries(polygons: Vertex[][]) {
    const vertices = polygons.flat();
    const edges: { [key: string]: { a: Vertex; b: Vertex } } = {};
    function key(p: Vertex) {
      return `${Math.round(p.x / epsilon)},${Math.round(p.y / epsilon)}`;
    }
    for (const polygon of polygons) {
      for (const [index, a] of polygon.entries()) {
        const b = polygon[(index + 1) % polygon.length];
        if (!b) continue;
        const dx = b.x - a.x,
          dy = b.y - a.y;
        const lengthSquared = dx * dx + dy * dy;
        if (lengthSquared < epsilon * epsilon) continue;
        const splits = [
          0,
          1,
          ...vertices.flatMap((p) => {
            const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared;
            return t > epsilon &&
              t < 1 - epsilon &&
              Math.abs(side({ p, a, b })) < epsilon
              ? [t]
              : [];
          }),
        ].toSorted((a, b) => a - b);
        for (const [i, from] of splits.slice(0, -1).entries()) {
          const to = splits[i + 1];
          if (to === undefined || to - from < epsilon) continue;
          const p = { x: a.x + dx * from, y: a.y + dy * from },
            q = { x: a.x + dx * to, y: a.y + dy * to };
          const edgeKey = [key(p), key(q)].toSorted().join("/");
          if (edges[edgeKey]) delete edges[edgeKey];
          else edges[edgeKey] = { a: p, b: q };
        }
      }
    }
    return Object.values(edges);
  }
  for (const { a, b } of boundaries(boundsPolygons)) {
    const onBounds =
      (Math.abs(a.x - boundsLeftM) < epsilon &&
        Math.abs(b.x - boundsLeftM) < epsilon) ||
      (Math.abs(a.x - boundsRightM) < epsilon &&
        Math.abs(b.x - boundsRightM) < epsilon) ||
      (Math.abs(a.y) < epsilon && Math.abs(b.y) < epsilon) ||
      (Math.abs(a.y - heightM) < epsilon && Math.abs(b.y - heightM) < epsilon);
    if (onBounds) continue;
    const endClipped = clipPlane({
      polygon: [
        b,
        a,
        { ...a, depth: -wallThicknessM },
        { ...b, depth: -wallThicknessM },
      ],
      distance: (p) =>
        p.x - leftM - (endExtensionM * (p.depth ?? 0)) / wallThicknessM,
    });
    const polygon = clipPlane({
      polygon: endClipped,
      distance: (p) =>
        rightM - (startExtensionM * (p.depth ?? 0)) / wallThicknessM - p.x,
    });
    face({
      polygon,
      uv: (p) => [Math.hypot(p.x - a.x, p.y - a.y), -(p.depth ?? 0)],
    });
  }
  for (const { a, b } of boundaries(frontPolygons)) {
    outline.push(point({ ...a, depth: 0.005 }), point({ ...b, depth: 0.005 }));
    if (Math.abs(a.y - heightM) < epsilon && Math.abs(b.y - heightM) < epsilon)
      topOutline.push(point(a), point(b));
    if (Math.abs(a.x - rightM) < epsilon && Math.abs(b.x - rightM) < epsilon)
      startOutline.push(point(a), point(b));
  }
  const visibleCuts = cuts.filter((cut) => area(cut.visible) > epsilon);
  const xs = [
    ...new Set([
      leftM,
      rightM,
      ...visibleCuts.flatMap((cut) => [cut.left, cut.right]),
    ]),
  ].toSorted((a, b) => b - a);
  for (const [index, right] of xs.entries()) {
    const left = xs[index + 1];
    if (
      left !== undefined &&
      !visibleCuts.some((cut) => left < cut.right && right > cut.left)
    )
      baseOutline.push(
        point({ x: right, y: 0.005 }),
        point({ x: left, y: 0.005 }),
      );
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();
  return { geometry, outline, baseOutline, topOutline, startOutline };
}
