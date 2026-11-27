import { Texture } from "three";
import { expect, test, vi } from "vitest";
import { createSurfaceTextureCache } from "./create-surface-texture-cache.ts";

test("surfaces share three source maps until the final reference releases them", async () => {
  const textures: Texture[] = [];
  const loadAsync = vi.fn(async () => {
    const texture = new Texture();
    vi.spyOn(texture, "dispose");
    textures.push(texture);
    return texture;
  });
  const cache = createSurfaceTextureCache({ loader: { loadAsync } });
  const floor = cache.acquire({ projectId: "room", assetId: "wallpaper" });
  const wall = cache.acquire({ projectId: "room", assetId: "wallpaper" });
  expect(await floor.maps).toBe(await wall.maps);
  expect(loadAsync).toHaveBeenCalledTimes(3);
  floor.release();
  await Promise.resolve();
  for (const texture of textures)
    expect(texture.dispose).not.toHaveBeenCalled();
  wall.release();
  await Promise.resolve();
  for (const texture of textures)
    expect(texture.dispose).toHaveBeenCalledTimes(1);
});

test("project identities isolate assets and immediate reacquisition keeps loaded maps", async () => {
  const loadAsync = vi.fn(async () => new Texture());
  const cache = createSurfaceTextureCache({ loader: { loadAsync } });
  const first = cache.acquire({ projectId: "one", assetId: "same" });
  const other = cache.acquire({ projectId: "two", assetId: "same" });
  const maps = await first.maps;
  expect(maps).not.toBe(await other.maps);
  first.release();
  const next = cache.acquire({ projectId: "one", assetId: "same" });
  expect(await next.maps).toBe(maps);
  expect(loadAsync).toHaveBeenCalledTimes(6);
  next.release();
  other.release();
});

test("maps finishing after the last surface unmounts are disposed", async () => {
  const pending: ((texture: Texture) => void)[] = [];
  const cache = createSurfaceTextureCache({
    loader: {
      loadAsync: () => new Promise<Texture>((resolve) => pending.push(resolve)),
    },
  });
  const lease = cache.acquire({ projectId: "room", assetId: "wallpaper" });
  lease.release();
  await Promise.resolve();
  const textures = pending.map((resolve) => {
    const texture = new Texture();
    vi.spyOn(texture, "dispose");
    resolve(texture);
    return texture;
  });
  expect(await lease.maps).toEqual({
    map: undefined,
    normalMap: undefined,
    roughnessMap: undefined,
  });
  for (const texture of textures)
    expect(texture.dispose).toHaveBeenCalledTimes(1);
});
