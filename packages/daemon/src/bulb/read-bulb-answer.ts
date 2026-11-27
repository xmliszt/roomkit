import {
  BeamSchema,
  LightSchema,
} from "@planner/shared/src/scene/light-schema.ts";

import { z } from "zod";

const AnswerBeamSchema = z.object({
  direction: z.object({ x: z.number(), y: z.number(), z: z.number() }),
  angleDeg: z.number(),
});

function readBeam(value: unknown) {
  if (value === null) return null;
  const beam = AnswerBeamSchema.safeParse(value).data;
  if (beam === undefined) return undefined;
  const { x, y, z } = beam.direction;
  const length = Math.hypot(x, y, z);
  return BeamSchema.safeParse({
    direction: { x: x / length, y: y / length, z: z / length },
    angleDeg: beam.angleDeg,
  }).data;
}

/** Return the emitter and beam in the last `{...}` JSON object of `text` whose `x`, `y` and `z` pass `LightSchema.shape.emitter`, or `undefined` when there is none. `beam` is `null` for an answer of no beam, and `undefined` when the answer has no valid beam; `shade` and `lumens` are `undefined` when missing or invalid. */
export function readBulbAnswer(text: string) {
  const candidates = [
    ...text.matchAll(/\{(?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*\}/g),
  ].map((match) => match[0]);
  return candidates
    .toReversed()
    .map((candidate) => {
      try {
        const parsed: unknown = JSON.parse(candidate);
        if (typeof parsed !== "object" || parsed === null) return undefined;
        const emitter = LightSchema.shape.emitter.safeParse({
          x: "x" in parsed ? parsed.x : undefined,
          y: "y" in parsed ? parsed.y : undefined,
          z: "z" in parsed ? parsed.z : undefined,
        }).data;
        if (emitter === undefined) return undefined;
        return {
          emitter,
          beam: "beam" in parsed ? readBeam(parsed.beam) : undefined,
          shade: LightSchema.shape.shade.safeParse(
            "shade" in parsed ? parsed.shade : undefined,
          ).data,
          lumens: LightSchema.shape.lumens.safeParse(
            "lumens" in parsed ? parsed.lumens : undefined,
          ).data,
        };
      } catch {
        return undefined;
      }
    })
    .find((answer) => answer !== undefined);
}
