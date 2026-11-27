import {
  Color,
  type Material,
  Mesh,
  type Object3D,
  Texture,
  Vector3,
} from "three";
import { isInShade } from "./is-in-shade.ts";

const sampleSizePx = 64;

function readTexturePixels(texture: Texture) {
  const image: unknown = texture.image;
  if (
    typeof OffscreenCanvas === "undefined" ||
    !(
      (typeof ImageBitmap !== "undefined" && image instanceof ImageBitmap) ||
      (typeof HTMLImageElement !== "undefined" &&
        image instanceof HTMLImageElement) ||
      (typeof HTMLCanvasElement !== "undefined" &&
        image instanceof HTMLCanvasElement)
    )
  )
    return undefined;
  const canvas = new OffscreenCanvas(sampleSizePx, sampleSizePx);
  const context = canvas.getContext("2d");
  if (!context) return undefined;
  context.drawImage(image, 0, 0, sampleSizePx, sampleSizePx);
  return context.getImageData(0, 0, sampleSizePx, sampleSizePx).data;
}

function getBaseColor(material: Material) {
  return "color" in material && material.color instanceof Color
    ? material.color
    : new Color(1, 1, 1);
}

function getBaseMap(material: Material) {
  return "map" in material && material.map instanceof Texture
    ? material.map
    : undefined;
}

/** Return the mean base colour (linear RGB, base colour factor times base map) of the vertices of `model` within `radiusM` of `centreM` and not past it along `direction`, or `undefined` when no vertex does. `model` is read in its own frame and is not changed. */
export function getShadeTint(options: {
  model: Object3D;
  centreM: Vector3;
  direction: Vector3;
  radiusM: number;
}) {
  const pixelsByTexture = new Map<Texture, Uint8ClampedArray | undefined>();
  const total = new Color(0, 0, 0);
  const point = new Vector3();
  const sample = new Color();
  const texel = new Color();
  let count = 0;
  options.model.updateMatrixWorld(true);
  const rootInverse = options.model.matrixWorld.clone().invert();
  options.model.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    const material: Material | undefined = Array.isArray(object.material)
      ? object.material.at(0)
      : object.material;
    if (material === undefined) return;
    const positions = object.geometry.getAttribute("position");
    const uvs = object.geometry.getAttribute("uv");
    const map = getBaseMap(material);
    if (map && !pixelsByTexture.has(map))
      pixelsByTexture.set(map, readTexturePixels(map));
    const pixels = map ? pixelsByTexture.get(map) : undefined;
    for (let index = 0; index < positions.count; index += 1) {
      point
        .fromBufferAttribute(positions, index)
        .applyMatrix4(object.matrixWorld)
        .applyMatrix4(rootInverse);
      if (
        !isInShade({
          pointM: point,
          centreM: options.centreM,
          direction: options.direction,
          radiusM: options.radiusM,
          maxAlongM: 0,
        })
      )
        continue;
      sample.copy(getBaseColor(material));
      if (pixels && uvs) {
        const u = ((uvs.getX(index) % 1) + 1) % 1;
        const v = ((uvs.getY(index) % 1) + 1) % 1;
        const at =
          (Math.floor(v * (sampleSizePx - 1)) * sampleSizePx +
            Math.floor(u * (sampleSizePx - 1))) *
          4;
        sample.multiply(
          texel.setRGB(
            (pixels[at] ?? 255) / 255,
            (pixels[at + 1] ?? 255) / 255,
            (pixels[at + 2] ?? 255) / 255,
            "srgb",
          ),
        );
      }
      total.add(sample);
      count += 1;
    }
  });
  return count === 0 ? undefined : total.multiplyScalar(1 / count);
}
