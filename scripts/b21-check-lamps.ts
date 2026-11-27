import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const sharp: typeof import("../packages/daemon/node_modules/sharp/lib/index.js") =
  createRequire(new URL("../packages/daemon/package.json", import.meta.url))(
    "sharp",
  );
const evidence = process.argv.at(2);
if (!evidence)
  throw new Error(
    "Usage: node scripts/b21-check-lamps.ts <evidence directory>",
  );
const beforePath = join(evidence, "b21-walk.png");
const afterPath = join(evidence, "b21-walk-lamp.png");
const regions = [
  {
    name: "Mushroom dome",
    left: 586,
    top: 780,
    width: 39,
    height: 20,
    minimumGain: 0.05,
  },
  {
    name: "Surface below mushroom",
    left: 570,
    top: 840,
    width: 80,
    height: 25,
    minimumGain: 0.01,
  },
  {
    name: "Arc shade",
    left: 1190,
    top: 638,
    width: 75,
    height: 48,
    minimumGain: 0.05,
  },
  {
    name: "Surface below arc lamp",
    left: 1212,
    top: 752,
    width: 55,
    height: 12,
    minimumGain: 0.01,
  },
];
const measurements = [];
for (const region of regions) {
  const colours = [];
  for (const path of [beforePath, afterPath]) {
    const metadata = await sharp(path).metadata();
    if (metadata.width !== 1920 || metadata.height !== 1080)
      throw new Error(
        "Lamp evidence must use the matched 1920 × 1080 walk view",
      );
    const pixels = await sharp(path)
      .extract({
        left: region.left,
        top: region.top,
        width: region.width,
        height: region.height,
      })
      .toBuffer();
    const stats = await sharp(pixels).stats();
    const rgb = stats.channels.slice(0, 3).map((channel) => channel.mean / 255);
    const [red = 0, green = 0, blue = 0] = rgb;
    colours.push({ rgb, luma: 0.3 * red + 0.59 * green + 0.11 * blue });
  }
  const before = colours.at(0);
  const after = colours.at(1);
  if (!before || !after) throw new Error("Missing lamp comparison");
  const gain = after.luma / before.luma - 1;
  measurements.push({
    ...region,
    before,
    after,
    gain,
    passes: gain >= region.minimumGain,
  });
}
const passes = measurements.every((measurement) => measurement.passes);
writeFileSync(
  join(evidence, "b21-lamp-check.json"),
  `${JSON.stringify({ beforePath, afterPath, measurements, passes }, null, 2)}\n`,
);
console.log(
  JSON.stringify(
    {
      passes,
      measurements: measurements.map(({ name, gain, passes }) => ({
        name,
        gain,
        passes,
      })),
    },
    null,
    2,
  ),
);
if (!passes)
  throw new Error(
    "Both lamps must light the surface below them and their shades must brighten",
  );
