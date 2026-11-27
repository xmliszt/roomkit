import type { ReconstructionJob } from "@planner/shared/src/jobs/job-schema.ts";
import type { Room } from "@planner/shared/src/scene/room-schema.ts";
import { Line } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useReducedMotion } from "motion/react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { type Group, type Material, Mesh } from "three";
import type { Line2 } from "three/examples/jsm/lines/Line2.js";
import { getDaemonUrl } from "../../daemon-http/get-daemon-url.ts";
import { createGenerationPoints } from "../generation/create-generation-points.ts";
import { readSurfacePoints } from "../generation/read-surface-points.ts";
import { useTokenColors } from "../scene/use-token-colors.ts";
import {
  createRoomReconstruction,
  type RoomReconstructionFrame,
} from "./create-room-reconstruction.ts";

type RoomReconstructionProps = {
  projectId: string;
  room: Room;
  job: ReconstructionJob | undefined;
  onFrame: (frame: RoomReconstructionFrame) => void;
  children: ReactNode;
};

export function RoomReconstruction(props: RoomReconstructionProps) {
  const reduced = useReducedMotion() === true;
  const tokens = useTokenColors();
  const [animation] = useState(createRoomReconstruction);
  const shell = useRef<Group>(null);
  const outline = useRef<Line2>(null);
  const materials = useRef<
    {
      material: Material;
      opacity: number;
      transparent: boolean;
      depthWrite: boolean;
    }[]
  >([]);
  const [cloud, setCloud] = useState<{
    jobId: string;
    points: ReturnType<typeof readSurfacePoints> | undefined;
  }>();
  const jobId = props.job?.id;
  const ready = props.job?.pointCloudReady === true;
  const failed =
    props.job?.stage === "failed" || props.job?.stage === "cancelled";
  useEffect(() => {
    if (!jobId || !ready || failed) {
      setCloud(undefined);
      return;
    }
    const controller = new AbortController();
    const signal = AbortSignal.any([
      controller.signal,
      AbortSignal.timeout(10000),
    ]);
    fetch(
      getDaemonUrl({
        path: `/projects/${props.projectId}/reconstruction/${jobId}/points.bin`,
      }),
      { signal },
    )
      .then((response) => {
        if (!response.ok) throw new Error("Room points unavailable");
        return response.arrayBuffer();
      })
      .then(readSurfacePoints)
      .then((points) => {
        if (!controller.signal.aborted) setCloud({ jobId, points });
      })
      .catch(() => {
        if (!controller.signal.aborted) setCloud({ jobId, points: undefined });
      });
    return () => controller.abort();
  }, [props.projectId, jobId, ready, failed]);
  const data = cloud?.jobId === jobId && !failed ? cloud?.points : undefined;
  const points = useMemo(
    () =>
      data
        ? createGenerationPoints({
            placementKind: "floor",
            sizeM: { width: 1, height: 1, depth: 1 },
            accent: tokens.accent,
            gatherFromSurface: true,
            surface: data,
          })
        : undefined,
    [data, tokens.accent],
  );
  useEffect(
    () => () => {
      points?.geometry.dispose();
      points?.material.dispose();
    },
    [points],
  );
  useEffect(
    () => () => {
      for (const stored of materials.current) {
        stored.material.opacity = stored.opacity;
        stored.material.transparent = stored.transparent;
        stored.material.depthWrite = stored.depthWrite;
        stored.material.needsUpdate = true;
      }
    },
    [],
  );
  const floor = props.room.walls.map((wall): [number, number, number] => [
    wall.startM.x,
    0.008,
    wall.startM.z,
  ]);
  if (floor.at(0)) floor.push(floor.at(0) ?? [0, 0, 0]);
  const perimeterM = props.room.walls.reduce((length, wall, index, walls) => {
    const next = walls.at((index + 1) % walls.length);
    return (
      length +
      (next
        ? Math.hypot(
            next.startM.x - wall.startM.x,
            next.startM.z - wall.startM.z,
          )
        : 0)
    );
  }, 0);
  const roomKey = JSON.stringify([props.room.walls, props.room.ceilingHeightM]);
  useFrame((state) => {
    const frame = animation.tick({
      job: props.job,
      roomKey,
      nowMs: performance.now(),
      reduced,
      cloud:
        !ready || failed
          ? "missing"
          : cloud?.jobId !== jobId
            ? "pending"
            : data
              ? "ready"
              : "missing",
    });
    props.onFrame(frame);
    if (shell.current) {
      shell.current.visible = frame.opacity > 0;
      shell.current.scale.y = reduced ? 1 : Math.max(0.0001, frame.height);
      shell.current.traverse((object) => {
        if (!(object instanceof Mesh)) return;
        for (const material of Array.isArray(object.material)
          ? object.material
          : [object.material]) {
          let stored = materials.current.find(
            (entry) => entry.material === material,
          );
          if (!stored) {
            stored = {
              material,
              opacity: material.opacity,
              transparent: material.transparent,
              depthWrite: material.depthWrite,
            };
            materials.current.push(stored);
          }
          material.opacity = stored.opacity * frame.opacity;
          const transparent = stored.transparent || frame.opacity < 1;
          if (material.transparent !== transparent) {
            material.transparent = transparent;
            material.needsUpdate = true;
          }
          material.depthWrite = frame.opacity < 1 ? false : stored.depthWrite;
        }
      });
    }
    if (outline.current) {
      outline.current.visible =
        !reduced && frame.floorProgress > 0 && frame.stage !== "complete";
      outline.current.material.dashSize = perimeterM * frame.floorProgress;
    }
    if (points) {
      points.visible = frame.pointsOpacity > 0;
      const uniforms = points.material.uniforms;
      if (uniforms.uT) uniforms.uT.value = reduced ? 1 : 0;
      if (uniforms.uProg) uniforms.uProg.value = 1.3;
      if (uniforms.uFocus) uniforms.uFocus.value = 0.8;
      if (uniforms.uAlpha) uniforms.uAlpha.value = frame.pointsOpacity;
      if (uniforms.uTime)
        uniforms.uTime.value = reduced ? 0 : state.clock.elapsedTime;
      if (uniforms.uDpr) uniforms.uDpr.value = state.gl.getPixelRatio();
    }
    if (frame.stage !== "complete") state.invalidate();
  }, -1);
  return (
    <>
      {points && <primitive object={points} />}
      <Line
        ref={outline}
        points={floor}
        color={tokens.ink}
        lineWidth={1}
        dashed
        dashSize={0}
        gapSize={Math.max(1, perimeterM * 2)}
        transparent
        opacity={0.6}
        raycast={() => {}}
      />
      <group
        ref={shell}
        visible={
          !props.job ||
          ["done", "failed", "cancelled"].includes(props.job.stage)
        }
      >
        {props.children}
      </group>
    </>
  );
}
