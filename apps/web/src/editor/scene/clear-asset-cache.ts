import { useGLTF } from "@react-three/drei";
import { useLoader } from "@react-three/fiber";
import { FileLoader } from "three";
import { getAssetUrl } from "../../items/get-asset-url.ts";
import { ColorMaskLoader } from "./color-mask-loader.ts";

/** Forget the cached `meta.json`, `model.glb` and `colorMask.png` loads of one asset, so the next mount fetches them again. */
export function clearAssetCache(options: {
  projectId: string;
  assetId: string;
}) {
  useLoader.clear(
    FileLoader,
    getAssetUrl({ ...options, fileName: "meta.json" }),
  );
  useGLTF.clear(getAssetUrl({ ...options, fileName: "model.glb" }));
  useLoader.clear(
    ColorMaskLoader,
    getAssetUrl({ ...options, fileName: "colorMask.png" }),
  );
}
