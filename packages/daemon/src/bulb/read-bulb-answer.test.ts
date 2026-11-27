import { expect, test } from "vitest";
import { readBulbAnswer } from "./read-bulb-answer.ts";

const down = { direction: { x: 0, y: -1, z: 0 }, angleDeg: 90 };

test.each([
  [
    '{"x": 0.2, "y": 0.8, "z": 0.5, "beam": {"direction": {"x": 0, "y": -1, "z": 0}, "angleDeg": 90}, "shade": "translucent", "lumens": 200}',
    {
      emitter: { x: 0.2, y: 0.8, z: 0.5 },
      beam: down,
      shade: "translucent",
      lumens: 200,
    },
  ],
  [
    '{"x": 0.2, "y": 0.8, "z": 0.5, "beam": null, "shade": "glass", "lumens": -5}',
    {
      emitter: { x: 0.2, y: 0.8, z: 0.5 },
      beam: null,
      shade: undefined,
      lumens: undefined,
    },
  ],
  [
    'Front view first: {"x": 0.1}. Answer:\n```json\n{"x": 0.25, "y": 0.9, "z": 0.4, "beam": null}\n```',
    {
      emitter: { x: 0.25, y: 0.9, z: 0.4 },
      beam: null,
      shade: undefined,
      lumens: undefined,
    },
  ],
  [
    '{"x": 0.2, "y": 0.8, "z": 0.5, "beam": {"direction": {"x": 0, "y": -2, "z": 0}, "angleDeg": 90}}',
    {
      emitter: { x: 0.2, y: 0.8, z: 0.5 },
      beam: down,
      shade: undefined,
      lumens: undefined,
    },
  ],
  [
    '{"x": 0.2, "y": 0.8, "z": 0.5, "beam": {"direction": {"x": 0, "y": -1, "z": 0}, "angleDeg": 400}}',
    {
      emitter: { x: 0.2, y: 0.8, z: 0.5 },
      beam: undefined,
      shade: undefined,
      lumens: undefined,
    },
  ],
  [
    '{"x": 0.2, "y": 0.8, "z": 0.5}',
    {
      emitter: { x: 0.2, y: 0.8, z: 0.5 },
      beam: undefined,
      shade: undefined,
      lumens: undefined,
    },
  ],
  ['{"x": 0.2, "y": 1.4, "z": 0.5}', undefined],
  ["The bulb is under the dome.", undefined],
])("reads %j", (text, expected) => {
  expect(readBulbAnswer(text)).toStrictEqual(expected);
});
