import {
  type Camera,
  Color,
  DataUtils,
  HalfFloatType,
  NeutralToneMapping,
  RGBAFormat,
  type Scene,
  type WebGLRenderer,
  WebGLRenderTarget,
} from "three";
import { applyNeutralToneMapping } from "./apply-neutral-tone-mapping.ts";

const snapshotScale = 2;
const sampleCount = 4;

function toSrgbByte(linear: number) {
  const clamped = Math.min(1, Math.max(0, linear));
  const encoded =
    clamped <= 0.0031308
      ? clamped * 12.92
      : 1.055 * clamped ** (1 / 2.4) - 0.055;
  return Math.round(encoded * 255);
}

/** Render one frame of `scene` from `camera` offscreen at twice the canvas's CSS size, with the canvas's `NeutralToneMapping` when it has it, and return it as a PNG, without changing what the canvas shows. */
export async function renderSnapshot(options: {
  gl: WebGLRenderer;
  scene: Scene;
  camera: Camera;
  sizePx: { width: number; height: number };
}) {
  const width = Math.round(options.sizePx.width * snapshotScale);
  const height = Math.round(options.sizePx.height * snapshotScale);
  const target = new WebGLRenderTarget(width, height, {
    type: HalfFloatType,
    format: RGBAFormat,
    samples: sampleCount,
  });
  const halves = new Uint16Array(width * height * 4);
  const previousTarget = options.gl.getRenderTarget();
  const isToneMapped = options.gl.toneMapping === NeutralToneMapping;
  const sceneBackground = options.scene.background;
  const backgroundColor =
    sceneBackground instanceof Color
      ? sceneBackground.clone()
      : new Color(0, 0, 0);
  const previousClear = {
    color: options.gl.getClearColor(new Color()),
    alpha: options.gl.getClearAlpha(),
  };
  try {
    options.gl.setRenderTarget(target);
    if (isToneMapped) {
      options.scene.background = null;
      options.gl.setClearColor(0x000000, 0);
    }
    options.gl.render(options.scene, options.camera);
    options.gl.readRenderTargetPixels(target, 0, 0, width, height, halves);
  } finally {
    options.scene.background = sceneBackground;
    options.gl.setClearColor(previousClear.color, previousClear.alpha);
    options.gl.setRenderTarget(previousTarget);
    target.dispose();
  }
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("No 2D canvas for the snapshot");
  const image = context.createImageData(width, height);
  const pixel = new Float32Array(3);
  const background = Float32Array.of(
    backgroundColor.r,
    backgroundColor.g,
    backgroundColor.b,
  );
  for (let row = 0; row < height; row += 1) {
    const sourceRow = (height - 1 - row) * width * 4;
    const targetRow = row * width * 4;
    for (let index = 0; index < width * 4; index += 4) {
      const source = sourceRow + index;
      for (let channel = 0; channel < 3; channel += 1)
        pixel[channel] = DataUtils.fromHalfFloat(halves[source + channel] ?? 0);
      if (isToneMapped) {
        const coverage = Math.min(
          1,
          DataUtils.fromHalfFloat(halves[source + 3] ?? 0),
        );
        if (coverage > 0) {
          for (let channel = 0; channel < 3; channel += 1)
            pixel[channel] = (pixel[channel] ?? 0) / coverage;
          applyNeutralToneMapping(pixel);
        }
        for (let channel = 0; channel < 3; channel += 1)
          pixel[channel] =
            (pixel[channel] ?? 0) * coverage +
            (background[channel] ?? 0) * (1 - coverage);
      }
      for (let channel = 0; channel < 3; channel += 1)
        image.data[targetRow + index + channel] = toSrgbByte(
          pixel[channel] ?? 0,
        );
      image.data[targetRow + index + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);
  return canvas.convertToBlob({ type: "image/png" });
}
