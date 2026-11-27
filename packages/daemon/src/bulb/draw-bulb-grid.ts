import sharp from "sharp";

const marginPx = 48;
const steps = Array.from({ length: 11 }, (_, index) => index / 10);

/** Write `output`: the render at `input` on white with a 0-1 grid at 0.1 steps over it and labelled axes in a margin, without changing `input`. */
export async function drawBulbGrid(options: {
  input: string;
  output: string;
  acrossAxis: "x" | "z";
}) {
  const metadata = await sharp(options.input).metadata();
  const widthPx = metadata.width ?? 0;
  const heightPx = metadata.height ?? 0;
  const lines = steps.flatMap((step) => {
    const xPx = marginPx + step * widthPx;
    const yPx = marginPx + (1 - step) * heightPx;
    const isMajor = step === 0 || step === 0.5 || step === 1;
    const stroke = isMajor ? "#d0021b" : "#4a90e2";
    const label = step.toFixed(1);
    return [
      `<line x1="${xPx}" y1="${marginPx}" x2="${xPx}" y2="${marginPx + heightPx}" stroke="${stroke}" stroke-width="1" stroke-opacity="0.7"/>`,
      `<line x1="${marginPx}" y1="${yPx}" x2="${marginPx + widthPx}" y2="${yPx}" stroke="${stroke}" stroke-width="1" stroke-opacity="0.7"/>`,
      `<text x="${xPx}" y="${marginPx + heightPx + 18}" font-size="13" font-family="Helvetica" text-anchor="middle">${label}</text>`,
      `<text x="${marginPx - 6}" y="${yPx + 4}" font-size="13" font-family="Helvetica" text-anchor="end">${label}</text>`,
    ];
  });
  const widthWithMarginPx = widthPx + marginPx * 2;
  const heightWithMarginPx = heightPx + marginPx * 2;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${widthWithMarginPx}" height="${heightWithMarginPx}">${lines.join("")}<text x="${marginPx + widthPx / 2}" y="${heightWithMarginPx - 6}" font-size="14" font-family="Helvetica" text-anchor="middle">${options.acrossAxis} →</text><text x="14" y="${marginPx - 14}" font-size="14" font-family="Helvetica">y ↑</text></svg>`;
  await sharp({
    create: {
      width: widthWithMarginPx,
      height: heightWithMarginPx,
      channels: 3,
      background: "#ffffff",
    },
  })
    .composite([
      { input: options.input, left: marginPx, top: marginPx },
      { input: Buffer.from(svg), left: 0, top: 0 },
    ])
    .png()
    .toFile(options.output);
}
