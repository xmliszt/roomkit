import { formatDecimal } from "../i18n/format-decimal.ts";
import type { DimensionLine } from "./dimension-line.ts";
import type { WallSegment } from "./wall-segment.ts";

const offsetM = 0.28;
const tickM = 0.06;
const extensionGapM = 0.08;

/** Return the floor-level dimension line for `segment`: the measure line outside the wall, 45° ticks at both ends, two extension lines, and the label position and text. */
export function getDimensionLine(options: {
  segment: WallSegment;
  locale?: string;
}): DimensionLine {
  const { segment, locale } = options;
  const { startM, endM, direction, outward } = segment;
  function at(input: {
    base: { x: number; z: number };
    outM: number;
    alongM?: number;
  }) {
    const alongM = input.alongM ?? 0;
    return {
      x: input.base.x + outward.x * input.outM + direction.x * alongM,
      y: 0,
      z: input.base.z + outward.z * input.outM + direction.z * alongM,
    };
  }
  function tick(base: {
    x: number;
    z: number;
  }): [ReturnType<typeof at>, ReturnType<typeof at>] {
    return [
      at({ base, outM: offsetM + tickM, alongM: -tickM }),
      at({ base, outM: offsetM - tickM, alongM: tickM }),
    ];
  }
  return {
    segments: [
      [at({ base: startM, outM: offsetM }), at({ base: endM, outM: offsetM })],
      tick(startM),
      tick(endM),
      [
        at({ base: startM, outM: extensionGapM }),
        at({ base: startM, outM: offsetM + extensionGapM }),
      ],
      [
        at({ base: endM, outM: extensionGapM }),
        at({ base: endM, outM: offsetM + extensionGapM }),
      ],
    ],
    labelM: {
      x: (startM.x + endM.x) / 2 + outward.x * offsetM,
      y: 0,
      z: (startM.z + endM.z) / 2 + outward.z * offsetM,
    },
    text: `${formatDecimal({ value: segment.lengthM, locale })} m`,
  };
}
