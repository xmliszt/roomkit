import {
  RepeatWrapping,
  SRGBColorSpace,
  type Texture,
  TextureLoader,
} from "three";
import { getDaemonUrl } from "../../daemon-http/get-daemon-url.ts";
import type { SurfaceTextureMaps } from "./surface-texture-maps.ts";

type Entry = {
  references: number;
  isDisposed: boolean;
  textures: Texture[];
  maps: Promise<SurfaceTextureMaps>;
};

export function createSurfaceTextureCache(
  options: { loader?: { loadAsync: (url: string) => Promise<Texture> } } = {},
) {
  const loader =
    options.loader ?? new TextureLoader().setCrossOrigin("anonymous");
  const entries: { [key: string]: Entry } = {};

  function createEntry(input: { projectId: string; assetId: string }) {
    const entry: Entry = {
      references: 0,
      isDisposed: false,
      textures: [],
      maps: Promise.resolve({
        map: undefined,
        normalMap: undefined,
        roughnessMap: undefined,
      }),
    };
    async function load(fileName: string) {
      try {
        const texture = await loader.loadAsync(
          getDaemonUrl({
            path: `/projects/${input.projectId}/assets/${input.assetId}/${fileName}`,
          }),
        );
        if (entry.isDisposed) {
          texture.dispose();
          return undefined;
        }
        texture.wrapS = texture.wrapT = RepeatWrapping;
        if (fileName === "baseColor.png") texture.colorSpace = SRGBColorSpace;
        entry.textures.push(texture);
        return texture;
      } catch {
        return undefined;
      }
    }
    entry.maps = Promise.all([
      load("baseColor.png"),
      load("normal.png"),
      load("roughness.png"),
    ]).then(([map, normalMap, roughnessMap]) => ({
      map,
      normalMap,
      roughnessMap,
    }));
    return entry;
  }

  return {
    acquire(input: { projectId: string; assetId: string }) {
      const key = `${input.projectId}/${input.assetId}`;
      const entry = entries[key] ?? createEntry(input);
      entries[key] = entry;
      entry.references++;
      let isReleased = false;
      return {
        maps: entry.maps,
        release() {
          if (isReleased) return;
          isReleased = true;
          entry.references--;
          queueMicrotask(() => {
            if (entry.references !== 0 || entry.isDisposed) return;
            entry.isDisposed = true;
            delete entries[key];
            for (const texture of entry.textures) texture.dispose();
          });
        },
      };
    },
  };
}
