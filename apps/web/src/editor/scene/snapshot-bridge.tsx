import { useThree } from "@react-three/fiber";
import { type RefObject, useEffect } from "react";
import { renderSnapshot } from "./render-snapshot.ts";

type SnapshotBridgeProps = {
  takeSnapshotRef: RefObject<(() => Promise<Blob>) | undefined>;
};

export function SnapshotBridge(props: SnapshotBridgeProps) {
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  const camera = useThree((state) => state.camera);
  const size = useThree((state) => state.size);

  useEffect(() => {
    const ref = props.takeSnapshotRef;
    ref.current = () =>
      renderSnapshot({
        gl,
        scene,
        camera,
        sizePx: { width: size.width, height: size.height },
      });
    return () => {
      ref.current = undefined;
    };
  }, [props.takeSnapshotRef, gl, scene, camera, size.width, size.height]);

  return null;
}
