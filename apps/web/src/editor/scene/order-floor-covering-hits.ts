import type { Intersection } from "three";
import { z } from "zod";

const PickSchema = z.object({
  itemPick: z.literal(true),
  floorCovering: z.boolean(),
  bottomYM: z.number(),
  topYM: z.number(),
});

function readPick(hit: Intersection) {
  if (hit.object.parent?.visible === false) return undefined;
  const parsed = PickSchema.safeParse(hit.object.userData);
  return parsed.success ? parsed.data : undefined;
}

/** Return the hits with each floor covering moved behind the first later item that the ray meets inside the covering's height band and whose top is higher, without changing any other order. */
export function orderFloorCoveringHits<T extends Intersection>(hits: T[]) {
  const picks = hits.map(readPick);
  const keys = hits.map((_, index) => {
    const covering = picks[index];
    if (!covering?.floorCovering) return index;
    const yieldIndex = hits.findIndex((hit, other) => {
      const pick = picks[other];
      return (
        other > index &&
        pick !== undefined &&
        !pick.floorCovering &&
        pick.topYM > covering.topYM &&
        hit.point.y >= covering.bottomYM &&
        hit.point.y <= covering.topYM
      );
    });
    return yieldIndex === -1 ? index : yieldIndex + 0.5;
  });
  return hits
    .map((hit, index) => ({ hit, key: keys[index] ?? index }))
    .toSorted((a, b) => a.key - b.key)
    .map((entry) => entry.hit);
}
