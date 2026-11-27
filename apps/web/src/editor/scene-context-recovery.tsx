import { addAfterEffect, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";

type SceneContextRecoveryProps = {
  onRestoring: (restoring: boolean) => void;
  onRemount: () => void;
};

export function SceneContextRecovery(props: SceneContextRecoveryProps) {
  const gl = useThree((state) => state.gl);
  const invalidate = useThree((state) => state.invalidate);
  const onRestoring = props.onRestoring;
  const onRemount = props.onRemount;
  const recovery = useRef<"waiting" | "lost" | "rendering" | "ready">(
    "waiting",
  );
  useFrame(() => {
    if (recovery.current !== "waiting" || gl.getContext().isContextLost())
      return;
    recovery.current = "rendering";
  });
  useEffect(() => {
    const canvas = gl.domElement;
    const extension = gl.getContext().getExtension("WEBGL_lose_context");
    const removeAfterEffect = addAfterEffect(() => {
      if (recovery.current !== "rendering") return;
      recovery.current = "ready";
      onRestoring(false);
    });
    invalidate();
    let restoreTimer: ReturnType<typeof setTimeout> | undefined;
    let remountTimer: ReturnType<typeof setTimeout> | undefined;
    function clearTimers() {
      clearTimeout(restoreTimer);
      clearTimeout(remountTimer);
    }
    function lost(event: Event) {
      event.preventDefault();
      clearTimers();
      recovery.current = "lost";
      onRestoring(true);
      restoreTimer = setTimeout(() => extension?.restoreContext(), 500);
      remountTimer = setTimeout(onRemount, 3000);
    }
    function restored() {
      clearTimers();
      recovery.current = "waiting";
      invalidate();
    }
    canvas.addEventListener("webglcontextlost", lost);
    canvas.addEventListener("webglcontextrestored", restored);
    return () => {
      clearTimers();
      removeAfterEffect();
      canvas.removeEventListener("webglcontextlost", lost);
      canvas.removeEventListener("webglcontextrestored", restored);
    };
  }, [gl, invalidate, onRestoring, onRemount]);
  return null;
}
