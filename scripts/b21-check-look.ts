import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { z } from "zod";

const sharp: typeof import("../packages/daemon/node_modules/sharp/lib/index.js") =
  createRequire(new URL("../packages/daemon/package.json", import.meta.url))(
    "sharp",
  );
const renderPath = process.argv.at(2);
const editorPath = process.argv.at(3);
const metricsPath = process.argv.at(4);
if (!renderPath || !editorPath || !metricsPath)
  throw new Error(
    "Usage: node scripts/b21-check-look.ts <render.png> <editor.png> <metrics.json>",
  );
const metrics = z
  .object({
    metrics: z.object({
      requiredColourIds: z.array(z.string()).min(1),
      colourProbes: z.array(
        z.object({
          id: z.string(),
          kind: z.enum(["wall", "item"]),
          x: z.number().int(),
          y: z.number().int(),
        }),
      ),
    }),
  })
  .parse(JSON.parse(readFileSync(metricsPath, "utf8"))).metrics;
const render = await sharp(renderPath)
  .removeAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });
const editor = await sharp(editorPath)
  .removeAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });
if (
  render.info.width !== editor.info.width ||
  render.info.height !== editor.info.height
)
  throw new Error("Editor and render dimensions differ");
const probesById = Object.groupBy(metrics.colourProbes, (probe) => probe.id);
const missingIds = metrics.requiredColourIds.filter(
  (id) => (probesById[id]?.length ?? 0) < 3,
);
function colour(options: {
  image: typeof render;
  probes: typeof metrics.colourProbes;
}) {
  const rgb = [0, 1, 2].map(
    (channel) =>
      options.probes.reduce(
        (sum, probe) =>
          sum +
          (options.image.data[
            (probe.y * options.image.info.width + probe.x) *
              options.image.info.channels +
              channel
          ] ?? 0),
        0,
      ) /
      (options.probes.length * 255),
  );
  const [red = 0, green = 0, blue = 0] = rgb;
  const high = Math.max(...rgb);
  const low = Math.min(...rgb);
  const range = high - low;
  const hue =
    range < 1e-5
      ? 0
      : ((high === red
          ? (green - blue) / range
          : high === green
            ? (blue - red) / range + 2
            : (red - green) / range + 4) /
          6 +
          1) %
        1;
  return {
    rgb,
    luma: 0.3 * red + 0.59 * green + 0.11 * blue,
    hue,
    saturation: high ? range / high : 0,
  };
}
const comparisons = Object.entries(probesById).flatMap(([id, probes]) => {
  if (!probes || probes.length < 3) return [];
  const rendered = colour({ image: render, probes });
  const displayed = colour({ image: editor, probes });
  const difference = Math.abs(rendered.hue - displayed.hue);
  const lumaError = Math.abs(rendered.luma - displayed.luma) / displayed.luma;
  const hueError = Math.min(difference, 1 - difference);
  const isSaturated = probes.at(0)?.kind === "item";
  const passes = isSaturated
    ? displayed.saturation > 0.3 &&
      rendered.saturation >= displayed.saturation * 0.9
    : lumaError <= 0.1 && hueError <= 0.08;
  return [
    {
      id,
      probeCount: probes.length,
      rendered,
      displayed,
      lumaError,
      hueError,
      isSaturated,
      passes,
    },
  ];
});
const stats = await sharp(renderPath).stats();
const meanBrightness =
  stats.channels
    .slice(0, 3)
    .reduce((sum, channel) => sum + channel.mean / 255, 0) / 3;
const result = { meanBrightness, missingIds, comparisons };
writeFileSync(
  renderPath.replace(/\.png$/, "-look.json"),
  `${JSON.stringify(result, null, 2)}\n`,
);
console.log(
  JSON.stringify(
    {
      meanBrightness,
      missingIds,
      comparisons: comparisons.map((comparison) => ({
        id: comparison.id,
        probeCount: comparison.probeCount,
        lumaError: comparison.lumaError,
        hueError: comparison.hueError,
        saturationRetained: comparison.isSaturated
          ? comparison.rendered.saturation / comparison.displayed.saturation
          : undefined,
        passes: comparison.passes,
      })),
    },
    null,
    2,
  ),
);
if (
  !comparisons.length ||
  missingIds.length > 0 ||
  comparisons.some((comparison) => !comparison.passes) ||
  meanBrightness < 0.5 ||
  meanBrightness > 0.6
)
  throw new Error("B21 colour comparison gate failed");
