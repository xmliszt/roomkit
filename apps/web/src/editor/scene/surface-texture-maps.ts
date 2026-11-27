import type { Texture } from "three";

export type SurfaceTextureMaps = {
  map: Texture | undefined;
  normalMap: Texture | undefined;
  roughnessMap: Texture | undefined;
};
