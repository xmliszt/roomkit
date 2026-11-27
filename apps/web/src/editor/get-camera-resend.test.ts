import { createRectangularScene } from "@planner/shared/src/scene/create-rectangular-scene.ts";
import { expect, test } from "vitest";
import { getCameraResend } from "./get-camera-resend.ts";

const scene = createRectangularScene({
  widthM: 4,
  depthM: 4,
  ceilingHeightM: 2.5,
});
const moved = {
  positionM: { x: 5, y: 5, z: 5 },
  targetM: { x: 0, y: 1, z: 0 },
};
const other = {
  positionM: { x: -7, y: 4, z: 6 },
  targetM: { x: 0, y: 1, z: 0 },
};

function buildEntry(options: { camera: typeof moved; isStale: boolean }) {
  return {
    isStale: options.isStale,
    project: {
      id: "00000000-0000-4000-8000-000000000000",
      name: "Room",
      revision: 1,
      scene: { ...scene, camera: options.camera },
    },
  };
}

test("a reopen that lost the moved camera sends it again", () => {
  expect(
    getCameraResend({
      previous: buildEntry({ camera: scene.camera, isStale: true }),
      current: buildEntry({ camera: scene.camera, isStale: false }),
      moved,
      pendingRequestCount: 0,
    }),
  ).toEqual({ kind: "resend", camera: moved });
});

test("a reopen that already holds the moved camera forgets it", () => {
  expect(
    getCameraResend({
      previous: buildEntry({ camera: moved, isStale: true }),
      current: buildEntry({ camera: moved, isStale: false }),
      moved,
      pendingRequestCount: 0,
    }),
  ).toEqual({ kind: "forget" });
});

test("a newer camera saved by another writer forgets the moved one", () => {
  expect(
    getCameraResend({
      previous: buildEntry({ camera: moved, isStale: false }),
      current: buildEntry({ camera: other, isStale: false }),
      moved,
      pendingRequestCount: 0,
    }),
  ).toEqual({ kind: "forget" });
});

test("a moved camera still in flight is kept", () => {
  expect(
    getCameraResend({
      previous: buildEntry({ camera: scene.camera, isStale: false }),
      current: buildEntry({ camera: moved, isStale: false }),
      moved,
      pendingRequestCount: 1,
    }),
  ).toEqual({ kind: "keep" });
  expect(
    getCameraResend({
      previous: buildEntry({ camera: moved, isStale: false }),
      current: buildEntry({ camera: moved, isStale: true }),
      moved,
      pendingRequestCount: 0,
    }),
  ).toEqual({ kind: "keep" });
});
