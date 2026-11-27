import { CameraControlsImpl } from "@react-three/drei";
import * as THREE from "three";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { CameraReport } from "./camera-report.ts";
import { createOrbitMoveReporter } from "./create-orbit-move-reporter.ts";

beforeEach(() => {
  vi.useFakeTimers();
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
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function buildReporter(options: { walkingRef: { current: boolean } }) {
  const controls = new CameraControlsImpl(new THREE.PerspectiveCamera());
  controls.setLookAt(0, 3, 6, 0, 0.8, 0, false);
  controls.update(0);
  const reports: CameraReport[] = [];
  const reporter = createOrbitMoveReporter({
    controls,
    movedRef: { current: false },
    isWalking: () => options.walkingRef.current,
    delayMs: 300,
    onReport: (report) => reports.push(report),
  });
  return { controls, reporter, reports };
}

it("reports a settled orbit move after the delay", () => {
  const { controls, reporter, reports } = buildReporter({
    walkingRef: { current: false },
  });
  reporter.startMove();
  controls.setLookAt(1, 3, 6, 1, 0.8, 0, false);
  controls.update(0);
  reporter.scheduleReport();
  vi.advanceTimersByTime(299);
  expect(reports).toEqual([]);
  vi.advanceTimersByTime(1);
  expect(reports).toEqual([
    {
      kind: "moved",
      camera: {
        positionM: { x: 1, y: 3, z: 6 },
        targetM: { x: 1, y: 0.8, z: 0 },
      },
    },
  ]);
});

it("flushes an unsaved move's destination once, then reports nothing while walking", () => {
  const walkingRef = { current: false };
  const { controls, reporter, reports } = buildReporter({ walkingRef });
  reporter.startMove();
  controls.setLookAt(2, 3, 6, 2, 0.8, 0, true);
  reporter.flush();
  walkingRef.current = true;
  controls.setLookAt(0, 1.6, 0, 0, 1.6, -1, false);
  controls.update(0);
  reporter.startMove();
  reporter.scheduleReport();
  reporter.flush();
  vi.advanceTimersByTime(1000);
  expect(reports).toEqual([
    {
      kind: "moved",
      camera: {
        positionM: { x: 2, y: 3, z: 6 },
        targetM: { x: 2, y: 0.8, z: 0 },
      },
    },
  ]);
  controls.dispose();
});
