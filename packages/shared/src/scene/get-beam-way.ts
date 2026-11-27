import type { Light } from "./light-schema.ts";

/** Return "down" or "up" for a vertical `beam`, "angled" for any other beam, and "all" when there is no beam. */
export function getBeamWay(beam: Light["beam"]) {
  if (beam === undefined) return "all";
  if (beam.direction.y <= -0.99) return "down";
  if (beam.direction.y >= 0.99) return "up";
  return "angled";
}
