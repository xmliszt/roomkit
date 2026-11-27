import type { Placement } from "@planner/shared/src/scene/placement-schema.ts";
import type { Size } from "@planner/shared/src/scene/size-schema.ts";
import { formatDecimal } from "../i18n/format-decimal.ts";
import type { DimensionLine } from "../room/dimension-line.ts";
import { getItemBox } from "./get-item-box.ts";
import type { Vec3 } from "./vec3.ts";

type Axis = "x" | "y" | "z";

/** Return the width (`x`), height (`y`) and depth (`z`) dimension lines of an item, in its own frame: each a measure line set off from the box, with 45° ticks at both ends, its label and its `axis`. */
export function getItemDimensionLines(options: {
  placementKind: Placement["kind"];
  sizeM: Size;
  locale?: string;
}): (DimensionLine & { axis: Axis })[] {
  const box = getItemBox(options);
  const largestM = Math.max(
    options.sizeM.width,
    options.sizeM.height,
    options.sizeM.depth,
  );
  const offsetM = Math.min(0.12, Math.max(0.03, largestM * 0.08));
  const tickM = offsetM / 3;
  function line(input: {
    axis: Axis;
    from: Vec3;
    to: Vec3;
    away: Vec3;
    lengthM: number;
  }): DimensionLine & { axis: Axis } {
    function shift(shifted: { point: Vec3; awayM: number; alongM: number }) {
      const along = { x: 0, y: 0, z: 0, [input.axis]: shifted.alongM };
      return {
        x: shifted.point.x + input.away.x * shifted.awayM + along.x,
        y: shifted.point.y + input.away.y * shifted.awayM + along.y,
        z: shifted.point.z + input.away.z * shifted.awayM + along.z,
      };
    }
    function tick(point: Vec3): [Vec3, Vec3] {
      return [
        shift({ point, awayM: offsetM + tickM, alongM: -tickM }),
        shift({ point, awayM: offsetM - tickM, alongM: tickM }),
      ];
    }
    return {
      axis: input.axis,
      segments: [
        [
          shift({ point: input.from, awayM: offsetM, alongM: 0 }),
          shift({ point: input.to, awayM: offsetM, alongM: 0 }),
        ],
        tick(input.from),
        tick(input.to),
      ],
      labelM: shift({
        point: {
          x: (input.from.x + input.to.x) / 2,
          y: (input.from.y + input.to.y) / 2,
          z: (input.from.z + input.to.z) / 2,
        },
        awayM: offsetM,
        alongM: 0,
      }),
      text: `${formatDecimal({ value: input.lengthM, locale: options.locale })} m`,
    };
  }
  return [
    line({
      axis: "x",
      from: { x: box.x.min, y: box.y.min, z: box.z.max },
      to: { x: box.x.max, y: box.y.min, z: box.z.max },
      away: { x: 0, y: 0, z: 1 },
      lengthM: options.sizeM.width,
    }),
    line({
      axis: "y",
      from: { x: box.x.max, y: box.y.min, z: box.z.max },
      to: { x: box.x.max, y: box.y.max, z: box.z.max },
      away: { x: 1, y: 0, z: 0 },
      lengthM: options.sizeM.height,
    }),
    line({
      axis: "z",
      from: { x: box.x.max, y: box.y.min, z: box.z.min },
      to: { x: box.x.max, y: box.y.min, z: box.z.max },
      away: { x: 1, y: 0, z: 0 },
      lengthM: options.sizeM.depth,
    }),
  ];
}
