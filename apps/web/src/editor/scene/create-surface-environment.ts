import {
  DataTexture,
  EquirectangularReflectionMapping,
  SRGBColorSpace,
} from "three";

export function createSurfaceEnvironment() {
  const width = 64;
  const height = 32;
  const pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const latitude = (y / height - 0.5) * Math.PI;
      const longitude = (x / width - 0.5) * Math.PI * 2;
      const light = Math.max(
        0,
        Math.sin(latitude) * 0.8 +
          Math.cos(latitude) *
            (Math.cos(longitude) * 0.5 + Math.sin(longitude) * 0.3),
      );
      const value = Math.round(80 + 175 * light ** 5);
      const offset = (y * width + x) * 4;
      pixels.set([value, value, value, 255], offset);
    }
  }
  const texture = new DataTexture(pixels, width, height);
  texture.mapping = EquirectangularReflectionMapping;
  texture.colorSpace = SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}
