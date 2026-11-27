import { useEffect, useState } from "react";
import type { Texture } from "three";
import type { createSurfaceTextureCache } from "./create-surface-texture-cache.ts";
import type { SurfaceTextureMaps } from "./surface-texture-maps.ts";

export function useSurfaceTextures(options: {
  cache: ReturnType<typeof createSurfaceTextureCache>;
  projectId: string;
  assetId: string | undefined;
}) {
  const key = `${options.projectId}/${options.assetId ?? ""}`;
  const [loaded, setLoaded] = useState<{
    key: string;
    maps: SurfaceTextureMaps;
  }>();
  useEffect(() => {
    if (!options.assetId) return;
    let isActive = true;
    const textures: Texture[] = [];
    const lease = options.cache.acquire({
      projectId: options.projectId,
      assetId: options.assetId,
    });
    function clone(texture: Texture | undefined) {
      if (!texture) return undefined;
      const copy = texture.clone();
      textures.push(copy);
      return copy;
    }
    void lease.maps.then((maps) => {
      if (!isActive) return;
      setLoaded({
        key,
        maps: {
          map: clone(maps.map),
          normalMap: clone(maps.normalMap),
          roughnessMap: clone(maps.roughnessMap),
        },
      });
    });
    return () => {
      isActive = false;
      for (const texture of textures) texture.dispose();
      lease.release();
    };
  }, [options.cache, options.projectId, options.assetId, key]);
  return loaded?.key === key ? loaded.maps : undefined;
}
