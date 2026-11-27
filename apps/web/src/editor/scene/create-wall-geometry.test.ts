import type { Item } from "@planner/shared/src/scene/item-schema.ts";
import { Mesh, MeshBasicMaterial, Raycaster, Vector3 } from "three";
import { expect, test } from "vitest";
import { getWallSegments } from "../../room/get-wall-segments.ts";
import { createWallGeometry } from "./create-wall-geometry.ts";
import { getWallEndExtensions } from "./get-wall-end-extensions.ts";
import { getWallSurfaceTransform } from "./get-wall-surface-transform.ts";
import { wallThicknessM } from "./wall-thickness-m.ts";

function opening(
  options: {
    alongM?: number;
    heightM?: number;
    width?: number;
    height?: number;
    name?: string;
  } = {},
): Item {
  return {
    id: crypto.randomUUID(),
    name: options.name ?? "Door",
    locked: false,
    cutsOpening: true,
    model: { kind: "asset", assetId: "frame" },
    placement: {
      kind: "wall",
      wallId: "wall",
      alongM: options.alongM ?? 2,
      heightM: options.heightM ?? 1,
      rotationRad: 0,
    },
    sizeM: {
      width: options.width ?? 2,
      height: options.height ?? 2,
      depth: 0.85,
    },
  };
}
function wall(items: Item[]) {
  return createWallGeometry({ wallId: "wall", lengthM: 4, heightM: 3, items });
}
function hits(options: {
  mesh: Mesh;
  from: [number, number, number];
  direction: [number, number, number];
}) {
  return new Raycaster(
    new Vector3(...options.from),
    new Vector3(...options.direction),
  ).intersectObject(options.mesh).length;
}
function frontArea(geometry: ReturnType<typeof wall>["geometry"]) {
  const p = geometry.getAttribute("position");
  const n = geometry.getAttribute("normal");
  return Array.from({ length: p.count / 3 }, (_, i) => {
    const index = i * 3;
    if (n.getZ(index) < 0.9) return 0;
    const a = new Vector3().fromBufferAttribute(p, index);
    const b = new Vector3().fromBufferAttribute(p, index + 1);
    const c = new Vector3().fromBufferAttribute(p, index + 2);
    return b.sub(a).cross(c.sub(a)).length() / 2;
  }).reduce((sum, value) => sum + value, 0);
}

test("door cuts both faces and retains full-thickness reveals with metre UVs", () => {
  const result = wall([opening()]);
  const mesh = new Mesh(result.geometry, new MeshBasicMaterial());
  expect(hits({ mesh, from: [0, 0, 1], direction: [0, 0, -1] })).toBe(0);
  expect(hits({ mesh, from: [0, 0, -1], direction: [0, 0, 1] })).toBe(0);
  expect(
    hits({ mesh, from: [1.5, 0, 1], direction: [0, 0, -1] }),
  ).toBeGreaterThan(0);
  expect(
    hits({ mesh, from: [1.5, 0, -1], direction: [0, 0, 1] }),
  ).toBeGreaterThan(0);
  expect(
    hits({ mesh, from: [0, 0, -0.06], direction: [1, 0, 0] }),
  ).toBeGreaterThan(0);
  expect(frontArea(result.geometry)).toBeCloseTo(8);
  const positions = result.geometry.getAttribute("position");
  const normals = result.geometry.getAttribute("normal");
  const uv = result.geometry.getAttribute("uv");
  for (let index = 0; index < positions.count; index++) {
    expect(positions.getZ(index)).toBeGreaterThanOrEqual(-0.120001);
    expect(positions.getZ(index)).toBeLessThanOrEqual(0);
    if (Math.abs(normals.getZ(index)) > 0.9) {
      expect(uv.getX(index)).toBeCloseTo(2 - positions.getX(index));
      expect(uv.getY(index)).toBeCloseTo(positions.getY(index) + 1.5);
    }
  }
});

test("overlapping openings form a union without a reveal inside the overlap", () => {
  const result = wall([opening({ alongM: 1.5 }), opening({ alongM: 2.5 })]);
  expect(frontArea(result.geometry)).toBeCloseTo(6);
  const mesh = new Mesh(result.geometry, new MeshBasicMaterial());
  expect(hits({ mesh, from: [0, 0, 1], direction: [0, 0, -1] })).toBe(0);
  const ray = new Raycaster(
    new Vector3(0, 0, -0.06),
    new Vector3(1, 0, 0),
    0,
    1.4,
  );
  expect(ray.intersectObject(mesh)).toHaveLength(0);
});

test("clips floor, ceiling and corner cuts and handles a completely removed wall", () => {
  const clipped = wall([
    opening({ alongM: 0, heightM: 0, width: 2, height: 2 }),
  ]);
  expect(frontArea(clipped.geometry)).toBeCloseTo(11);
  expect(clipped.startOutline.every((point) => point[1] >= -0.5)).toBe(true);
  const full = wall([opening({ width: 20, height: 20 })]);
  expect(full.geometry.getAttribute("position").count).toBe(0);
  expect(full.outline).toHaveLength(0);
  expect(full.baseOutline).toHaveLength(0);
  expect(full.topOutline).toHaveLength(0);
});

test("wall base lines break below raised openings", () => {
  const window = wall([opening({ name: "Window", heightM: 2, height: 1 })]);
  expect(window.baseOutline).toHaveLength(4);
  expect(window.baseOutline.map((point) => point[0])).toEqual([2, 1, -1, -2]);
});

test.each([
  { bottomM: 0.025, open: true },
  { bottomM: 0.05, open: true },
  { bottomM: 0.051, open: false },
])(
  "opening bottom $bottomM extends to the floor only within 0.05 m",
  ({ bottomM, open }) => {
    const result = wall([opening({ heightM: 1 + bottomM })]);
    const mesh = new Mesh(result.geometry, new MeshBasicMaterial());
    expect(
      hits({ mesh, from: [0, -1.49, 1], direction: [0, 0, -1] }) === 0,
    ).toBe(open);
  },
);

test("L room mitres meet at inside and outside corners without gaps or overlapping wall volume", () => {
  const corners = [
    { x: 0, z: 0 },
    { x: 0, z: 4 },
    { x: 2, z: 4 },
    { x: 2, z: 2 },
    { x: 4, z: 2 },
    { x: 4, z: 0 },
  ];
  const segments = getWallSegments({
    walls: corners.map((startM, index) => ({
      id: `wall-${index}`,
      kind: "solid",
      startM,
    })),
  });
  const meshes = segments.map((segment, index) => {
    const extensions = getWallEndExtensions({
      segment,
      previous: segments[(index + segments.length - 1) % segments.length],
      next: segments[(index + 1) % segments.length],
    });
    expect(extensions.startExtensionM).toBeCloseTo(
      index === 3 ? -wallThicknessM : wallThicknessM,
    );
    expect(extensions.endExtensionM).toBeCloseTo(
      index === 2 ? -wallThicknessM : wallThicknessM,
    );
    const result = createWallGeometry({
      wallId: segment.wall.id,
      lengthM: segment.lengthM,
      heightM: 3,
      items: [],
      ...extensions,
    });
    const mesh = new Mesh(result.geometry, new MeshBasicMaterial());
    const transform = getWallSurfaceTransform({ segment, heightM: 3 });
    mesh.position.set(...transform.position);
    mesh.rotation.y = transform.rotationY;
    mesh.updateMatrixWorld();
    return mesh;
  });
  for (let x = -0.15; x < 4.16; x += 0.037) {
    for (let z = -0.147; z < 4.16; z += 0.041) {
      const inside = x > 0 && z > 0 && x < 4 && z < 4 && (x < 2 || z < 2);
      const insideOuter =
        x > -0.12 &&
        z > -0.12 &&
        x < 4.12 &&
        z < 4.12 &&
        (x < 2.12 || z < 2.12);
      const occupied = meshes.filter(
        (mesh) => hits({ mesh, from: [x, 5, z], direction: [0, -1, 0] }) > 0,
      );
      expect(occupied.length, `wall volume at ${x}, ${z}`).toBe(
        insideOuter && !inside ? 1 : 0,
      );
    }
  }
});

test("mitres retain opening coordinates through both faces near a wall end", () => {
  const result = createWallGeometry({
    wallId: "wall",
    lengthM: 4,
    heightM: 3,
    startExtensionM: 0.12,
    endExtensionM: -0.12,
    items: [opening({ alongM: 0.15, width: 0.4 })],
  });
  const mesh = new Mesh(result.geometry, new MeshBasicMaterial());
  expect(frontArea(result.geometry)).toBeCloseTo(11.3);
  expect(hits({ mesh, from: [2.02, 0, -1], direction: [0, 0, 1] })).toBe(0);
  expect(
    hits({ mesh, from: [2.08, 0, -1], direction: [0, 0, 1] }),
  ).toBeGreaterThan(0);
  expect(hits({ mesh, from: [1.7, 0, -1], direction: [0, 0, 1] })).toBe(0);
  expect(
    hits({ mesh, from: [1.6, 0, -1], direction: [0, 0, 1] }),
  ).toBeGreaterThan(0);
});

test("neighbouring mitres share outer endpoints at non-right angles", () => {
  const segments = getWallSegments({
    walls: [
      { x: 0, z: 0 },
      { x: 0, z: 3 },
      { x: 2, z: 4 },
      { x: 5, z: 0 },
    ].map((startM, index) => ({ id: `wall-${index}`, kind: "solid", startM })),
  });
  const endpoints = segments.map((segment, index) => {
    const extensions = getWallEndExtensions({
      segment,
      previous: segments[(index + segments.length - 1) % segments.length],
      next: segments[(index + 1) % segments.length],
    });
    return {
      start: new Vector3(
        segment.startM.x +
          wallThicknessM * segment.outward.x -
          extensions.startExtensionM * segment.direction.x,
        0,
        segment.startM.z +
          wallThicknessM * segment.outward.z -
          extensions.startExtensionM * segment.direction.z,
      ),
      end: new Vector3(
        segment.endM.x +
          wallThicknessM * segment.outward.x +
          extensions.endExtensionM * segment.direction.x,
        0,
        segment.endM.z +
          wallThicknessM * segment.outward.z +
          extensions.endExtensionM * segment.direction.z,
      ),
    };
  });
  endpoints.forEach((endpoint, index) => {
    const next = endpoints[(index + 1) % endpoints.length];
    if (!next) throw new Error("Missing neighbour");
    expect(endpoint.end.distanceTo(next.start)).toBeLessThan(1e-10);
  });
});

test("unflagged items, other walls and cuts outside the wall leave it solid", () => {
  const item = opening();
  const other = opening();
  if (other.placement.kind !== "wall") throw new Error("Expected wall");
  other.placement.wallId = "other";
  const result = wall([
    { ...item, cutsOpening: false },
    other,
    opening({ alongM: 10 }),
  ]);
  expect(frontArea(result.geometry)).toBeCloseTo(12);
});

for (const rotationRad of [Math.PI / 2, Math.PI / 4, -Math.PI / 6]) {
  test(`rotated opening ${rotationRad} matches its frame and keeps solid corners`, () => {
    const item = opening({ width: 1, height: 2, heightM: 1.5 });
    if (item.placement.kind !== "wall") throw new Error("Expected wall");
    item.placement.rotationRad = rotationRad;
    const result = wall([item]);
    expect(frontArea(result.geometry)).toBeCloseTo(10);
    const mesh = new Mesh(result.geometry, new MeshBasicMaterial());
    for (const [x, y] of [
      [0.4, 0.9],
      [-0.4, -0.9],
    ]) {
      if (x === undefined || y === undefined) throw new Error("Missing point");
      const rotatedX = x * Math.cos(rotationRad) - y * Math.sin(rotationRad);
      const rotatedY = x * Math.sin(rotationRad) + y * Math.cos(rotationRad);
      expect(
        hits({ mesh, from: [rotatedX, rotatedY, 1], direction: [0, 0, -1] }),
      ).toBe(0);
    }
    expect(
      hits({ mesh, from: [1.8, 1.3, 1], direction: [0, 0, -1] }),
    ).toBeGreaterThan(0);
  });
}

test("overlapping rotated cuts merge and clip to the wall without internal reveals", () => {
  const first = opening({ width: 2, height: 2, heightM: 1.5 });
  const second = opening({ width: 2, height: 2, heightM: 1.5 });
  if (second.placement.kind !== "wall") throw new Error("Expected wall");
  second.placement.rotationRad = Math.PI / 4;
  const result = wall([first, second]);
  const mesh = new Mesh(result.geometry, new MeshBasicMaterial());
  for (let x = -1.9; x < 2; x += 0.17) {
    for (let y = -1.4; y < 1.5; y += 0.19) {
      const inside =
        (Math.abs(x) < 1 && Math.abs(y) < 1) ||
        Math.abs(x) + Math.abs(y) < Math.SQRT2;
      expect(hits({ mesh, from: [x, y, 1], direction: [0, 0, -1] }) === 0).toBe(
        inside,
      );
    }
  }
  const internal = new Raycaster(
    new Vector3(0, 0, -0.06),
    new Vector3(1, 0, 0),
    0,
    1.4,
  );
  expect(internal.intersectObject(mesh)).toHaveLength(0);
});
