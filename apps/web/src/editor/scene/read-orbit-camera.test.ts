import { CameraControlsImpl } from "@react-three/drei";
import * as THREE from "three";
import { afterEach, expect, it, vi } from "vitest";
import { readOrbitCamera } from "./read-orbit-camera.ts";

afterEach(() => vi.unstubAllGlobals());

it("captures the displayed orbit pose during easing instead of its destination", () => {
  vi.stubGlobal(
    "DOMRect",
    class {
      x: number;
      y: number;
      width: number;
      height: number;
      constructor(x = 0, y = 0, width = 0, height = 0) {
        this.x = x;
        this.y = y;
        this.width = width;
        this.height = height;
      }
    },
  );
  CameraControlsImpl.install({ THREE });
  const camera = new THREE.PerspectiveCamera();
  const controls = new CameraControlsImpl(camera);
  controls.setLookAt(0, 3, 6, 0, 0.8, 0, false);
  controls.update(0);
  controls.rotate(Math.PI / 2, 0, true);
  controls.truck(2, 0, true);
  controls.update(1 / 60);
  const saved = readOrbitCamera(controls);
  expect(saved.position.toArray()).toEqual(camera.position.toArray());
  expect(saved.target.toArray()).toEqual(
    controls.getTarget(new THREE.Vector3(), false).toArray(),
  );
  expect(
    saved.position.distanceTo(controls.getPosition(new THREE.Vector3(), true)),
  ).toBeGreaterThan(1);
  expect(
    saved.target.distanceTo(controls.getTarget(new THREE.Vector3(), true)),
  ).toBeGreaterThan(1);
  controls.setLookAt(0, 1.6, 0, 0, 1.6, -1, false);
  controls.setLookAt(
    saved.position.x,
    saved.position.y,
    saved.position.z,
    saved.target.x,
    saved.target.y,
    saved.target.z,
    false,
  );
  controls.update(0);
  expect(camera.position.distanceTo(saved.position)).toBeLessThan(1e-12);
  controls.dispose();
});
