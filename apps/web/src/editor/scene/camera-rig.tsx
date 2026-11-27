import type { Camera } from "@planner/shared/src/scene/camera-schema.ts";
import { createRectangularScene } from "@planner/shared/src/scene/create-rectangular-scene.ts";
import type { Item } from "@planner/shared/src/scene/item-schema.ts";
import type { Placement } from "@planner/shared/src/scene/placement-schema.ts";
import type { Room } from "@planner/shared/src/scene/room-schema.ts";
import { CameraControls } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Box3, PerspectiveCamera, Sphere, Vector3 } from "three";
import type { Vec3 } from "../../items/vec3.ts";
import { getRoomBounds } from "../../room/get-room-bounds.ts";
import { hasRoomBoundsChanged } from "../../room/has-room-bounds-changed.ts";
import { isGeneratedCamera } from "../../room/is-generated-camera.ts";
import { isRoomCameraInvalid } from "../../room/is-room-camera-invalid.ts";
import type { FrameTarget } from "../frame-target.ts";
import { CameraNavigation } from "./camera-navigation.tsx";
import type { CameraReport } from "./camera-report.ts";
import { createOrbitMoveReporter } from "./create-orbit-move-reporter.ts";
import { readOrbitCamera } from "./read-orbit-camera.ts";
import { toCameraVec3 } from "./to-camera-vec3.ts";
import { WalkNavigation } from "./walk-navigation.tsx";

const saveDelayMs = 300;
const framingTargetHeightShare = 0.3;

type CameraRigProps = {
  walking: boolean;
  lensMm: number;
  initialCamera: Camera;
  room: Room;
  reconstructionJobId: string | undefined;
  frameRequest: number;
  frameTarget: FrameTarget;
  selectedItem: Item | undefined;
  snapping: boolean;
  getItem: (itemId: string) => Item | undefined;
  onPreview: (
    input: { itemId: string; placement: Placement } | undefined,
  ) => void;
  onCommit: (input: { itemId: string; placement: Placement }) => void;
  frameSphere: { centerM: Vec3; radiusM: number } | undefined;
  onMoveStart: () => void;
  onReport: (report: CameraReport) => void;
};

function getRoomSphere(room: Room) {
  const bounds = getRoomBounds(room);
  const sphere = new Box3(
    new Vector3(bounds.minX, 0, bounds.minZ),
    new Vector3(bounds.maxX, room.ceilingHeightM, bounds.maxZ),
  ).getBoundingSphere(new Sphere());
  sphere.center.y = room.ceilingHeightM * framingTargetHeightShare;
  return sphere;
}

export function CameraRig(props: CameraRigProps) {
  const [ready, setReady] = useState(false);
  const walkingRef = useRef(props.walking);
  const controlsRef = useRef<CameraControls>(null);
  const onReportRef = useRef(props.onReport);
  const onMoveStartRef = useRef(props.onMoveStart);
  const roomRef = useRef(props.room);
  const frameSphereRef = useRef(props.frameSphere);
  const initialCameraRef = useRef(props.initialCamera);
  const previousRoomRef = useRef(props.room);
  const reconstructionJobIdRef = useRef(props.reconstructionJobId);
  const handledFrameRequestRef = useRef(props.frameRequest);
  const hasUnreportedMoveRef = useRef(false);
  const needsFrameRef = useRef(false);
  const reporterRef = useRef<
    ReturnType<typeof createOrbitMoveReporter> | undefined
  >(undefined);
  const camera = useThree((state) => state.camera);
  const invalidate = useThree((state) => state.invalidate);
  const radiusM = useMemo(() => getRoomSphere(props.room).radius, [props.room]);

  const frameRoom = useCallback((smooth = false) => {
    const controls = controlsRef.current;
    if (controls === null || walkingRef.current) return;
    const room = roomRef.current;
    const bounds = getRoomBounds(room);
    const { positionM, targetM } = createRectangularScene({
      widthM: bounds.maxX - bounds.minX,
      depthM: bounds.maxZ - bounds.minZ,
      ceilingHeightM: room.ceilingHeightM,
    }).camera;
    const centerX = (bounds.minX + bounds.maxX) / 2;
    const centerZ = (bounds.minZ + bounds.maxZ) / 2;
    const previousPosition = controls.getPosition(new Vector3(), true);
    const previousTarget = controls.getTarget(new Vector3(), true);
    controls.setLookAt(
      positionM.x + centerX,
      positionM.y,
      positionM.z + centerZ,
      centerX,
      targetM.y,
      centerZ,
      smooth,
    );
    controls.fitToSphere(getRoomSphere(room), smooth);
    const position = controls.getPosition(new Vector3(), true);
    const target = controls.getTarget(new Vector3(), true);
    if (!previousPosition.equals(position) || !previousTarget.equals(target))
      onMoveStartRef.current();
    if (smooth) {
      hasUnreportedMoveRef.current = true;
      return;
    }
    hasUnreportedMoveRef.current = false;
    onReportRef.current({
      kind: "moved",
      camera: {
        positionM: toCameraVec3(position),
        targetM: toCameraVec3(target),
      },
    });
  }, []);

  useEffect(() => {
    onReportRef.current = props.onReport;
    onMoveStartRef.current = props.onMoveStart;
    roomRef.current = props.room;
    frameSphereRef.current = props.frameSphere;
  });

  useEffect(() => {
    if (!(camera instanceof PerspectiveCamera)) return;
    const previousFarM = camera.far;
    camera.far = Math.max(previousFarM, radiusM * 30);
    camera.updateProjectionMatrix();
    invalidate();
    return () => {
      camera.far = previousFarM;
      camera.updateProjectionMatrix();
    };
  }, [camera, radiusM, invalidate]);

  useEffect(() => {
    const controls = controlsRef.current;
    if (controls === null) return;
    const { positionM, targetM } = initialCameraRef.current;
    const reporter = createOrbitMoveReporter({
      controls,
      movedRef: hasUnreportedMoveRef,
      isWalking: () => walkingRef.current,
      delayMs: saveDelayMs,
      onReport: (report) => onReportRef.current(report),
    });
    reporterRef.current = reporter;
    const needsFrame = isRoomCameraInvalid({
      room: roomRef.current,
      camera: initialCameraRef.current,
    });
    if (needsFrame) {
      frameRoom();
    } else {
      controls.setLookAt(
        positionM.x,
        positionM.y,
        positionM.z,
        targetM.x,
        targetM.y,
        targetM.z,
        false,
      );
      if (
        isGeneratedCamera({
          room: roomRef.current,
          camera: initialCameraRef.current,
        })
      ) {
        controls.fitToSphere(getRoomSphere(roomRef.current), false);
      }
      onReportRef.current({
        kind: "loaded",
        camera: {
          positionM: toCameraVec3(controls.getPosition(new Vector3())),
          targetM: toCameraVec3(controls.getTarget(new Vector3())),
        },
      });
    }
    setReady(true);
    controls.addEventListener("controlstart", reporter.startMove);
    controls.addEventListener("control", reporter.startMove);
    controls.addEventListener("controlend", reporter.scheduleReport);
    controls.addEventListener("rest", reporter.scheduleReport);
    window.addEventListener("pagehide", reporter.flush);
    return () => {
      reporter.flush();
      reporterRef.current = undefined;
      window.removeEventListener("pagehide", reporter.flush);
      controls.removeEventListener("controlstart", reporter.startMove);
      controls.removeEventListener("control", reporter.startMove);
      controls.removeEventListener("controlend", reporter.scheduleReport);
      controls.removeEventListener("rest", reporter.scheduleReport);
    };
  }, [frameRoom]);

  useLayoutEffect(() => {
    const controls = controlsRef.current;
    if (props.walking && controls !== null) {
      const { position, target } = readOrbitCamera(controls);
      controls.setLookAt(
        position.x,
        position.y,
        position.z,
        target.x,
        target.y,
        target.z,
        false,
      );
      reporterRef.current?.flush();
    }
    walkingRef.current = props.walking;
  }, [props.walking]);

  useEffect(() => {
    if (props.walking || !needsFrameRef.current) return;
    needsFrameRef.current = false;
    frameRoom();
  }, [props.walking, frameRoom]);

  useEffect(() => {
    const shouldFrame =
      hasRoomBoundsChanged({
        previous: previousRoomRef.current,
        current: props.room,
      }) ||
      (props.reconstructionJobId !== undefined &&
        props.reconstructionJobId !== reconstructionJobIdRef.current);
    previousRoomRef.current = props.room;
    reconstructionJobIdRef.current = props.reconstructionJobId;
    if (!shouldFrame) return;
    if (walkingRef.current) needsFrameRef.current = true;
    else frameRoom();
  }, [props.room, props.reconstructionJobId, frameRoom]);

  useEffect(() => {
    const controls = controlsRef.current;
    if (props.walking) {
      handledFrameRequestRef.current = props.frameRequest;
      return;
    }
    if (
      props.frameRequest === handledFrameRequestRef.current ||
      controls === null
    )
      return;
    handledFrameRequestRef.current = props.frameRequest;
    hasUnreportedMoveRef.current = true;
    const frameSphere = frameSphereRef.current;
    if (props.frameTarget !== "selection" || frameSphere === undefined) {
      frameRoom(true);
      return;
    }
    controls.fitToSphere(
      new Sphere(
        new Vector3(
          frameSphere.centerM.x,
          frameSphere.centerM.y,
          frameSphere.centerM.z,
        ),
        frameSphere.radiusM,
      ),
      true,
    );
  }, [props.frameRequest, props.frameTarget, props.walking, frameRoom]);

  return (
    <>
      <CameraControls
        ref={controlsRef}
        makeDefault
        enabled={!props.walking}
        minDistance={0.5}
        maxDistance={Math.max(40, radiusM * 8)}
        maxPolarAngle={props.walking ? Math.PI : 1.45}
        dollyToCursor
      />
      {props.walking ? (
        ready && (
          <WalkNavigation
            controlsRef={controlsRef}
            room={props.room}
            lensMm={props.lensMm}
            onReport={props.onReport}
          />
        )
      ) : (
        <CameraNavigation
          controlsRef={controlsRef}
          movedRef={hasUnreportedMoveRef}
          room={props.room}
          selectedItem={props.selectedItem}
          snapping={props.snapping}
          getItem={props.getItem}
          onPreview={props.onPreview}
          onCommit={props.onCommit}
        />
      )}
    </>
  );
}
