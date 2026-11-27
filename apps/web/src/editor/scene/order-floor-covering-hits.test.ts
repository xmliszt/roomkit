import {
  BoxGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  Raycaster,
  Scene,
  Vector3,
} from "three";
import { expect, test } from "vitest";
import { orderFloorCoveringHits } from "./order-floor-covering-hits.ts";

type Box = {
  name: string;
  x: number;
  z: number;
  elevationM: number;
  sizeM: { width: number; height: number; depth: number };
};

const rug = {
  name: "Rug",
  x: 0,
  z: 0,
  elevationM: 0.001,
  sizeM: { width: 2, height: 0.01, depth: 1.4 },
};
const table = {
  name: "Table",
  x: 0,
  z: 0.9,
  elevationM: 0,
  sizeM: { width: 0.6, height: 0.5, depth: 0.6 },
};
const tray = {
  name: "Tray",
  x: 0,
  z: 0.9,
  elevationM: 0.501,
  sizeM: { width: 0.4, height: 0.02, depth: 0.3 },
};
const backSofa = {
  name: "Sofa",
  x: 0,
  z: 0,
  elevationM: 0,
  sizeM: { width: 2, height: 0.8, depth: 0.9 },
};

function pickFirst(options: {
  boxes: Box[];
  cameraM: [number, number, number];
  targetM: [number, number, number];
}) {
  const scene = new Scene();
  for (const box of options.boxes) {
    const group = new Group();
    group.position.set(box.x, box.elevationM, box.z);
    const mesh = new Mesh(
      new BoxGeometry(box.sizeM.width, box.sizeM.height, box.sizeM.depth),
      new MeshBasicMaterial(),
    );
    mesh.name = box.name;
    mesh.position.set(0, box.sizeM.height / 2, 0);
    mesh.userData = {
      itemPick: true,
      floorCovering: box.sizeM.height <= 0.03,
      bottomYM: box.elevationM,
      topYM: box.elevationM + box.sizeM.height,
    };
    group.add(mesh);
    scene.add(group);
  }
  scene.updateMatrixWorld(true);
  const origin = new Vector3(...options.cameraM);
  const hits = new Raycaster(
    origin,
    new Vector3(...options.targetM).sub(origin).normalize(),
  ).intersectObjects(scene.children, true);
  return orderFloorCoveringHits(hits).at(0)?.object.name;
}

test.each([
  {
    label: "angled tray on a table with a sofa behind",
    boxes: [rug, table, tray, backSofa],
    cameraM: [0, 1.6, 3.1],
    targetM: [0, 0.52, 0.85],
    expected: "Tray",
  },
  {
    label: "top-down tray",
    boxes: [rug, table, tray, backSofa],
    cameraM: [0, 6, 0.9],
    targetM: [0, 0.52, 0.9],
    expected: "Tray",
  },
  {
    label: "tray sunk 1 cm into its table",
    boxes: [table, { ...tray, elevationM: 0.49 }],
    cameraM: [0, 1.6, 3.1],
    targetM: [0, 0.5, 0.85],
    expected: "Tray",
  },
  {
    label: "low camera through a rug into the sofa standing on it",
    boxes: [
      rug,
      { ...backSofa, x: 0.5, sizeM: { width: 1, height: 0.8, depth: 1.4 } },
    ],
    cameraM: [-3, 0.3, 0],
    targetM: [0, 0.006, 0],
    expected: "Sofa",
  },
  {
    label: "exposed rug",
    boxes: [rug, backSofa],
    cameraM: [0, 6, 0.6],
    targetM: [0, 0, 0.6],
    expected: "Rug",
  },
] satisfies {
  label: string;
  boxes: Box[];
  cameraM: [number, number, number];
  targetM: [number, number, number];
  expected: string;
}[])("$label picks $expected", (options) => {
  expect(pickFirst(options)).toBe(options.expected);
});
