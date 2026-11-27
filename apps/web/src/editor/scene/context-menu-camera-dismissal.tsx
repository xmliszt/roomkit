import { CameraControlsImpl } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";

type ContextMenuCameraDismissalProps = { onMove: () => void };

export function ContextMenuCameraDismissal(
  props: ContextMenuCameraDismissalProps,
) {
  const controls = useThree((state) => state.controls);
  const onMoveRef = useRef(props.onMove);
  useEffect(() => {
    onMoveRef.current = props.onMove;
  }, [props.onMove]);
  useEffect(() => {
    if (!(controls instanceof CameraControlsImpl)) return;
    function closeOnCameraMoveStart() {
      onMoveRef.current();
    }
    controls.addEventListener("control", closeOnCameraMoveStart);
    controls.addEventListener("transitionstart", closeOnCameraMoveStart);
    return () => {
      controls.removeEventListener("control", closeOnCameraMoveStart);
      controls.removeEventListener("transitionstart", closeOnCameraMoveStart);
    };
  }, [controls]);
  return null;
}
