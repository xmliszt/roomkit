import type { RenderView } from "@planner/shared/src/render/render-view-schema.ts";
import type { Room } from "@planner/shared/src/scene/room-schema.ts";
import { useFrame, useThree } from "@react-three/fiber";
import { type RefObject, useEffect, useRef } from "react";
import { PerspectiveCamera, Vector3 } from "three";
import { useStore } from "zustand";
import { usePlannerSession } from "../../planner/use-planner-session.ts";
import { getWallSegments } from "../../room/get-wall-segments.ts";
import { getWallVisibility } from "../../room/get-wall-visibility.ts";
import { isCeilingVisible } from "./is-ceiling-visible.ts";

type RenderBridgeProps = {
  projectId: string;
  room: Room;
  walking: boolean;
  readViewRef: RefObject<(() => RenderView) | undefined>;
};

export function RenderBridge(props: RenderBridgeProps) {
  const session = usePlannerSession();
  const connectionAt = useStore(session.stores.snapshot, (state) => state.at);
  const invalidate = useThree((state) => state.invalidate);
  const camera = useThree((state) => state.camera);
  const size = useThree((state) => state.size);
  const previous = useRef("");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    const ref = props.readViewRef;
    function readView(): RenderView {
      if (!(camera instanceof PerspectiveCamera))
        throw new Error("A perspective view is required");
      const direction = camera.getWorldDirection(new Vector3());
      const segments = getWallSegments(props.room);
      const { drawn } = getWallVisibility({
        segments,
        cameraM: camera.position,
      });
      return {
        positionM: {
          x: camera.position.x,
          y: camera.position.y,
          z: camera.position.z,
        },
        targetM: {
          x: camera.position.x + direction.x,
          y: camera.position.y + direction.y,
          z: camera.position.z + direction.z,
        },
        fovDeg: camera.fov,
        aspect: size.width / size.height,
        mode: props.walking ? "walk" : "orbit",
        hiddenSurfaceIds: [
          ...segments.flatMap((segment, index) =>
            !props.walking && !drawn[index] ? [segment.wall.id] : [],
          ),
          ...(isCeilingVisible({ room: props.room, cameraM: camera.position })
            ? []
            : ["ceiling"]),
        ],
      };
    }
    ref.current = readView;
    previous.current = "";
    invalidate();
    return () => {
      ref.current = undefined;
      clearTimeout(timer.current);
    };
  }, [
    camera,
    props.readViewRef,
    props.room,
    props.walking,
    size.width,
    size.height,
    invalidate,
  ]);
  useEffect(() => {
    if (connectionAt === undefined) return;
    previous.current = "";
    invalidate();
    return () => clearTimeout(timer.current);
  }, [connectionAt, invalidate]);
  useFrame(() => {
    const view = props.readViewRef.current?.();
    const signature = JSON.stringify(view);
    if (!view || signature === previous.current) return;
    previous.current = signature;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void session
        .command({ type: "view.report", projectId: props.projectId, view })
        .catch(() => undefined);
    }, 300);
  });
  return null;
}
