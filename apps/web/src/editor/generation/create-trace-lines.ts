import { DoubleSide } from "three";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js";

export function createTraceLines(options: {
  positions: number[];
  color: string;
}) {
  const geometry = new LineSegmentsGeometry();
  geometry.setPositions(options.positions);
  geometry.instanceCount = 0;
  const material = new LineMaterial({
    color: options.color,
    linewidth: 1,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
    side: DoubleSide,
  });
  const line = new LineSegments2(geometry, material);
  line.frustumCulled = false;
  const ends = geometry.getAttribute("instanceEnd");
  let previousIndex: number | undefined;
  function setProgress(progress: number) {
    if (previousIndex !== undefined) {
      const offset = previousIndex * 6 + 3;
      ends.setXYZ(
        previousIndex,
        options.positions[offset] ?? 0,
        options.positions[offset + 1] ?? 0,
        options.positions[offset + 2] ?? 0,
      );
    }
    const segments =
      (Math.min(1, Math.max(0, progress)) * options.positions.length) / 6;
    const index = Math.floor(segments);
    geometry.instanceCount = Math.ceil(segments);
    const fraction = segments - index;
    if (fraction > 0) {
      const offset = index * 6;
      const from = [
        options.positions[offset] ?? 0,
        options.positions[offset + 1] ?? 0,
        options.positions[offset + 2] ?? 0,
      ];
      ends.setXYZ(
        index,
        (from[0] ?? 0) +
          ((options.positions[offset + 3] ?? 0) - (from[0] ?? 0)) * fraction,
        (from[1] ?? 0) +
          ((options.positions[offset + 4] ?? 0) - (from[1] ?? 0)) * fraction,
        (from[2] ?? 0) +
          ((options.positions[offset + 5] ?? 0) - (from[2] ?? 0)) * fraction,
      );
    }
    previousIndex = fraction > 0 ? index : undefined;
    ends.needsUpdate = true;
  }
  return { line, setProgress };
}
