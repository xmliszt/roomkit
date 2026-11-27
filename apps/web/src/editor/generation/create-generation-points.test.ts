import { expect, test } from "vitest";
import { createGenerationPoints } from "./create-generation-points.ts";

test.each([false, true])(
  "rug points cover its top face with load-in gathering: %s",
  (gatherFromSurface) => {
    const positions = new Float32Array(8000 * 3);
    for (let index = 0; index < 8000; index++) {
      positions.set(
        [
          ((index % 97) / 96) * 2 - 1,
          0.01,
          ((Math.floor(index / 97) % 47) / 46) * 1.4 - 0.7,
        ],
        index * 3,
      );
    }
    const points = createGenerationPoints({
      placementKind: "floor",
      sizeM: { width: 2, height: 0.01, depth: 1.4 },
      accent: "#1e50e6",
      gatherFromSurface,
      ...(gatherFromSurface
        ? { surface: { positions, colors: new Float32Array(8000 * 3) } }
        : {}),
    });
    try {
      const positions = points.geometry.getAttribute("position");
      const xs = Array.from({ length: positions.count }, (_, index) =>
        positions.getX(index),
      );
      const zs = Array.from({ length: positions.count }, (_, index) =>
        positions.getZ(index),
      );
      expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(1.99);
      expect(Math.max(...zs) - Math.min(...zs)).toBeGreaterThan(1.39);
      for (let index = 0; index < positions.count; index++)
        expect(positions.getY(index)).toBeCloseTo(0.01);
    } finally {
      points.geometry.dispose();
      points.material.dispose();
    }
  },
);
