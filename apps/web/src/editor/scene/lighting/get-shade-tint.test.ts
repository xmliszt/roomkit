import { BoxGeometry, Group, Mesh, MeshStandardMaterial, Vector3 } from "three";
import { expect, test } from "vitest";
import { getShadeTint } from "./get-shade-tint.ts";

test("averages the base colour of the shade around the bulb and leaves out the stand below", () => {
  const model = new Group();
  const dome = new Mesh(
    new BoxGeometry(0.16, 0.08, 0.16),
    new MeshStandardMaterial({ color: "#ff8000" }),
  );
  dome.position.set(0, 0.18, 0);
  const stand = new Mesh(
    new BoxGeometry(0.04, 0.12, 0.04),
    new MeshStandardMaterial({ color: "#808080" }),
  );
  stand.position.set(0, 0.06, 0);
  model.add(dome, stand);
  const tint = getShadeTint({
    model,
    centreM: new Vector3(0, 0.14, 0),
    direction: new Vector3(0, -1, 0),
    radiusM: 0.12,
  });
  expect(tint?.getHexString()).toBe("ff8000");
});

test("returns undefined when nothing is near the bulb", () => {
  const model = new Group();
  model.add(
    new Mesh(new BoxGeometry(0.1, 0.1, 0.1), new MeshStandardMaterial()),
  );
  expect(
    getShadeTint({
      model,
      centreM: new Vector3(5, 5, 5),
      direction: new Vector3(),
      radiusM: 0.1,
    }),
  ).toBeUndefined();
});

test("reads the model in its own frame when it sits under a moved, scaled parent", () => {
  const placed = new Group();
  placed.position.set(1.4, 0.38, 1.4);
  placed.scale.set(2, 2, 2);
  const model = new Group();
  const dome = new Mesh(
    new BoxGeometry(0.16, 0.08, 0.16),
    new MeshStandardMaterial({ color: "#ff8000" }),
  );
  dome.position.set(0, 0.18, 0);
  model.add(dome);
  placed.add(model);
  expect(
    getShadeTint({
      model,
      centreM: new Vector3(0, 0.14, 0),
      direction: new Vector3(0, -1, 0),
      radiusM: 0.12,
    })?.getHexString(),
  ).toBe("ff8000");
});
