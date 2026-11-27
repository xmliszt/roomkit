import type { SurfaceMaterial } from "@planner/shared/src/scene/surface-material-schema.ts";

type TexturedMaterial = Exclude<SurfaceMaterial, { kind: "paint" }>;

export function withSurfaceSize(options: {
  material: TexturedMaterial;
  size: { u: number; v: number };
}) {
  const material = options.material;
  const size = options.size;
  switch (material.kind) {
    case "texture":
      return { ...material, repeatSizeM: size };
    case "tiles":
      return {
        ...material,
        tileSizeM: size,
        groutWidthM: Math.min(material.groutWidthM, size.u / 2, size.v / 2),
      };
    case "planks":
      return { ...material, plankSizeM: size };
    default: {
      const unreachable: never = material;
      return unreachable;
    }
  }
}
