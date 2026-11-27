import { Group, Object3D } from "three";
import { expect, test } from "vitest";
import { isLightEmitterVisible } from "./is-light-emitter-visible.ts";

test("a hidden item or ancestor hides its emitter", () => {
  const wall = new Group();
  const item = new Group();
  const emitter = new Object3D();
  wall.add(item);
  item.add(emitter);
  expect(isLightEmitterVisible(emitter)).toBe(true);
  item.visible = false;
  expect(isLightEmitterVisible(emitter)).toBe(false);
  item.visible = true;
  wall.visible = false;
  expect(isLightEmitterVisible(emitter)).toBe(false);
  wall.visible = true;
  emitter.visible = false;
  expect(isLightEmitterVisible(emitter)).toBe(false);
  expect(isLightEmitterVisible(undefined)).toBe(false);
});
