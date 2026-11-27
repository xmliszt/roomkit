import { GENERATION_POINTS } from "./appearance-timing.ts";

/** Return `NEXT_PUBLIC_PLANNER_MAX_APPEARING` when it is a positive integer, else `GENERATION_POINTS.maxAnimating`. */
export function getMaxAnimating() {
  const override = Number(process.env.NEXT_PUBLIC_PLANNER_MAX_APPEARING);
  return Number.isInteger(override) && override > 0
    ? override
    : GENERATION_POINTS.maxAnimating;
}
