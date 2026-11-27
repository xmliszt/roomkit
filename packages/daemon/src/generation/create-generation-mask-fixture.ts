import sharp from "sharp";

export function createGenerationMaskFixture(options: {
  widthPx: number;
  heightPx: number;
  path: string;
}) {
  return sharp({
    create: {
      width: options.widthPx,
      height: options.heightPx,
      channels: 3,
      background: "white",
    },
  })
    .png()
    .toFile(options.path);
}
