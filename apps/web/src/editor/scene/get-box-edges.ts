type Point = [number, number, number];

type Box = {
  x: { min: number; max: number };
  y: { min: number; max: number };
  z: { min: number; max: number };
};

/** Return the 12 edges of `box`, grown by `marginM` on every side, as a flat list of segment end points for a segmented line. */
export function getBoxEdges(options: { box: Box; marginM: number }) {
  const { box, marginM } = options;
  const xs = [box.x.min - marginM, box.x.max + marginM];
  const ys = [box.y.min - marginM, box.y.max + marginM];
  const zs = [box.z.min - marginM, box.z.max + marginM];
  const corners = [0, 1].flatMap((i) =>
    [0, 1].flatMap((j) =>
      [0, 1].map((k): Point => [xs[i] ?? 0, ys[j] ?? 0, zs[k] ?? 0]),
    ),
  );
  const pairs = [
    [0, 1],
    [2, 3],
    [4, 5],
    [6, 7],
    [0, 2],
    [1, 3],
    [4, 6],
    [5, 7],
    [0, 4],
    [1, 5],
    [2, 6],
    [3, 7],
  ] as const;
  const origin: Point = [0, 0, 0];
  return pairs.flatMap(([a, b]) => [
    corners[a] ?? origin,
    corners[b] ?? origin,
  ]);
}
