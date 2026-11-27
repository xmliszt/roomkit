import type { SurfaceAsset } from "@planner/shared/src/protocol/surface-assets-result-schema.ts";

export function getSurfaceAssetSize(asset: SurfaceAsset) {
  switch (asset.kind) {
    case "texture":
      return asset.repeatSizeM;
    case "tiles":
      return asset.tileSizeM;
    case "planks":
      return asset.plankSizeM;
    default: {
      const unreachable: never = asset;
      return unreachable;
    }
  }
}
